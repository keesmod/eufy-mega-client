import type { AccessoryRow } from './discovery.js';
import type {
  AccessoryCategory,
  AccessoryObservation,
  AccessoryParameterReport,
  AccessoryParameterRoute,
  AccessoryParameters,
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

/**
 * ha-eufy-cam#286: the keypad battery keys whose raw codes are kept as evidence,
 * battery level 1101 and the vendored keypad battery, temperature and charger
 * states 1653, 1654 and 1655. No other value is kept, so keypad codes and
 * settings never leave the store.
 */
const KEYPAD_CODE_KEYS: ReadonlySet<number> = new Set([1101, 1653, 1654, 1655]);
/** At most this many parameter types per route and keypad, besides the battery keys. */
const PARAMETER_TYPE_LIMIT = 64;
const ROUTES: readonly AccessoryParameterRoute[] = ['cloud', 'camera_info', 'hub_notify'];

/** A short integer as its decimal text, anything else `other`. */
function parameterCode(value: unknown): string {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && Math.abs(value) < 1e6 ? String(value) : 'other';
  return typeof value === 'string' && /^-?[0-9]{1,6}$/.test(value) ? value : 'other';
}

interface RouteEvidence {
  types: Set<number>;
  codes: Map<number, string>;
}
const emptyEvidence = (): Record<AccessoryParameterRoute, RouteEvidence> => ({
  cloud: { types: new Set(), codes: new Map() },
  camera_info: { types: new Set(), codes: new Map() },
  hub_notify: { types: new Set(), codes: new Map() },
});

/** The reading a parameter key sets for this category, if any. */
export function readingName(category: AccessoryCategory, key: number): ReadingName | undefined {
  return Object.hasOwn(KEYS[category], key) ? KEYS[category][key] : undefined;
}

/**
 * A strict boolean. Contact and battery low are 0 or 1. Charging follows the
 * vendored keypad conversion, 0 and 2 false, 1 and 3 true. A keypad also sends
 * battery state 2 while the eufy app shows its battery full, so for a keypad 2
 * is not low (ha-eufy-cam#286). Anything else, including text such as "true" or
 * "01", is invalid.
 */
export function readingValue(
  category: AccessoryCategory,
  name: ReadingName,
  value: unknown,
): boolean | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^(?:0|[1-9][0-9]{0,2})$/.test(value)
        ? Number(value)
        : NaN;
  if (name === 'charging')
    return n === 0 || n === 2 ? false : n === 1 || n === 3 ? true : undefined;
  if (category === 'keypad' && name === 'batteryLow' && n === 2) return false;
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
  /** ha-eufy-cam#286: keypads only, the parameters each route carried. */
  parameters?: Record<AccessoryParameterRoute, RouteEvidence>;
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
      if (record.category === 'keypad') {
        // The inventory is read anew each time, so its evidence is replaced.
        record.parameters ??= emptyEvidence();
        record.parameters.cloud = { types: new Set(), codes: new Map() };
        for (const p of params)
          if (p && typeof p === 'object')
            this.noteParameter(record, 'cloud', p.param_type, p.param_value, true);
      }
      for (const name of NAMES[record.category]) {
        const current = record.readings[name];
        if (current && current.source !== 'cloud') continue;
        const param = params.findLast(
          (p) => p && typeof p === 'object' && readingName(record.category, p.param_type) === name,
        );
        const value = param ? readingValue(record.category, name, param.param_value) : undefined;
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
  /**
   * ha-eufy-cam#286: one parameter a route carried for this accessory. Only a
   * keypad keeps it. Its type is always kept, its value only for a battery key.
   */
  parameter(id: string, route: AccessoryParameterRoute, type: unknown, value: unknown): void {
    const record = this.records.get(id);
    if (record) this.noteParameter(record, route, type, value, true);
  }
  /** ha-eufy-cam#286: a parameter type a route carried, without its value. */
  parameterType(id: string, route: AccessoryParameterRoute, type: unknown): void {
    const record = this.records.get(id);
    if (record) this.noteParameter(record, route, type, undefined, false);
  }
  private noteParameter(
    record: Entry,
    route: AccessoryParameterRoute,
    type: unknown,
    value: unknown,
    withCode: boolean,
  ): void {
    if (record.category !== 'keypad') return;
    if (typeof type === 'string' && /^[0-9]{1,5}$/.test(type)) type = Number(type);
    if (typeof type !== 'number' || !Number.isSafeInteger(type) || type < 0 || type > 65535) return;
    record.parameters ??= emptyEvidence();
    const evidence = record.parameters[route];
    const kept = [...evidence.types].filter((t) => !KEYPAD_CODE_KEYS.has(t)).length;
    if (!evidence.types.has(type) && !KEYPAD_CODE_KEYS.has(type) && kept >= PARAMETER_TYPE_LIMIT)
      return;
    evidence.types.add(type);
    if (withCode && KEYPAD_CODE_KEYS.has(type)) evidence.codes.set(type, parameterCode(value));
  }
  /**
   * ha-eufy-cam#286: the parameters of an admitted keypad by route, with the
   * newest raw code of each battery key. Undefined for any other ID.
   */
  parameters(id: string): AccessoryParameters | undefined {
    const record = this.records.get(id);
    if (!record || record.category !== 'keypad') return undefined;
    const evidence = record.parameters ?? emptyEvidence();
    const report = (route: AccessoryParameterRoute): AccessoryParameterReport => ({
      types: [...evidence[route].types].sort((a, b) => a - b),
      codes: Object.fromEntries(
        [...evidence[route].codes]
          .sort(([a], [b]) => a - b)
          .map(([type, code]) => [String(type), code]),
      ),
    });
    return Object.fromEntries(ROUTES.map((route) => [route, report(route)])) as AccessoryParameters;
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
      } else if (record.p2pTimes[name] !== undefined) this.counts.conflicts++;
    }
    if (source === 'p2p') {
      record.p2pTimes[name] = changes ? now : Math.max(record.p2pTimes[name] ?? now, now);
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
