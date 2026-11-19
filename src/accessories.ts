import type { AccessoryRow } from './discovery.js';
import type {
  AccessoryCategory,
  AccessoryObservation,
  AccessoryReading,
  AccessoryState,
  WireDevice,
} from './types.js';

/**
 * ha-eufy-cam#275: the reading store of admitted HomeBase accessories and the
 * counts of how their state arrived. Pure, no I/O and no timers. The device
 * transport feeds it from the HomeBase session and the push service.
 */
export type ReadingName = 'open' | 'batteryLow' | 'charging';

// The vendored property keys of each category (vendor/src/http/types.ts, the
// SENSOR and KEYPAD property tables). No other parameter is read.
const KEYS: Readonly<Record<AccessoryCategory, Readonly<Record<number, ReadingName>>>> = {
  entry_sensor: { 1550: 'open', 1552: 'batteryLow' },
  keypad: { 1653: 'batteryLow', 1655: 'charging' },
  chime: {},
};
const NAMES: Readonly<Record<AccessoryCategory, readonly ReadingName[]>> = {
  entry_sensor: ['open', 'batteryLow'],
  keypad: ['batteryLow', 'charging'],
  chime: [],
};

/** The reading a parameter key sets for this category, if any. */
export function readingName(category: AccessoryCategory, key: number): ReadingName | undefined {
  return Object.hasOwn(KEYS[category], key) ? KEYS[category][key] : undefined;
}

/**
 * A strict boolean. Contact and battery low are 0 or 1. Charging follows the
 * vendored keypad conversion, 0 and 2 false, 1 and 3 true. Anything else,
 * including text such as "true" or "01", is invalid.
 */
export function readingValue(name: ReadingName, value: unknown): boolean | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^(?:0|[1-9][0-9]{0,2})$/.test(value)
        ? Number(value)
        : NaN;
  if (name === 'charging')
    return n === 0 || n === 2 ? false : n === 1 || n === 3 ? true : undefined;
  return n === 0 ? false : n === 1 ? true : undefined;
}

interface Entry {
  id: string;
  category: AccessoryCategory;
  stationId: string | null;
  model: string;
  type: number;
  parent: string;
  /** Integer device channel on its HomeBase, `null` when the row has none. */
  channel: number | null;
  readings: Partial<Record<ReadingName, AccessoryReading<boolean>>>;
  /**
   * When each reading's current value was last asserted. `pushTimes` holds the
   * newest push event time (push clock), `p2pTimes` the newest local P2P receipt
   * time. Each source only sets its own time. A change of value clears the other.
   */
  pushTimes: Partial<Record<ReadingName, number>>;
  p2pTimes: Partial<Record<ReadingName, number>>;
}

export type Observed = 'changed' | 'same' | 'late';

export type AccessoryCount = keyof AccessoryObservation;

const channelOf = (raw: WireDevice): number | null =>
  Number.isSafeInteger(raw.device_channel) && raw.device_channel >= 0 && raw.device_channel <= 255
    ? raw.device_channel
    : null;

/**
 * Push event times come from another clock than local receipt and often have
 * one-second resolution (ha-eufy-cam#275).
 */
const PUSH_CLOCK_ALLOWANCE_MS = 2000;
/** A push event time further ahead of local time than this gives no order. */
const PUSH_FUTURE_LIMIT_MS = 5 * 60 * 1000;
export class AccessoryStore {
  private records = new Map<string, Entry>();
  private readonly counts: AccessoryObservation = {
    hub_notify: 0,
    sensor_status: 0,
    push_door_sensor: 0,
    camera_info: 0,
    cloud_seeded: 0,
    conflicts: 0,
    unknown_channel: 0,
  };

  /**
   * Replaces the admitted set. A row with the same model, type, parent and
   * channel keeps its P2P and push readings. Inventory values fill only readings
   * without one and are labelled `cloud`.
   */
  load(rows: Iterable<[string, AccessoryRow]>, now = new Date()): void {
    const previous = this.records;
    this.records = new Map();
    for (const [id, { raw, profile, stationId }] of rows) {
      const before = previous.get(id);
      const record: Entry =
        before &&
        before.model === raw.device_model &&
        before.type === raw.device_type &&
        before.parent === raw.parent_sn &&
        before.channel === channelOf(raw) &&
        before.stationId === stationId
          ? before
          : {
              id,
              category: profile.category,
              stationId,
              model: raw.device_model,
              type: raw.device_type,
              parent: raw.parent_sn,
              channel: channelOf(raw),
              readings: {},
              pushTimes: {},
              p2pTimes: {},
            };
      const params = Array.isArray(raw.params) ? raw.params : [];
      for (const name of NAMES[record.category]) {
        const current = record.readings[name];
        if (current && current.source !== 'cloud') continue;
        const param = params.findLast(
          (p) => p && typeof p === 'object' && readingName(record.category, p.param_type) === name,
        );
        const value = param ? readingValue(name, param.param_value) : undefined;
        if (value === undefined) delete record.readings[name];
        else {
          record.readings[name] = {
            value,
            source: 'cloud',
            observedAt: now.toISOString(),
            live: false,
          };
          this.counts.cloud_seeded++;
        }
      }
      this.records.set(id, record);
    }
  }
  has(id: string): boolean {
    return this.records.has(id);
  }
  ids(): string[] {
    return [...this.records.keys()];
  }
  category(id: string): AccessoryCategory | undefined {
    return this.records.get(id)?.category;
  }
  stationOf(id: string): string | null | undefined {
    return this.records.get(id)?.stationId;
  }
  /** Whether any admitted entry sensor or keypad belongs to this HomeBase. */
  hasStation(stationId: string): boolean {
    for (const record of this.records.values()) if (record.stationId === stationId) return true;
    return false;
  }
  /** Admitted keypads of this HomeBase. */
  keypads(stationId: string): string[] {
    return [...this.records.values()]
      .filter((r) => r.category === 'keypad' && r.stationId === stationId)
      .map((r) => r.id);
  }
  /**
   * The one accessory of this HomeBase on this channel. `taken` holds the
   * channels of that HomeBase's cameras. A shared channel matches nothing.
   */
  byChannel(
    stationId: string,
    channel: number,
    taken: ReadonlySet<number>,
  ): string | 'ambiguous' | undefined {
    const matches = [...this.records.values()].filter(
      (r) => r.stationId === stationId && r.channel === channel,
    );
    if (matches.length === 0) return undefined;
    return matches.length > 1 || taken.has(channel) ? 'ambiguous' : matches[0]!.id;
  }
  state(id: string): AccessoryState | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    const readings: AccessoryState['readings'] = {};
    for (const name of NAMES[record.category])
      readings[name] = record.readings[name] ? { ...record.readings[name] } : null;
    return { id, stationId: record.stationId, category: record.category, readings };
  }
  /**
   * One P2P or push value. A timed push older than the newest assertion of the
   * current value never replaces it. Push times compare with push times, and a
   * local P2P receipt time with an allowance for the push clock.
   */
  observe(
    id: string,
    name: ReadingName,
    value: boolean,
    source: 'p2p' | 'push',
    eventTime?: number,
    now = Date.now(),
  ): Observed {
    const record = this.records.get(id);
    if (!record || !NAMES[record.category].includes(name)) return 'same';
    const current = record.readings[name];
    const timed =
      eventTime !== undefined &&
      Number.isFinite(eventTime) &&
      eventTime > 0 &&
      eventTime <= now + PUSH_FUTURE_LIMIT_MS;
    const changes = !current || current.source === 'cloud' || current.value !== value;
    if (source === 'push' && changes && current && current.source !== 'cloud') {
      if (timed) {
        // Push to push compares one clock. A P2P receipt is local time, so it
        // gets an allowance for the push clock and its resolution.
        const pushed = record.pushTimes[name] ?? -Infinity;
        const received = record.p2pTimes[name];
        const reference = Math.max(
          pushed,
          received === undefined ? -Infinity : received - PUSH_CLOCK_ALLOWANCE_MS,
        );
        if (eventTime < reference) return 'late';
      } else if (current.source === 'p2p') this.counts.conflicts++;
    }
    if (source === 'p2p') {
      record.p2pTimes[name] = now;
      if (changes) delete record.pushTimes[name];
    } else if (timed) {
      // An older push of the same value never moves the reference back.
      record.pushTimes[name] = changes
        ? eventTime
        : Math.max(record.pushTimes[name] ?? eventTime, eventTime);
      if (changes) delete record.p2pTimes[name];
    } else if (changes) {
      // An untimed change has no order, so the next timed push applies.
      delete record.pushTimes[name];
      delete record.p2pTimes[name];
    }
    const at = new Date(now).toISOString();
    if (!changes && current) {
      const wasLive = current.live;
      current.observedAt = at;
      current.live = true;
      return wasLive ? 'same' : 'changed';
    }
    record.readings[name] = { value, source, observedAt: at, live: true };
    return 'changed';
  }
  /** The HomeBase session closed. Values stay, `live` becomes false. Returns changed IDs. */
  close(stationId: string): string[] {
    const changed: string[] = [];
    for (const record of this.records.values()) {
      if (record.stationId !== stationId) continue;
      let any = false;
      for (const reading of Object.values(record.readings))
        if (reading?.live) {
          reading.live = false;
          any = true;
        }
      if (any) changed.push(record.id);
    }
    return changed;
  }
  clear(): void {
    this.records.clear();
  }

  count(key: AccessoryCount): void {
    this.counts[key]++;
  }
  snapshot(): AccessoryObservation {
    return { ...this.counts };
  }
}
