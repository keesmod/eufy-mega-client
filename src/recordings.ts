import { randomUUID } from 'node:crypto';
import type { Station } from './vendor/http/station.js';
import type { Device } from './vendor/http/device.js';
import type { DatabaseQueryByDate, DatabaseCountByDate } from './vendor/p2p/interfaces.js';
import { awaitEvent } from './operations.js';
import { downloadRecording } from './download.js';
import { EufyError, type Recording } from './types.js';

interface Connection {
  station(id: string, signal: AbortSignal): Promise<Station>;
  camera(id: string): Device;
  knownCamera(id: string, stationId: string): boolean;
  busy(id: string): boolean;
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

/** Recording references originate exclusively from a complete HomeBase query. */
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
  private async run<T>(
    id: string,
    signal: AbortSignal | undefined,
    action: (station: Station, abort: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.operations.has(id) || this.connection.busy(id)) throw new EufyError('station_busy');
    this.operations.add(id);
    const abort = AbortSignal.any([
      this.lifetime,
      AbortSignal.timeout(60000),
      ...(signal ? [signal] : []),
    ]);
    let station: Station | undefined;
    try {
      station = await this.connection.station(id, abort);
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
  ): Promise<DatabaseQueryByDate[]> {
    return awaitEvent(
      station,
      'database query by date',
      () => station.databaseQueryByDate([], start, end, 0, 0, 0, limit),
      (_s, code, rows) => {
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
    signal?: AbortSignal,
  ): Promise<{ recordings: Recording[]; complete: true; returned: number }> {
    const start = calendarDate(day),
      end = new Date(start);
    end.setDate(end.getDate() + 1);
    if (cameraIds?.some((id) => !this.connection.knownCamera(id, stationId)))
      throw new EufyError('invalid_camera_filter');
    return this.run(stationId, signal, async (station, abort) => {
      const rows = await completeHistory((limit) => this.page(station, start, end, limit, abort));
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
  async calendar(stationId: string, month: string, signal?: AbortSignal): Promise<string[]> {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new EufyError('invalid_recording_date');
    const start = calendarDate(month + '-01'),
      end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return this.run(stationId, signal, async (station, abort) => {
      const rows = await awaitEvent<DatabaseCountByDate[]>(
        station,
        'database count by date',
        () => station.databaseCountByDate(start, end),
        (_s, code, rows) => {
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
  async thumbnail(id: string, signal?: AbortSignal): Promise<Buffer> {
    const ref = this.reference(id),
      path = ref.row.thumb_path;
    if (typeof path !== 'string' || !path || path.length > 2048)
      throw new EufyError('thumbnail_unavailable');
    this.connection.camera(ref.row.device_sn);
    return this.run(ref.stationId, signal, (station, abort) =>
      awaitEvent(
        station,
        'image download',
        () => station.downloadImage(path),
        (_s, file, data) => {
          if (file !== path) return undefined;
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
  async download(id: string, signal?: AbortSignal) {
    const ref = this.reference(id),
      stationId = ref.stationId;
    if (this.operations.has(stationId) || this.connection.busy(stationId))
      throw new EufyError('station_busy');
    const camera = this.connection.camera(ref.row.device_sn);
    this.operations.add(stationId);
    const abort = AbortSignal.any([
      this.lifetime,
      AbortSignal.timeout(60000),
      ...(signal ? [signal] : []),
    ]);
    let station: Station | undefined;
    try {
      station = await this.connection.station(stationId, abort);
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
