// Library-owned accumulation of successive decoded cleaning paths into one ordered history.
// The merge is structural: it compares the points the wire carried and never invents a point,
// an order or a timing. Every returned history is frozen plain data. The acquisition adapter
// and the decoder are untouched. Semantics and confirmation levels are in docs/MAP_GEOMETRY.md.
import { EufyError } from '../../types.js';
import type {
  MowerMap,
  MowerMapPoint,
  MowerMapPose,
  MowerMapTimestamp,
  MowerPath,
  MowerPathKind,
  MowerPathPoint,
  MowerPathPointKind,
} from './geometry.js';
import { MAX_MAP_RECORDS } from './protobuf.js';

/** The map fields that frame a path's coordinates. A change starts a new history. */
export interface MowerMapGeneration {
  readonly lastSavedTime?: Readonly<MowerMapTimestamp>;
  readonly width: number;
  readonly height: number;
  readonly resolution: number;
  readonly origin?: Readonly<MowerMapPoint>;
}
/** One run of points carried by one acquisition. Indices refer to `MowerPathHistory.points`. */
export interface MowerPathSegment {
  /** Index of the first point of this segment. */
  readonly start: number;
  /** Index after the last point of this segment. */
  readonly end: number;
  /** Acquisition revision and local receipt time of the input that carried the points. */
  readonly revision: number;
  readonly receivedAt: number;
  /** Kind of the path file that carried the points. */
  readonly kind: MowerPathKind;
  readonly kindCode: number;
}
/** Frozen, ordered history of one path on one map generation. */
export interface MowerPathHistory {
  readonly mapId: number;
  readonly pathId: number;
  readonly generation: MowerMapGeneration;
  /** Kind of the latest history or complete path that set `confirmed`, `realtime` before one. */
  readonly kind: MowerPathKind;
  readonly kindCode: number;
  /** End pose carried by the latest history or complete path that set `confirmed`. */
  readonly endPose?: Readonly<MowerMapPose>;
  /** Every point in wire order. Points are frozen and keep their kind and code unchanged. */
  readonly points: readonly MowerPathPoint[];
  readonly segments: readonly MowerPathSegment[];
  /** Leading points established by a history or complete path. The rest are provisional. */
  readonly confirmed: number;
  /** Revision and receipt time of the latest input that extended or confirmed the history. */
  readonly revision: number;
  readonly receivedAt: number;
}
/** The fields of `MowerMapGeometry` that the accumulator reads. */
export interface MowerPathMergeInput {
  revision: number;
  receivedAt: number;
  map?: Pick<MowerMap, 'id' | 'lastSavedTime' | 'width' | 'height' | 'resolution' | 'origin'>;
  cleaningPath?: Pick<MowerPath, 'id' | 'mapId' | 'kind' | 'kindCode' | 'endPose' | 'points'>;
}
export type MowerPathStartReason = 'first' | 'identity' | 'generation' | 'diverged';
export type MowerPathRejection =
  | 'malformed'
  | 'path_unavailable'
  | 'map_unavailable'
  | 'unknown_kind'
  | 'identity_mismatch'
  | 'out_of_order'
  | 'duplicate'
  | 'too_many_points';
export type MowerPathMergeResult =
  | {
      outcome: 'started';
      reason: MowerPathStartReason;
      history: MowerPathHistory;
      /** The history that the new one replaces. It is returned, never mixed in. */
      previous?: MowerPathHistory;
    }
  | {
      outcome: 'extended';
      /** Points appended from this input. */
      added: number;
      /** Provisional realtime points that this history or complete path replaced. */
      replaced: number;
      history: MowerPathHistory;
    }
  | { outcome: 'unchanged'; history: MowerPathHistory }
  | { outcome: 'empty'; history?: MowerPathHistory }
  | { outcome: 'rejected'; reason: MowerPathRejection; history?: MowerPathHistory };
export interface MowerPathAccumulatorOptions {
  /** Largest number of points one history may hold. Default 4,194,304, the wire record budget. */
  maxPoints?: number;
}

const PATH_KINDS: readonly MowerPathKind[] = ['realtime', 'history', 'complete'];
const POINT_KINDS: readonly MowerPathPointKind[] = [
  'cleaning',
  'return',
  'resume',
  'cross_boundary',
  'move',
  'mapping',
  'semi_auto_manual_mapping',
];

interface InputPath {
  id: number;
  mapId: number;
  kind: MowerPathKind;
  kindCode: number;
  endPose?: Readonly<MowerMapPose>;
  points: MowerPathPoint[];
}
interface Input {
  revision: number;
  receivedAt: number;
  map?: { id: number; generation: MowerMapGeneration };
  path?: InputPath;
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
function copyPoint(value: unknown): Readonly<MowerMapPoint> | undefined {
  if (!isObject(value) || !isInt(value.x) || !isInt(value.y)) return undefined;
  return Object.freeze({ x: value.x, y: value.y });
}
function copyPose(value: unknown): Readonly<MowerMapPose> | undefined {
  if (!isObject(value) || !isInt(value.x) || !isInt(value.y) || !isInt(value.theta))
    return undefined;
  return Object.freeze({ x: value.x, y: value.y, theta: value.theta });
}
function copyTimestamp(value: unknown): Readonly<MowerMapTimestamp> | undefined {
  if (!isObject(value) || !isInt(value.seconds) || !isInt(value.nanos)) return undefined;
  return Object.freeze({ seconds: value.seconds, nanos: value.nanos });
}
function copyPathPoint(value: unknown): MowerPathPoint | undefined {
  if (!isObject(value) || !isInt(value.kindCode)) return undefined;
  const position = copyPoint(value.position);
  const kind = POINT_KINDS[value.kindCode] ?? 'unknown';
  if (!position || value.kind !== kind) return undefined;
  return Object.freeze({ position, kind, kindCode: value.kindCode });
}
function copyMap(value: unknown): Input['map'] | undefined {
  if (
    !isObject(value) ||
    !isInt(value.id) ||
    !isInt(value.width) ||
    !isInt(value.height) ||
    !isInt(value.resolution) ||
    value.width < 0 ||
    value.height < 0 ||
    value.resolution < 0
  )
    return undefined;
  const generation: Mutable<MowerMapGeneration> = {
    width: value.width,
    height: value.height,
    resolution: value.resolution,
  };
  if (value.origin !== undefined) {
    const origin = copyPoint(value.origin);
    if (!origin) return undefined;
    generation.origin = origin;
  }
  if (value.lastSavedTime !== undefined) {
    const saved = copyTimestamp(value.lastSavedTime);
    if (!saved) return undefined;
    generation.lastSavedTime = saved;
  }
  return { id: value.id, generation: Object.freeze(generation) };
}
function copyPath(value: unknown): InputPath | undefined {
  if (!isObject(value) || !isInt(value.id) || !isInt(value.mapId) || !isInt(value.kindCode))
    return undefined;
  const kind = PATH_KINDS[value.kindCode] ?? 'unknown';
  if (value.kind !== kind || !Array.isArray(value.points)) return undefined;
  const points: MowerPathPoint[] = [];
  for (const item of value.points) {
    const point = copyPathPoint(item);
    if (!point) return undefined;
    points.push(point);
  }
  const path: InputPath = {
    id: value.id,
    mapId: value.mapId,
    kind,
    kindCode: value.kindCode,
    points,
  };
  if (value.endPose !== undefined) {
    const endPose = copyPose(value.endPose);
    if (!endPose) return undefined;
    path.endPose = endPose;
  }
  return path;
}
/** Validate and copy the input. Nothing of the caller's object is retained. */
function normalize(value: unknown): Input | undefined {
  if (!isObject(value) || !isInt(value.revision) || !isInt(value.receivedAt)) return undefined;
  const input: Input = { revision: value.revision, receivedAt: value.receivedAt };
  if (value.map !== undefined) {
    const map = copyMap(value.map);
    if (!map) return undefined;
    input.map = map;
  }
  if (value.cleaningPath !== undefined) {
    const path = copyPath(value.cleaningPath);
    if (!path) return undefined;
    input.path = path;
  }
  return input;
}

function samePoint(a: Readonly<MowerMapPoint> | undefined, b: Readonly<MowerMapPoint> | undefined) {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
}
function sameGeneration(a: MowerMapGeneration, b: MowerMapGeneration) {
  const savedA = a.lastSavedTime;
  const savedB = b.lastSavedTime;
  const sameSave =
    savedA === savedB ||
    (!!savedA && !!savedB && savedA.seconds === savedB.seconds && savedA.nanos === savedB.nanos);
  return (
    sameSave &&
    a.width === b.width &&
    a.height === b.height &&
    a.resolution === b.resolution &&
    samePoint(a.origin, b.origin)
  );
}
/** Number of leading points of `b` that equal the points of `a` from `offset` onward. */
function commonPrefix(a: readonly MowerPathPoint[], offset: number, b: readonly MowerPathPoint[]) {
  const limit = Math.min(a.length - offset, b.length);
  let count = 0;
  while (count < limit) {
    const p = a[offset + count]!;
    const q = b[count]!;
    if (p.position.x !== q.position.x || p.position.y !== q.position.y || p.kindCode !== q.kindCode)
      break;
    count += 1;
  }
  return count;
}
/** Segments that lie before `end`. A segment crossing it is cut, never extended. */
function segmentsBefore(segments: readonly MowerPathSegment[], end: number): MowerPathSegment[] {
  const kept: MowerPathSegment[] = [];
  for (const segment of segments) {
    if (segment.end <= end) kept.push(segment);
    else if (segment.start < end) kept.push(Object.freeze({ ...segment, end }));
  }
  return kept;
}
function segment(start: number, end: number, input: Input, path: InputPath): MowerPathSegment {
  return Object.freeze({
    start,
    end,
    revision: input.revision,
    receivedAt: input.receivedAt,
    kind: path.kind,
    kindCode: path.kindCode,
  });
}
function freeze(
  fields: Omit<Mutable<MowerPathHistory>, 'endPose'> & {
    endPose: Readonly<MowerMapPose> | undefined;
  },
): MowerPathHistory {
  const { endPose, ...rest } = fields;
  Object.freeze(rest.points);
  Object.freeze(rest.segments);
  return Object.freeze(endPose ? { ...rest, endPose } : rest);
}

/**
 * Merges successive decoded cleaning paths of one map identity and generation into one
 * ordered history. Feed it the `MowerMapGeometry` of every acquisition snapshot in receipt
 * order. History and complete paths are authoritative for the whole path. Realtime paths
 * extend the history provisionally and never replace its points, kind or end pose. Empty,
 * malformed, duplicate and out-of-order inputs leave the history untouched.
 */
export class MowerPathAccumulator {
  readonly #maxPoints: number;
  #history?: MowerPathHistory;

  constructor(options?: MowerPathAccumulatorOptions) {
    const limit = (isObject(options) ? options.maxPoints : undefined) ?? MAX_MAP_RECORDS;
    if (!isInt(limit) || limit < 1 || limit > MAX_MAP_RECORDS)
      throw new EufyError('mower_path_invalid_options');
    this.#maxPoints = limit;
  }

  /** The current history. Frozen plain data, shared with the results of `merge`. */
  get history(): MowerPathHistory | undefined {
    return this.#history;
  }

  /** Drop the current history and return it. */
  clear(): MowerPathHistory | undefined {
    const previous = this.#history;
    this.#history = undefined;
    return previous;
  }

  merge(input: MowerPathMergeInput): MowerPathMergeResult {
    const current = this.#history;
    const value = normalize(input);
    if (!value) return this.#rejected('malformed');
    const { path, map } = value;
    if (!path) return this.#rejected('path_unavailable');
    if (path.kind === 'unknown') return this.#rejected('unknown_kind');
    if (!map) return this.#rejected('map_unavailable');
    if (path.mapId !== map.id) return this.#rejected('identity_mismatch');
    if (current) {
      if (value.receivedAt < current.receivedAt) return this.#rejected('out_of_order');
      if (value.receivedAt === current.receivedAt && value.revision === current.revision)
        return this.#rejected('duplicate');
    }
    if (path.points.length === 0)
      return current ? { outcome: 'empty', history: current } : { outcome: 'empty' };
    if (!current) return this.#start('first', value, map, path);
    if (current.mapId !== map.id || current.pathId !== path.id)
      return this.#start('identity', value, map, path);
    if (!sameGeneration(current.generation, map.generation))
      return this.#start('generation', value, map, path);
    const common = commonPrefix(current.points, 0, path.points);
    // The input carries nothing beyond the points already held.
    if (common === path.points.length) return this.#unchanged(value, path, common);
    // The input carries every point already held and continues it.
    if (common === current.points.length) return this.#extend(value, path, common, common);
    if (path.kind !== 'realtime') {
      // A complete path that agrees with the confirmed points replaces the provisional tail.
      if (common >= current.confirmed) return this.#extend(value, path, common, common);
      return this.#start('diverged', value, map, path);
    }
    // A realtime path is compared with the provisional tail as well, then appended.
    const tail = commonPrefix(current.points, current.confirmed, path.points);
    if (tail === path.points.length) return this.#unchanged(value, path, current.confirmed);
    if (tail === current.points.length - current.confirmed)
      return this.#extend(value, path, current.points.length, tail);
    return this.#extend(value, path, current.points.length, 0);
  }

  #rejected(reason: MowerPathRejection): MowerPathMergeResult {
    const history = this.#history;
    return history ? { outcome: 'rejected', reason, history } : { outcome: 'rejected', reason };
  }

  #start(
    reason: MowerPathStartReason,
    input: Input,
    map: NonNullable<Input['map']>,
    path: InputPath,
  ): MowerPathMergeResult {
    if (path.points.length > this.#maxPoints) return this.#rejected('too_many_points');
    const complete = path.kind !== 'realtime';
    const previous = this.#history;
    const history = freeze({
      mapId: map.id,
      pathId: path.id,
      generation: map.generation,
      kind: path.kind,
      kindCode: path.kindCode,
      endPose: complete ? path.endPose : undefined,
      points: path.points,
      segments: [segment(0, path.points.length, input, path)],
      confirmed: complete ? path.points.length : 0,
      revision: input.revision,
      receivedAt: input.receivedAt,
    });
    this.#history = history;
    return previous
      ? { outcome: 'started', reason, history, previous }
      : { outcome: 'started', reason, history };
  }

  /** The input carries no new point. A complete path confirms the points up to `common`. */
  #unchanged(input: Input, path: InputPath, common: number): MowerPathMergeResult {
    const current = this.#history!;
    const confirms = path.kind !== 'realtime' && common >= current.confirmed;
    const history = freeze({
      mapId: current.mapId,
      pathId: current.pathId,
      generation: current.generation,
      kind: confirms ? path.kind : current.kind,
      kindCode: confirms ? path.kindCode : current.kindCode,
      endPose: confirms && path.endPose ? path.endPose : current.endPose,
      points: current.points,
      segments: current.segments,
      confirmed: confirms ? common : current.confirmed,
      revision: input.revision,
      receivedAt: input.receivedAt,
    });
    this.#history = history;
    return { outcome: 'unchanged', history };
  }

  /**
   * Keep the first `keep` current points and append the input's points from `from` onward.
   * A complete path confirms the result and replaces the provisional points beyond `keep`.
   * A realtime path keeps every current point and extends the provisional tail.
   */
  #extend(input: Input, path: InputPath, keep: number, from: number): MowerPathMergeResult {
    const current = this.#history!;
    const complete = path.kind !== 'realtime';
    const added = path.points.length - from;
    const replaced = current.points.length - keep;
    if (keep + added > this.#maxPoints) return this.#rejected('too_many_points');
    const points = current.points.slice(0, keep);
    for (let index = from; index < path.points.length; index += 1) points.push(path.points[index]!);
    const segments = segmentsBefore(current.segments, keep);
    segments.push(segment(keep, points.length, input, path));
    const history = freeze({
      mapId: current.mapId,
      pathId: current.pathId,
      generation: current.generation,
      kind: complete ? path.kind : current.kind,
      kindCode: complete ? path.kindCode : current.kindCode,
      endPose: complete && path.endPose ? path.endPose : current.endPose,
      points,
      segments,
      confirmed: complete ? points.length : current.confirmed,
      revision: input.revision,
      receivedAt: input.receivedAt,
    });
    this.#history = history;
    return { outcome: 'extended', added, replaced, history };
  }
}
