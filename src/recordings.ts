import { randomUUID } from 'node:crypto';
import type { Station } from './vendor/http/station.js';
import type { Device } from './vendor/http/device.js';
import type {
  DatabaseQueryByDate,
  DatabaseCountByDate,
  DatabaseUnhandled,
} from './vendor/p2p/interfaces.js';
import type { CommandResult } from './vendor/p2p/models.js';
import { CommandName } from './vendor/http/types.js';
import { awaitEvent } from './operations.js';
import { downloadRecording } from './download.js';
import {
  EufyError,
  type Recording,
  type RecordingObservation,
  type RecordingOperation,
  type RecordingOperationOptions,
  type RecordingOperationStage,
  type RecordingRowClasses,
  type StationConnectionProgress,
  type StationLookupObservation,
} from './types.js';

interface Connection {
  station(
    id: string,
    signal: AbortSignal,
    onProgress?: (progress: StationConnectionProgress) => void,
    onLookup?: (observation: StationLookupObservation) => void,
  ): Promise<Station>;
  camera(id: string): Device;
  knownCamera(id: string, stationId: string): boolean;
  busy(id: string): boolean;
  /** Whether the owner is an experimental standalone camera. */
  standalone?(id: string): boolean;
  /** Whether the owner's session is connected now. */
  connected?(id: string): boolean;
}
interface Reference {
  stationId: string;
  row: DatabaseQueryByDate;
  expires: number;
}
const LIMITS = [100, 500, 2000, 10000];
const localTime = (date: Date): string => {
  if (!(date instanceof Date) || !Number.isFinite(date.valueOf()))
    throw new EufyError('invalid_recording_date');
  const p = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
};
export function calendarDate(day: string): Date {
  const date = new Date(`${day}T12:00:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(date.valueOf()) ||
    localTime(date).slice(0, 10) !== day
  )
    throw new EufyError('invalid_recording_date');
  return date;
}
export async function completeHistory(
  read: (limit: number) => Promise<DatabaseQueryByDate[]>,
): Promise<DatabaseQueryByDate[]> {
  let previous = new Set<number>();
  for (const limit of LIMITS) {
    const rows = await read(limit);
    if (
      !Array.isArray(rows) ||
      rows.length > limit ||
      rows.some((r) => !Number.isSafeInteger(r.record_id))
    )
      throw new EufyError('invalid_history_page');
    const ids = new Set(rows.map((r) => r.record_id));
    if (ids.size !== rows.length || [...previous].some((id) => !ids.has(id)))
      throw new EufyError('history_changed');
    if (previous.size && ids.size === previous.size)
      throw new EufyError('history_completeness_unconfirmed');
    if (rows.length < limit) return rows;
    previous = ids;
  }
  throw new EufyError('history_completeness_unconfirmed');
}

const operationOptions = (
  options: AbortSignal | RecordingOperationOptions | undefined,
): RecordingOperationOptions =>
  options instanceof AbortSignal ? { signal: options } : (options ?? {});
const elapsed = (from: number, to = performance.now()) =>
  Math.min(3_600_000, Math.max(0, Math.round(to - from)));
const bounded = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value)
    ? Math.min(999_999, Math.max(-999_999, value))
    : null;
const validPath = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 2048;
interface Page {
  limit: number;
  sent: number;
  ended?: number;
  answered: boolean;
  acked: boolean;
  ackCode: number | null;
  resultCode: number | null;
  rows: number | null;
}
/**
 * Counts the rows of one list answer by the checks the list applies, without
 * throwing. A row that is not an object counts as another device.
 */
function rowClasses(
  rows: unknown[],
  known: (deviceId: string) => boolean,
  ownerId: string,
  day: string,
): RecordingRowClasses {
  const classes = {
    own: 0,
    otherDevice: 0,
    stationMismatch: 0,
    invalidTime: 0,
    otherDay: 0,
    cipherId: 0,
  };
  for (const item of rows) {
    const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof row.device_sn !== 'string' || !known(row.device_sn)) classes.otherDevice++;
    else if (row.station_sn !== ownerId || !validPath(row.storage_path)) classes.stationMismatch++;
    else classes.own++;
    if (row.cipher_id !== undefined) classes.cipherId++;
    let start: string | undefined;
    try {
      start = localTime(row.start_time as Date);
      localTime(row.end_time as Date);
    } catch {
      start = undefined;
    }
    if (start === undefined) classes.invalidTime++;
    else if (start.slice(0, 10) !== day) classes.otherDay++;
  }
  for (const key of Object.keys(classes) as (keyof RecordingRowClasses)[])
    classes[key] = Math.min(10000, classes[key]);
  return classes;
}

/**
 * Records one recording operation for its consumer's onObservation. Without that
 * callback it attaches no listener and reports nothing. It never throws into the
 * operation and never changes what the operation sends, waits for or returns.
 */
class Observation {
  stage: RecordingOperationStage = 'admission';
  private readonly started = performance.now();
  private readonly enabled: boolean;
  private owner: RecordingObservation['owner'] = 'station';
  private sessionOpen = false;
  private readonly pages: Page[] = [];
  private unhandled = 0;
  private unhandledReason: RecordingObservation['unhandledReason'] = null;
  private unhandledResultCode: number | null = null;
  private classes: RecordingRowClasses | null = null;
  private release = () => {};
  private reported = false;
  constructor(
    private readonly operation: RecordingOperation,
    private readonly callback: RecordingOperationOptions['onObservation'],
    /** The vendor command whose session results belong to this operation's pages. */
    private readonly command?: CommandName,
  ) {
    this.enabled = typeof callback === 'function';
  }
  /** The operation's owner, read once it is known. */
  bind(connection: Connection, id: string): void {
    if (!this.enabled) return;
    try {
      this.owner = connection.standalone?.(id) ? 'standalone' : 'station';
      this.sessionOpen = connection.connected?.(id) === true;
    } catch {
      // Observation only.
    }
  }
  /** Listens on the owner's session until the operation ends. */
  watch(station: Station): void {
    if (!this.enabled) return;
    // Commands with the query's name that were still waiting for their result when
    // this operation began belong to an earlier one. The session reports each with
    // the same custom data object it was sent with, so their results are skipped.
    // Other results with the query's name are matched to pages in send order.
    let earlier: Set<unknown> = new Set();
    try {
      if (this.command !== undefined) earlier = new Set(station.pendingCommandData(this.command));
    } catch {
      // Observation only.
    }
    const result = (_station: Station, command: CommandResult) => {
      if (this.command === undefined || command?.customData?.command?.name !== this.command) return;
      if (earlier.has(command.customData)) return;
      const page = this.pages.find((p) => !p.acked);
      if (!page) return;
      page.acked = true;
      page.ackCode = bounded(command.return_code);
    };
    const unhandled = (_station: Station, info: DatabaseUnhandled) => {
      this.unhandled = Math.min(99, this.unhandled + 1);
      this.unhandledReason =
        info?.reason === 'unknown_cmd' || info?.reason === 'parse_error' ? info.reason : null;
      this.unhandledResultCode = bounded(info?.resultCode);
    };
    station.on('command result', result);
    station.on('database unhandled', unhandled);
    this.release = () => {
      station.off('command result', result);
      station.off('database unhandled', unhandled);
    };
  }
  /** Sends one query page. Pages are sequential. A send that throws leaves no page. */
  send(limit: number, issue: () => void): void {
    this.stage = 'query';
    const page: Page | undefined = this.enabled
      ? {
          limit,
          sent: performance.now(),
          answered: false,
          acked: false,
          ackCode: null,
          resultCode: null,
          rows: null,
        }
      : undefined;
    if (page) this.pages.push(page);
    try {
      issue();
    } catch (error) {
      if (page) this.pages.splice(this.pages.indexOf(page), 1);
      throw error;
    }
  }
  /** The answer to the latest page arrived. */
  answer(resultCode: unknown, rows: unknown): void {
    this.stage = 'validate';
    const page = this.pages.at(-1);
    if (!page || page.answered) return;
    page.answered = true;
    page.ended = performance.now();
    page.resultCode = bounded(resultCode);
    page.rows = Array.isArray(rows) ? Math.min(10000, rows.length) : null;
  }
  /** Counts the rows of the latest list answer that carried a row array. */
  classify(rows: unknown, known: (deviceId: string) => boolean, ownerId: string, day: string) {
    if (!this.enabled || !Array.isArray(rows)) return;
    try {
      this.classes = rowClasses(rows, known, ownerId, day);
    } catch {
      // Observation only.
    }
  }
  /** Reports the operation once, with the error it failed with, if any. */
  finish(failure?: { error: unknown }): void {
    if (this.reported) return;
    this.reported = true;
    this.release();
    this.release = () => {};
    if (!this.enabled) return;
    const now = performance.now();
    const error = failure?.error;
    const code =
      error instanceof EufyError && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
        ? error.code
        : 'unexpected_error';
    const observation: RecordingObservation = {
      operation: this.operation,
      owner: this.owner,
      sessionOpen: this.sessionOpen,
      stage: this.stage,
      code: failure ? code : null,
      remoteCode: error instanceof EufyError ? bounded(error.remoteCode) : null,
      elapsedMs: elapsed(this.started, now),
      pages: this.pages.slice(0, 4).map((page) => ({
        limit: page.limit,
        elapsedMs: elapsed(page.sent, page.ended ?? now),
        answered: page.answered,
        ackCode: page.ackCode,
        resultCode: page.resultCode,
        rows: page.rows,
      })),
      unhandledReplies: this.unhandled,
      unhandledReason: this.unhandledReason,
      unhandledResultCode: this.unhandledResultCode,
      rowClasses: this.classes && { ...this.classes },
    };
    try {
      this.callback!(observation);
    } catch {
      // Ignored by contract. The observation never alters the operation.
    }
  }
}

/** Recording references originate exclusively from a complete query of the owner's database. */
export class RecordingAccess {
  private readonly operations = new Set<string>();
  private references = new Map<string, Reference>();
  private transfers = new Set<Promise<unknown>>();
  constructor(
    private readonly connection: Connection,
    private readonly lifetime: AbortSignal,
  ) {}
  busy(id: string): boolean {
    return this.operations.has(id);
  }
  get active(): boolean {
    return this.operations.size > 0;
  }
  /** Reports the operation exactly once, before its promise settles. */
  private async observed<T>(observation: Observation, operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      observation.finish();
      return result;
    } catch (error) {
      observation.finish({ error });
      throw error;
    }
  }
  private async run<T>(
    id: string,
    options: RecordingOperationOptions,
    observation: Observation,
    action: (station: Station, abort: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.operations.has(id) || this.connection.busy(id)) throw new EufyError('station_busy');
    this.operations.add(id);
    const abort = AbortSignal.any([
      this.lifetime,
      AbortSignal.timeout(60000),
      ...(options.signal ? [options.signal] : []),
    ]);
    let station: Station | undefined;
    try {
      observation.stage = 'connect';
      station = await this.connection.station(id, abort, options.onProgress, options.onLookup);
      observation.watch(station);
      observation.stage = 'query';
      return await action(station, abort);
    } catch (error) {
      await station?.close();
      throw error;
    } finally {
      this.operations.delete(id);
    }
  }
  private page(
    station: Station,
    start: Date,
    end: Date,
    limit: number,
    abort: AbortSignal,
    observation: Observation,
    classify: (rows: unknown) => void,
  ): Promise<DatabaseQueryByDate[]> {
    return awaitEvent(
      station,
      'database query by date',
      () =>
        observation.send(limit, () => station.databaseQueryByDate([], start, end, 0, 0, 0, limit)),
      (_s, code, rows) => {
        observation.answer(code, rows);
        classify(rows);
        if (code !== 0 || !Array.isArray(rows)) throw new EufyError('history_rejected', code);
        return rows;
      },
      abort,
    );
  }
  async list(
    stationId: string,
    day: string,
    cameraIds?: string[],
    options?: AbortSignal | RecordingOperationOptions,
  ): Promise<{ recordings: Recording[]; complete: true; returned: number }> {
    const settings = operationOptions(options);
    const observation = new Observation(
      'list',
      settings.onObservation,
      CommandName.StationDatabaseQueryByDate,
    );
    observation.bind(this.connection, stationId);
    return this.observed(observation, () =>
      this.queryList(stationId, day, cameraIds, settings, observation),
    );
  }
  private async queryList(
    stationId: string,
    day: string,
    cameraIds: string[] | undefined,
    settings: RecordingOperationOptions,
    observation: Observation,
  ): Promise<{ recordings: Recording[]; complete: true; returned: number }> {
    const start = calendarDate(day),
      end = new Date(start);
    end.setDate(end.getDate() + 1);
    if (cameraIds?.some((id) => !this.connection.knownCamera(id, stationId)))
      throw new EufyError('invalid_camera_filter');
    const classify = (rows: unknown) =>
      observation.classify(
        rows,
        (id) => this.connection.knownCamera(id, stationId),
        stationId,
        day,
      );
    return this.run(stationId, settings, observation, async (station, abort) => {
      const rows = await completeHistory((limit) =>
        this.page(station, start, end, limit, abort, observation, classify),
      );
      const recordings: Recording[] = [];
      const references = new Map<string, Reference>();
      for (const row of rows) {
        if (!this.connection.knownCamera(row.device_sn, stationId)) continue;
        if (
          row.station_sn !== stationId ||
          typeof row.storage_path !== 'string' ||
          !row.storage_path ||
          row.storage_path.length > 2048
        )
          throw new EufyError('invalid_recording');
        const start = localTime(row.start_time),
          end = localTime(row.end_time);
        if (start.slice(0, 10) !== day || (cameraIds && !cameraIds.includes(row.device_sn)))
          continue;
        const id = randomUUID();
        references.set(id, { stationId, row, expires: Date.now() + 15 * 60000 });
        recordings.push({
          id,
          stationId,
          deviceId: row.device_sn,
          start,
          end,
          bytes: row.folder_size || 0,
          thumbnail:
            typeof row.thumb_path === 'string' &&
            row.thumb_path.length > 0 &&
            row.thumb_path.length <= 2048,
        });
      }
      for (const [id, ref] of this.references)
        if (ref.expires <= Date.now()) this.references.delete(id);
      for (const [id, ref] of references) this.references.set(id, ref);
      while (this.references.size > 20000)
        this.references.delete(this.references.keys().next().value!);
      return {
        recordings: recordings.sort((a, b) => b.start.localeCompare(a.start)),
        complete: true,
        returned: rows.length,
      };
    });
  }
  async calendar(
    stationId: string,
    month: string,
    options?: AbortSignal | RecordingOperationOptions,
  ): Promise<string[]> {
    const settings = operationOptions(options);
    const observation = new Observation(
      'calendar',
      settings.onObservation,
      CommandName.StationDatabaseCountByDate,
    );
    observation.bind(this.connection, stationId);
    return this.observed(observation, () =>
      this.queryCalendar(stationId, month, settings, observation),
    );
  }
  private async queryCalendar(
    stationId: string,
    month: string,
    settings: RecordingOperationOptions,
    observation: Observation,
  ): Promise<string[]> {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new EufyError('invalid_recording_date');
    const start = calendarDate(month + '-01'),
      end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return this.run(stationId, settings, observation, async (station, abort) => {
      const rows = await awaitEvent<DatabaseCountByDate[]>(
        station,
        'database count by date',
        () => observation.send(0, () => station.databaseCountByDate(start, end)),
        (_s, code, rows) => {
          observation.answer(code, rows);
          if (code !== 0 || !Array.isArray(rows)) throw new EufyError('calendar_rejected', code);
          return rows;
        },
        abort,
      );
      return [
        ...new Set(
          rows
            .filter((r) => r.count > 0)
            .map((r) => localTime(r.day).slice(0, 10))
            .filter((day) => day.startsWith(month + '-')),
        ),
      ].sort();
    });
  }
  private reference(id: string): Reference {
    const ref = this.references.get(id);
    if (!ref || ref.expires <= Date.now()) throw new EufyError('recording_expired');
    return ref;
  }
  async thumbnail(id: string, options?: AbortSignal | RecordingOperationOptions): Promise<Buffer> {
    const settings = operationOptions(options);
    const observation = new Observation('thumbnail', settings.onObservation);
    return this.observed(observation, () => this.readThumbnail(id, settings, observation));
  }
  private async readThumbnail(
    id: string,
    settings: RecordingOperationOptions,
    observation: Observation,
  ): Promise<Buffer> {
    const ref = this.reference(id),
      path = ref.row.thumb_path;
    observation.bind(this.connection, ref.stationId);
    if (typeof path !== 'string' || !path || path.length > 2048)
      throw new EufyError('thumbnail_unavailable');
    this.connection.camera(ref.row.device_sn);
    return this.run(ref.stationId, settings, observation, (station, abort) =>
      awaitEvent(
        station,
        'image download',
        () => station.downloadImage(path),
        (_s, file, data) => {
          if (file !== path) return undefined;
          observation.stage = 'validate';
          if (
            !Buffer.isBuffer(data) ||
            data.length < 3 ||
            data.length > 5_000_000 ||
            data[0] !== 255 ||
            data[1] !== 216 ||
            data[2] !== 255
          )
            throw new EufyError('invalid_thumbnail');
          return data;
        },
        abort,
      ),
    );
  }
  async download(id: string, options?: AbortSignal | RecordingOperationOptions) {
    const settings = operationOptions(options);
    const observation = new Observation('download', settings.onObservation);
    return this.observed(observation, () => this.startDownload(id, settings, observation));
  }
  private async startDownload(
    id: string,
    settings: RecordingOperationOptions,
    observation: Observation,
  ) {
    const ref = this.reference(id),
      stationId = ref.stationId;
    observation.bind(this.connection, stationId);
    if (this.operations.has(stationId) || this.connection.busy(stationId))
      throw new EufyError('station_busy');
    // A standalone owner needs a cloud cipher for a record with any cipher ID, as
    // the vendor download checks. The client never fetches one, so refuse before
    // any connection or device command.
    if (
      this.connection.standalone?.(stationId) &&
      (ref.row.cipher_id as number | null | undefined) !== undefined
    )
      throw new EufyError('recording_cipher_unavailable');
    const camera = this.connection.camera(ref.row.device_sn);
    this.operations.add(stationId);
    const abort = AbortSignal.any([
      this.lifetime,
      AbortSignal.timeout(60000),
      ...(settings.signal ? [settings.signal] : []),
    ]);
    let station: Station | undefined;
    try {
      observation.stage = 'connect';
      station = await this.connection.station(
        stationId,
        abort,
        settings.onProgress,
        settings.onLookup,
      );
      observation.watch(station);
      observation.stage = 'transfer';
      const transfer = await downloadRecording(station, camera, ref.row, abort);
      const cleanup = transfer.completed
        .then(async (result) => {
          if (!result.complete) await station?.close();
          this.operations.delete(stationId);
        })
        .catch(() => {
          this.operations.delete(stationId);
        });
      this.transfers.add(cleanup);
      void cleanup.then(() => this.transfers.delete(cleanup));
      return transfer;
    } catch (error) {
      await station?.close();
      this.operations.delete(stationId);
      throw error;
    }
  }
  async close(): Promise<void> {
    this.references.clear();
    await Promise.allSettled(this.transfers);
  }
}
