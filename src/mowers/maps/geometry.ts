// Typed, read-only decoding of the three E15 map files on top of PortableMapAcquisition.
// Field numbers, names and enumerations come from the original parser as recorded with
// their provenance in docs/MAP_GEOMETRY.md. No fork schema, constant, fixture or test.
// Pure functions: no I/O, no mutation of the input, no geometry inference beyond the wire.
import type { MapAcquisitionSnapshot, MapStreamName } from './types.js';
import {
  MapWireError,
  mapWireBudget,
  readMapRecords,
  zigzag32,
  type MapWireBudget,
  type MapWireFault,
  type MapWireRecord,
} from './protobuf.js';

/** Integer map coordinates as carried on the wire. The unit is not confirmed by a source. */
export interface MowerMapPoint {
  x: number;
  y: number;
}
/** Position and heading. `theta` is carried as an integer whose unit is not confirmed. */
export interface MowerMapPose extends MowerMapPoint {
  theta: number;
}
export interface MowerMapPolygon {
  points: MowerMapPoint[];
  /** Fewer than three points, or no two distinct points. Kept as data, never repaired. */
  degenerate: boolean;
}
export interface MowerMapLine {
  p0: MowerMapPoint;
  p1: MowerMapPoint;
  degenerate: boolean;
}
export interface MowerMapEllipse {
  center: MowerMapPoint;
  semiMajorAxis: number;
  semiMinorAxis: number;
  rotationAngle: number;
  degenerate: boolean;
}
export type MowerMapZoneShape = 'rectangle' | 'polygon' | 'ellipse' | 'unknown';
export interface MowerMapForbiddenZone {
  id: number;
  boundary?: MowerMapPolygon;
  isPolygon: boolean;
  shape: MowerMapZoneShape;
  shapeCode: number;
  ellipse?: MowerMapEllipse;
}
export interface MowerMapPhysicalForbiddenZone {
  id: number;
  polygon?: MowerMapPolygon;
  isClosed: boolean;
}
export interface MowerMapRequiredZone {
  id: number;
  boundary?: MowerMapPolygon;
  obstacleAvoidance?: { hasConfig: boolean; height: number };
  shape: MowerMapZoneShape;
  shapeCode: number;
  ellipse?: MowerMapEllipse;
}
export interface MowerMapPassThroughZone {
  id: number;
  boundary?: MowerMapPolygon;
  shape: MowerMapZoneShape;
  shapeCode: number;
  ellipse?: MowerMapEllipse;
}
export interface MowerMapVirtualWall {
  id: number;
  line?: MowerMapLine;
}
/** A cross-boundary tunnel, the pathway the app draws between separated lawn parts. */
export interface MowerMapTunnel {
  id: number;
  points: MowerMapPoint[];
}
export interface MowerMapMarker {
  id: number;
  pose?: MowerMapPose;
}
export interface MowerMapTrappedPoint {
  id: number;
  point?: MowerMapPoint;
}
export interface MowerMapMaintenancePoint {
  id: number;
  position?: MowerMapPoint;
  name: string;
}
export interface MowerMapSubRegion {
  id: number;
  name: string;
  boundary?: MowerMapPolygon;
  /** Read-only state reported by the device. The library offers no selection. */
  isSelectedForMow: boolean;
  adjacentSubRegionIds: number[];
  selectedForMowOrder: number;
  center?: MowerMapPoint;
  innerBoundaries: MowerMapPolygon[];
}
export interface MowerMapRegion {
  id: number;
  name: string;
  boundary?: MowerMapPolygon;
  subRegions: MowerMapSubRegion[];
  obstacles: MowerMapPolygon[];
}
export interface MowerMapTimestamp {
  seconds: number;
  nanos: number;
}
export type MowerMapState = 'empty' | 'incomplete' | 'complete' | 'unknown';
export type MowerMapKind = 'normal' | 'spot_mode_temporary' | 'spot_mode_saved' | 'unknown';
export type MowerMapIssue =
  | 'empty_grid'
  | 'zero_resolution'
  | 'missing_origin'
  | 'station_pose_missing'
  | 'station_pose_outside_bounds'
  | 'degenerate_region_boundary';
/** Axis-aligned extent spanned by origin, width, height and resolution in map units. */
export interface MowerMapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface MowerMap {
  id: number;
  name: string;
  kind: MowerMapKind;
  kindCode: number;
  state: MowerMapState;
  stateCode: number;
  width: number;
  height: number;
  resolution: number;
  origin?: MowerMapPoint;
  bounds?: MowerMapBounds;
  hasStation: boolean;
  stationPose?: MowerMapPose;
  totalArea: number;
  regions: MowerMapRegion[];
  obstacles: MowerMapPolygon[];
  forbiddenZones: MowerMapForbiddenZone[];
  physicalForbiddenZones: MowerMapPhysicalForbiddenZone[];
  virtualWalls: MowerMapVirtualWall[];
  crossBoundaryMarkers: MowerMapMarker[];
  crossBoundaryTunnels: MowerMapTunnel[];
  virtualCrossBoundaryTunnels: MowerMapTunnel[];
  passThroughZones: MowerMapPassThroughZone[];
  requiredZones: MowerMapRequiredZone[];
  trappedPoints: MowerMapTrappedPoint[];
  maintenancePoints: MowerMapMaintenancePoint[];
  lastSavedTime?: MowerMapTimestamp;
  mainDirectionAngle: number;
  mapViewRotateAngle: number;
  isBoundaryLocked: boolean;
  hasBirdView: boolean;
  birdViewIndex: number;
  hasBackup: boolean;
  /** Length of the opaque compressed payload, which this decoder does not expand. */
  compressedDataBytes: number;
  /** Field numbers present on the wire that this decoder leaves uninterpreted. */
  undecodedFields: number[];
  issues: MowerMapIssue[];
}
export type MowerPathKind = 'realtime' | 'history' | 'complete' | 'unknown';
export type MowerPathPointKind =
  | 'cleaning'
  | 'return'
  | 'resume'
  | 'cross_boundary'
  | 'move'
  | 'mapping'
  | 'semi_auto_manual_mapping'
  | 'unknown';
export interface MowerPathPoint {
  position: MowerMapPoint;
  kind: MowerPathPointKind;
  kindCode: number;
}
export interface MowerPath {
  id: number;
  mapId: number;
  kind: MowerPathKind;
  kindCode: number;
  endPose?: MowerMapPose;
  points: MowerPathPoint[];
  legacyPoints: MowerMapPoint[];
  compressedDataBytes: number;
  undecodedFields: number[];
}
export type MowerMapChannelKind = 'realtime_map' | 'multi_map' | 'unknown';
export type MowerMultiMapKind =
  | 'unknown'
  | 'one_map'
  | 'all_maps'
  | 'bird_view'
  | 'backup'
  | 'all_spot_mode_maps'
  | 'backup_list'
  | 'high_resolution_bird_view';
export interface MowerMultiMap {
  kind: MowerMultiMapKind;
  kindCode: number;
  map?: MowerMap;
  allMaps: MowerMap[];
  allSpotModeMaps: MowerMap[];
  backupMap?: MowerMap;
  /** Bird-view images and backup lists are present on the wire but not decoded. */
  undecodedFields: number[];
}
/** The message carried by `map.bin.stream`. */
export interface MowerMapChannelMessage {
  kind: MowerMapChannelKind;
  kindCode: number;
  realtimeMap?: { map?: MowerMap; legacyPath?: MowerPath };
  multiMap?: MowerMultiMap;
  undecodedFields: number[];
}
export interface MowerMapFileFault {
  file: MapStreamName;
  reason: MapWireFault;
  /** Absolute byte offset of the offending record. */
  offset: number;
  /** Dotted message path, for example `Map.regions.boundary`. */
  path: string;
}
export type MowerMapFileResult<T> =
  | { shape: 'decoded'; byteLength: number; value: T }
  | { shape: 'malformed'; byteLength: number; reason: MapWireFault; offset: number; path: string };
/** Typed view of one acquisition snapshot. Every file decodes independently. */
export interface MowerMapGeometry {
  revision: number;
  receivedAt: number;
  channel?: MowerMapChannelMessage;
  /** `channel.realtimeMap.map`, the current map of the realtime message. */
  map?: MowerMap;
  /** `cleanPath.bin.stream` as a path record. */
  cleaningPath?: MowerPath;
  /**
   * `navPath.bin.stream` when it holds only the three pose fields. Its meaning is not
   * confirmed by a source. Display only. Absent for any other content.
   */
  navigationPose?: MowerMapPose;
  faults: MowerMapFileFault[];
}

type Fields = Map<number, MapWireRecord[]>;
interface Cursor {
  budget: MapWireBudget;
}

function fields(
  bytes: Uint8Array,
  base: number,
  depth: number,
  cursor: Cursor,
  path: string,
): Fields {
  const grouped: Fields = new Map();
  for (const record of readMapRecords(bytes, base, depth, cursor.budget, path)) {
    const list = grouped.get(record.number);
    if (list) list.push(record);
    else grouped.set(record.number, [record]);
  }
  return grouped;
}
function last(f: Fields, number: number) {
  const list = f.get(number);
  return list ? list[list.length - 1] : undefined;
}
function varint(record: MapWireRecord, path: string): bigint {
  if (record.wire !== 'varint') throw new MapWireError('field_type', record.offset, path);
  return record.value as bigint;
}
function bytes(record: MapWireRecord, path: string): Uint8Array {
  if (record.wire !== 'bytes') throw new MapWireError('field_type', record.offset, path);
  return record.value as Uint8Array;
}
function int32(f: Fields, number: number, path: string): number {
  const record = last(f, number);
  return record ? Number(BigInt.asIntN(32, varint(record, path))) : 0;
}
function uint32(f: Fields, number: number, path: string): number {
  const record = last(f, number);
  return record ? Number(BigInt.asUintN(32, varint(record, path))) : 0;
}
function int64(f: Fields, number: number, path: string): number {
  const record = last(f, number);
  if (!record) return 0;
  const value = BigInt.asIntN(64, varint(record, path));
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new MapWireError('varint', record.offset, path);
  return Number(value);
}
function sint32(f: Fields, number: number, path: string): number {
  const record = last(f, number);
  return record ? zigzag32(varint(record, path)) : 0;
}
function bool(f: Fields, number: number, path: string): boolean {
  const record = last(f, number);
  return record ? varint(record, path) !== 0n : false;
}
function float32(f: Fields, number: number, path: string): number {
  const record = last(f, number);
  if (!record) return 0;
  if (record.wire !== 'fixed32') throw new MapWireError('field_type', record.offset, path);
  const view = record.value as Uint8Array;
  return new DataView(view.buffer, view.byteOffset, 4).getFloat32(0, true);
}
function text(f: Fields, number: number, path: string): string {
  const record = last(f, number);
  return record ? new TextDecoder('utf-8').decode(bytes(record, path)) : '';
}
function byteLength(f: Fields, number: number, path: string): number {
  const record = last(f, number);
  return record ? bytes(record, path).length : 0;
}
function message<T>(
  f: Fields,
  number: number,
  path: string,
  depth: number,
  cursor: Cursor,
  decode: (f: Fields, path: string, depth: number, cursor: Cursor) => T,
): T | undefined {
  const record = last(f, number);
  if (!record) return undefined;
  const view = bytes(record, path);
  return decode(fields(view, record.start, depth + 1, cursor, path), path, depth + 1, cursor);
}
function repeated<T>(
  f: Fields,
  number: number,
  path: string,
  depth: number,
  cursor: Cursor,
  decode: (f: Fields, path: string, depth: number, cursor: Cursor) => T,
): T[] {
  const list = f.get(number);
  if (!list) return [];
  return list.map((record) => {
    const view = bytes(record, path);
    return decode(fields(view, record.start, depth + 1, cursor, path), path, depth + 1, cursor);
  });
}
/** Packed and unpacked forms of a repeated 32-bit integer field. */
function int32List(f: Fields, number: number, path: string, cursor: Cursor): number[] {
  const list = f.get(number);
  if (!list) return [];
  const values: number[] = [];
  for (const record of list) {
    if (record.wire === 'varint') {
      values.push(Number(BigInt.asIntN(32, record.value as bigint)));
      continue;
    }
    const view = bytes(record, path);
    let offset = 0;
    while (offset < view.length) {
      if (cursor.budget.records <= 0)
        throw new MapWireError('too_many_records', record.offset, path);
      cursor.budget.records -= 1;
      let value = 0n;
      let index = 0;
      for (;;) {
        if (offset >= view.length) throw new MapWireError('truncated', record.offset, path);
        if (index >= 10) throw new MapWireError('varint', record.offset, path);
        const byte = view[offset]!;
        value |= BigInt(byte & 0x7f) << BigInt(7 * index);
        offset += 1;
        index += 1;
        if ((byte & 0x80) === 0) break;
      }
      values.push(Number(BigInt.asIntN(32, value)));
    }
  }
  return values;
}
function known(f: Fields, numbers: readonly number[]): number[] {
  return [...f.keys()].filter((n) => !numbers.includes(n)).sort((a, b) => a - b);
}

function point(f: Fields, path: string): MowerMapPoint {
  return { x: sint32(f, 1, path), y: sint32(f, 2, path) };
}
function pose(f: Fields, path: string): MowerMapPose {
  return { x: sint32(f, 1, path), y: sint32(f, 2, path), theta: sint32(f, 3, path) };
}
function samePoint(a: MowerMapPoint, b: MowerMapPoint) {
  return a.x === b.x && a.y === b.y;
}
function polygon(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapPolygon {
  const points = repeated(f, 1, `${path}.points`, depth, cursor, point);
  const distinct = points.filter((p, i) => points.findIndex((q) => samePoint(p, q)) === i);
  return { points, degenerate: points.length < 3 || distinct.length < 3 };
}
function line(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapLine {
  const p0 = message(f, 1, `${path}.p0`, depth, cursor, point) ?? { x: 0, y: 0 };
  const p1 = message(f, 2, `${path}.p1`, depth, cursor, point) ?? { x: 0, y: 0 };
  return { p0, p1, degenerate: samePoint(p0, p1) };
}
function ellipse(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapEllipse {
  const center = message(f, 1, `${path}.center`, depth, cursor, point) ?? { x: 0, y: 0 };
  const semiMajorAxis = uint32(f, 2, path);
  const semiMinorAxis = uint32(f, 3, path);
  const rotationAngle = float32(f, 4, path);
  return {
    center,
    semiMajorAxis,
    semiMinorAxis,
    rotationAngle,
    degenerate: semiMajorAxis === 0 || semiMinorAxis === 0 || !Number.isFinite(rotationAngle),
  };
}
const SHAPES: MowerMapZoneShape[] = ['rectangle', 'polygon', 'ellipse'];
function shape(code: number): MowerMapZoneShape {
  return SHAPES[code] ?? 'unknown';
}
function forbiddenZone(
  f: Fields,
  path: string,
  depth: number,
  cursor: Cursor,
): MowerMapForbiddenZone {
  const shapeCode = int32(f, 4, path);
  const zone: MowerMapForbiddenZone = {
    id: int32(f, 1, path),
    isPolygon: bool(f, 3, path),
    shape: shape(shapeCode),
    shapeCode,
  };
  const boundary = message(f, 2, `${path}.boundary`, depth, cursor, polygon);
  if (boundary) zone.boundary = boundary;
  const e = message(f, 5, `${path}.ellipse`, depth, cursor, ellipse);
  if (e) zone.ellipse = e;
  return zone;
}
function physicalForbiddenZone(f: Fields, path: string, depth: number, cursor: Cursor) {
  const zone: MowerMapPhysicalForbiddenZone = { id: int32(f, 1, path), isClosed: bool(f, 3, path) };
  const p = message(f, 2, `${path}.polygon`, depth, cursor, polygon);
  if (p) zone.polygon = p;
  return zone;
}
function requiredZone(
  f: Fields,
  path: string,
  depth: number,
  cursor: Cursor,
): MowerMapRequiredZone {
  const shapeCode = int32(f, 4, path);
  const zone: MowerMapRequiredZone = { id: int32(f, 1, path), shape: shape(shapeCode), shapeCode };
  const boundary = message(f, 2, `${path}.boundary`, depth, cursor, polygon);
  if (boundary) zone.boundary = boundary;
  const avoidance = message(f, 3, `${path}.obstacleAvoidance`, depth, cursor, (g, p) => ({
    hasConfig: bool(g, 1, p),
    height: int32(g, 2, p),
  }));
  if (avoidance) zone.obstacleAvoidance = avoidance;
  const e = message(f, 5, `${path}.ellipse`, depth, cursor, ellipse);
  if (e) zone.ellipse = e;
  return zone;
}
function passThroughZone(f: Fields, path: string, depth: number, cursor: Cursor) {
  const shapeCode = int32(f, 3, path);
  const zone: MowerMapPassThroughZone = {
    id: int32(f, 1, path),
    shape: shape(shapeCode),
    shapeCode,
  };
  const boundary = message(f, 2, `${path}.boundary`, depth, cursor, polygon);
  if (boundary) zone.boundary = boundary;
  const e = message(f, 4, `${path}.ellipse`, depth, cursor, ellipse);
  if (e) zone.ellipse = e;
  return zone;
}
function virtualWall(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapVirtualWall {
  const wall: MowerMapVirtualWall = { id: int32(f, 1, path) };
  const l = message(f, 2, `${path}.line`, depth, cursor, line);
  if (l) wall.line = l;
  return wall;
}
function tunnel(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapTunnel {
  return { id: int32(f, 2, path), points: repeated(f, 1, `${path}.points`, depth, cursor, point) };
}
function marker(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapMarker {
  const m: MowerMapMarker = { id: int32(f, 1, path) };
  const p = message(f, 2, `${path}.pose`, depth, cursor, pose);
  if (p) m.pose = p;
  return m;
}
function trappedPoint(
  f: Fields,
  path: string,
  depth: number,
  cursor: Cursor,
): MowerMapTrappedPoint {
  const t: MowerMapTrappedPoint = { id: int32(f, 1, path) };
  const p = message(f, 2, `${path}.point`, depth, cursor, point);
  if (p) t.point = p;
  return t;
}
function maintenancePoint(f: Fields, path: string, depth: number, cursor: Cursor) {
  const m: MowerMapMaintenancePoint = { id: int32(f, 1, path), name: text(f, 3, path) };
  const p = message(f, 2, `${path}.position`, depth, cursor, point);
  if (p) m.position = p;
  return m;
}
function subRegion(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapSubRegion {
  const sub: MowerMapSubRegion = {
    id: int32(f, 1, path),
    name: text(f, 2, path),
    isSelectedForMow: bool(f, 4, path),
    adjacentSubRegionIds: int32List(f, 5, path, cursor),
    selectedForMowOrder: int32(f, 6, path),
    innerBoundaries: repeated(f, 9, `${path}.innerBoundaries`, depth, cursor, polygon),
  };
  const boundary = message(f, 3, `${path}.boundary`, depth, cursor, polygon);
  if (boundary) sub.boundary = boundary;
  const center = message(f, 7, `${path}.center`, depth, cursor, point);
  if (center) sub.center = center;
  return sub;
}
function region(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapRegion {
  const r: MowerMapRegion = {
    id: int32(f, 1, path),
    name: text(f, 2, path),
    subRegions: repeated(f, 4, `${path}.subRegions`, depth, cursor, subRegion),
    obstacles: repeated(f, 6, `${path}.obstacles`, depth, cursor, (g, p, d, c) => {
      const b = message(g, 1, `${p}.boundary`, d, c, polygon);
      return b ?? { points: [], degenerate: true };
    }),
  };
  const boundary = message(f, 3, `${path}.boundary`, depth, cursor, polygon);
  if (boundary) r.boundary = boundary;
  return r;
}
function timestamp(f: Fields, path: string): MowerMapTimestamp {
  return { seconds: int64(f, 1, path), nanos: int32(f, 2, path) };
}
const MAP_STATES: MowerMapState[] = ['empty', 'incomplete', 'complete'];
const MAP_KINDS: MowerMapKind[] = ['normal', 'spot_mode_temporary', 'spot_mode_saved'];
const MAP_FIELDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 25, 26, 29, 30, 32, 34,
  35, 37, 38, 39,
] as const;
function inside(b: MowerMapBounds, p: MowerMapPoint) {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}
function map(f: Fields, path: string, depth: number, cursor: Cursor): MowerMap {
  const stateCode = int32(f, 17, path);
  const kindCode = int32(f, 34, path);
  const width = uint32(f, 3, path);
  const height = uint32(f, 4, path);
  const resolution = uint32(f, 5, path);
  const hasStation = bool(f, 7, path);
  const result: MowerMap = {
    id: int32(f, 1, path),
    name: text(f, 2, path),
    kind: MAP_KINDS[kindCode] ?? 'unknown',
    kindCode,
    state: MAP_STATES[stateCode] ?? 'unknown',
    stateCode,
    width,
    height,
    resolution,
    hasStation,
    totalArea: uint32(f, 16, path),
    regions: repeated(f, 10, `${path}.regions`, depth, cursor, region),
    obstacles: repeated(f, 11, `${path}.obstacles`, depth, cursor, polygon),
    forbiddenZones: repeated(f, 12, `${path}.forbiddenZones`, depth, cursor, forbiddenZone),
    physicalForbiddenZones: repeated(
      f,
      14,
      `${path}.physicalForbiddenZones`,
      depth,
      cursor,
      physicalForbiddenZone,
    ),
    virtualWalls: repeated(f, 13, `${path}.virtualWalls`, depth, cursor, virtualWall),
    crossBoundaryMarkers: repeated(f, 15, `${path}.crossBoundaryMarkers`, depth, cursor, marker),
    crossBoundaryTunnels: repeated(f, 18, `${path}.crossBoundaryTunnels`, depth, cursor, tunnel),
    virtualCrossBoundaryTunnels: repeated(
      f,
      32,
      `${path}.virtualCrossBoundaryTunnels`,
      depth,
      cursor,
      tunnel,
    ),
    passThroughZones: repeated(f, 35, `${path}.passThroughZones`, depth, cursor, passThroughZone),
    requiredZones: repeated(f, 26, `${path}.requiredZones`, depth, cursor, requiredZone),
    trappedPoints: repeated(f, 20, `${path}.trappedPoints`, depth, cursor, trappedPoint),
    maintenancePoints: repeated(
      f,
      38,
      `${path}.maintenancePoints`,
      depth,
      cursor,
      maintenancePoint,
    ),
    mainDirectionAngle: int32(f, 30, path),
    mapViewRotateAngle: int32(f, 37, path),
    isBoundaryLocked: bool(f, 39, path),
    hasBirdView: bool(f, 21, path),
    birdViewIndex: uint32(f, 22, path),
    hasBackup: bool(f, 25, path),
    compressedDataBytes: byteLength(f, 9, path),
    undecodedFields: known(f, MAP_FIELDS),
    issues: [],
  };
  const origin = message(f, 6, `${path}.origin`, depth, cursor, point);
  if (origin) result.origin = origin;
  const stationPose = message(f, 8, `${path}.stationPose`, depth, cursor, pose);
  if (stationPose) result.stationPose = stationPose;
  const saved = message(f, 29, `${path}.lastSavedTime`, depth, cursor, timestamp);
  if (saved) result.lastSavedTime = saved;
  if (width === 0 || height === 0) result.issues.push('empty_grid');
  if (resolution === 0) result.issues.push('zero_resolution');
  if (!origin) result.issues.push('missing_origin');
  else if (width > 0 && height > 0 && resolution > 0) {
    result.bounds = {
      minX: origin.x,
      minY: origin.y,
      maxX: origin.x + width * resolution,
      maxY: origin.y + height * resolution,
    };
    if (stationPose && !inside(result.bounds, stationPose))
      result.issues.push('station_pose_outside_bounds');
  }
  if (hasStation && !stationPose) result.issues.push('station_pose_missing');
  if (result.regions.some((r) => !r.boundary || r.boundary.degenerate))
    result.issues.push('degenerate_region_boundary');
  return result;
}
const PATH_KINDS: MowerPathKind[] = ['realtime', 'history', 'complete'];
const POINT_KINDS: MowerPathPointKind[] = [
  'cleaning',
  'return',
  'resume',
  'cross_boundary',
  'move',
  'mapping',
  'semi_auto_manual_mapping',
];
const PATH_FIELDS = [1, 2, 3, 4, 5, 6, 7] as const;
function pathPoint(f: Fields, path: string, depth: number, cursor: Cursor): MowerPathPoint {
  const kindCode = int32(f, 2, path);
  return {
    position: message(f, 1, `${path}.position`, depth, cursor, point) ?? { x: 0, y: 0 },
    kind: POINT_KINDS[kindCode] ?? 'unknown',
    kindCode,
  };
}
function pathMessage(f: Fields, path: string, depth: number, cursor: Cursor): MowerPath {
  const kindCode = int32(f, 3, path);
  const result: MowerPath = {
    id: int32(f, 1, path),
    mapId: int32(f, 2, path),
    kind: PATH_KINDS[kindCode] ?? 'unknown',
    kindCode,
    points: repeated(f, 7, `${path}.points`, depth, cursor, pathPoint),
    legacyPoints: repeated(f, 6, `${path}.legacyPoints`, depth, cursor, point),
    compressedDataBytes: byteLength(f, 4, path),
    undecodedFields: known(f, PATH_FIELDS),
  };
  const endPose = message(f, 5, `${path}.endPose`, depth, cursor, pose);
  if (endPose) result.endPose = endPose;
  return result;
}
const MULTI_KINDS: MowerMultiMapKind[] = [
  'unknown',
  'one_map',
  'all_maps',
  'bird_view',
  'backup',
  'all_spot_mode_maps',
  'backup_list',
  'high_resolution_bird_view',
];
function allMaps(f: Fields, path: string, depth: number, cursor: Cursor): MowerMap[] {
  return repeated(f, 1, `${path}.maps`, depth, cursor, map);
}
function multiMap(f: Fields, path: string, depth: number, cursor: Cursor): MowerMultiMap {
  const kindCode = int32(f, 1, path);
  const result: MowerMultiMap = {
    kind: MULTI_KINDS[kindCode] ?? 'unknown',
    kindCode,
    allMaps: message(f, 3, `${path}.allMaps`, depth, cursor, allMaps) ?? [],
    allSpotModeMaps: message(f, 6, `${path}.allSpotModeMaps`, depth, cursor, allMaps) ?? [],
    undecodedFields: known(f, [1, 2, 3, 5, 6]),
  };
  const one = message(f, 2, `${path}.map`, depth, cursor, map);
  if (one) result.map = one;
  const backup = message(f, 5, `${path}.backup`, depth, cursor, (g, p, d, c) =>
    message(g, 1, `${p}.map`, d, c, map),
  );
  if (backup) result.backupMap = backup;
  return result;
}
const CHANNEL_KINDS: MowerMapChannelKind[] = ['realtime_map', 'multi_map'];
function channel(f: Fields, path: string, depth: number, cursor: Cursor): MowerMapChannelMessage {
  const kindCode = int32(f, 1, path);
  const result: MowerMapChannelMessage = {
    kind: CHANNEL_KINDS[kindCode] ?? 'unknown',
    kindCode,
    undecodedFields: known(f, [1, 2, 3]),
  };
  const realtime = message(f, 2, `${path}.realtimeMap`, depth, cursor, (g, p, d, c) => {
    const value: { map?: MowerMap; legacyPath?: MowerPath } = {};
    const m = message(g, 1, `${p}.map`, d, c, map);
    if (m) value.map = m;
    const legacy = message(g, 2, `${p}.legacyPath`, d, c, pathMessage);
    if (legacy) value.legacyPath = legacy;
    return value;
  });
  if (realtime) result.realtimeMap = realtime;
  const multi = message(f, 3, `${path}.multiMap`, depth, cursor, multiMap);
  if (multi) result.multiMap = multi;
  return result;
}

function decodeFile<T>(
  input: Uint8Array,
  root: string,
  decode: (f: Fields, path: string, depth: number, cursor: Cursor) => T,
): MowerMapFileResult<T> {
  const byteLength = input.length;
  const cursor: Cursor = { budget: mapWireBudget() };
  try {
    const value = decode(fields(input, 0, 0, cursor, root), root, 0, cursor);
    return { shape: 'decoded', byteLength, value };
  } catch (error) {
    if (error instanceof MapWireError)
      return {
        shape: 'malformed',
        byteLength,
        reason: error.reason,
        offset: error.offset,
        path: error.path,
      };
    throw error;
  }
}

/** Decode `map.bin.stream`. Never throws on malformed input and never mutates it. */
export function decodeMowerMapFile(input: Uint8Array): MowerMapFileResult<MowerMapChannelMessage> {
  return decodeFile(input, 'MapChannelMsg', channel);
}
/** Decode `cleanPath.bin.stream` or another path record. */
export function decodeMowerPathFile(input: Uint8Array): MowerMapFileResult<MowerPath> {
  return decodeFile(input, 'Path', pathMessage);
}
/**
 * Decode `navPath.bin.stream` as a pose. Only a record set made of the three pose fields
 * is accepted. Anything else is reported as `field_type` because its message is unknown.
 */
export function decodeMowerPoseFile(input: Uint8Array): MowerMapFileResult<MowerMapPose> {
  return decodeFile(input, 'Pose', (f, path) => {
    for (const [number, records] of f) {
      const record = records[0]!;
      if (number > 3 || record.wire !== 'varint')
        throw new MapWireError('field_type', record.offset, path);
    }
    return pose(f, path);
  });
}
/** Decode the three files of one acquisition snapshot. Each file fails independently. */
export function decodeMowerMapSnapshot(snapshot: MapAcquisitionSnapshot): MowerMapGeometry {
  const result: MowerMapGeometry = {
    revision: snapshot.revision,
    receivedAt: snapshot.receivedAt,
    faults: [],
  };
  const mapResult = decodeMowerMapFile(snapshot.files['map.bin.stream']);
  if (mapResult.shape === 'decoded') {
    result.channel = mapResult.value;
    if (mapResult.value.realtimeMap?.map) result.map = mapResult.value.realtimeMap.map;
  } else result.faults.push({ file: 'map.bin.stream', ...fault(mapResult) });
  const pathResult = decodeMowerPathFile(snapshot.files['cleanPath.bin.stream']);
  if (pathResult.shape === 'decoded') result.cleaningPath = pathResult.value;
  else result.faults.push({ file: 'cleanPath.bin.stream', ...fault(pathResult) });
  const poseResult = decodeMowerPoseFile(snapshot.files['navPath.bin.stream']);
  if (poseResult.shape === 'decoded') result.navigationPose = poseResult.value;
  else result.faults.push({ file: 'navPath.bin.stream', ...fault(poseResult) });
  return result;
}
function fault(result: { shape: 'malformed'; reason: MapWireFault; offset: number; path: string }) {
  return { reason: result.reason, offset: result.offset, path: result.path };
}
