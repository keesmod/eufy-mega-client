import { randomUUID, createHash } from 'node:crypto';
import type { PushMessage } from './vendor/push/models.js';
import type { PushSource } from './standalone-events.js';

export const detectionEvents = {
  'device motion detected': 'motion',
  'device person detected': 'person',
  'device stranger person detected': 'person',
  'device rings': 'ring',
  'device vehicle detected': 'vehicle',
  'device pet detected': 'pet',
  'device crying detected': 'crying',
  'device sound detected': 'sound',
  'device package delivered': 'package_delivered',
  'device package stranded': 'package_stranded',
  'device package taken': 'package_taken',
  'device someone loitering': 'loitering',
  'device radar motion detected': 'radar_motion',
  'device dog detected': 'dog',
  'device dog lick detected': 'dog_lick',
  'device dog poop detected': 'dog_poop',
} as const;

// Eufy's DoorbellPushEvent, IndoorPushEvent and HB3PairedDevicePushEvent codes.
const pushTypes: Record<number, string> = {
  3101: 'motion',
  3102: 'person',
  3103: 'ring',
  3104: 'crying',
  3105: 'sound',
  3106: 'pet',
  3107: 'vehicle',
  3108: 'dog',
  3109: 'dog_lick',
  3110: 'dog_poop',
  3111: 'person',
  3112: 'person',
  3301: 'package_delivered',
  3302: 'package_taken',
  3303: 'person',
  3304: 'package_stranded',
  3305: 'loitering',
  3306: 'radar_motion',
};
export const pushEventType = (message: PushMessage): string =>
  pushTypes[message.event_type ?? -1] ?? 'notification';

export type Recognition = 'known' | 'unknown' | 'unidentified' | 'not_applicable';
export interface Notification {
  id: string;
  serial: string;
  event_type: string;
  received_at: string;
  source: 'device' | 'push';
  person_name: string | null;
  recognition: Recognition;
  occurred_at: string | null;
  eufy_event_type?: number;
}
type Draft = Omit<Notification, 'id'>;
interface Pending {
  event: Draft;
  identities: Set<string>;
  /** Raw unique_id or event_session values, independent of event time. */
  ids: Set<string>;
  /** Push source and payload type, such as `local:18` or `cloud:97`. */
  transports: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}
/** A delivered push detection that a late copy of the same occurrence may still follow. */
interface Delivered {
  serial: string;
  event_type: string;
  eufy_event_type?: number;
  person_name: string | null;
  recognition: Recognition;
  received: number;
  occurred_at: string | null;
  ids: Set<string>;
  transports: Set<string>;
}
const recognitionRank: Record<Recognition, number> = {
  not_applicable: 0,
  unidentified: 1,
  unknown: 2,
  known: 3,
};
const timesAgree = (a: string | null, b: string | null) =>
  !a || !b || Math.abs(Date.parse(a) - Date.parse(b)) <= 1000;
type Kind = Pick<Draft, 'event_type' | 'eufy_event_type'>;
/**
 * The same detection type, where distinct unmapped codes stay distinct. An
 * equal code also matches a notification that a device event relabelled.
 */
const sameKind = (a: Kind, b: Kind) =>
  a.event_type === b.event_type
    ? a.event_type !== 'notification' ||
      a.eufy_event_type === undefined ||
      b.eufy_event_type === undefined ||
      a.eufy_event_type === b.eufy_event_type
    : a.eufy_event_type !== undefined && a.eufy_event_type === b.eufy_event_type;

export function personName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name &&
    name.length <= 128 &&
    !['unknown', 'unknown person', 'unbekannt', 'onbekend'].includes(name.toLowerCase())
    ? name
    : null;
}
function occurredAt(value: unknown): string | null {
  const time =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : NaN;
  const ms = time < 1e12 ? time * 1000 : time;
  return Number.isFinite(ms) && ms >= 946684800000 && ms <= 4102444800000
    ? new Date(ms).toISOString()
    : null;
}

/** One actionable detection, never SDK property resets or raw transport copies. */
export class Detections {
  readonly metrics = {
    push_connected: false,
    received: 0,
    duplicates: 0,
    last_received_at: null as string | null,
  };
  private pending = new Set<Pending>();
  private delivered: Delivered[] = [];
  private seen = new Map<string, number>();
  private lastPush = new Map<string, number>();
  /**
   * settleMs delays delivery. companionMs bounds how long after the first copy
   * a late copy of the same occurrence is still recognised. A HomeBase sends a
   * local copy without event time and the cloud copy can follow 0.5 to 0.7 s
   * later, and a Video Doorbell S4 can send two cloud copies (ha-eufy-cam#252).
   */
  constructor(
    private known: (serial: string) => boolean,
    private deliver: (event: Notification) => void,
    private changed: () => void,
    private settleMs = 500,
    private companionMs = 2000,
  ) {}

  /** `source` tells a cloud push from a push over an open device session. */
  push(message: PushMessage, source: PushSource = 'cloud'): void {
    const serial = message.device_sn || message.station_sn;
    if (!this.known(serial)) return;
    const now = Date.now();
    for (const [key, expires] of this.seen) if (expires <= now) this.seen.delete(key);
    const type = pushEventType(message);
    const occurred_at = occurredAt(message.event_time);
    const identity = message.unique_id || message.event_session;
    const key =
      identity || occurred_at
        ? createHash('sha256')
            .update(JSON.stringify([serial, type, identity || null, occurred_at]))
            .digest('hex')
        : undefined;
    if (key && this.seen.has(key)) {
      this.metrics.duplicates++;
      return;
    }
    const name = type === 'person' ? personName(message.person_name) : null;
    const event: Draft = {
      serial,
      event_type: type,
      received_at: new Date(now).toISOString(),
      source: 'push',
      occurred_at,
      person_name: name,
      recognition:
        type !== 'person'
          ? 'not_applicable'
          : name || [3111, 3303].includes(message.event_type!)
            ? 'known'
            : message.event_type === 3112
              ? 'unknown'
              : 'unidentified',
      ...(Number.isSafeInteger(message.event_type) ? { eufy_event_type: message.event_type } : {}),
    };
    const transport = `${source}:${message.type ?? 'none'}`;
    const id = identity ? String(identity) : undefined;
    // Distinct IDs in the SAME format are distinct detections, even very close
    // together. Cross-format companions, and copies with the same raw identity,
    // are correlated within the settling window. A candidate with the same key,
    // then one with the same identity, comes before a transport-only match.
    const candidates = [...this.pending].filter(
      (p) =>
        p.event.serial === serial &&
        ((p.event.source === 'device' &&
          (p.event.event_type === type ||
            p.event.event_type === 'motion' ||
            type === 'notification')) ||
          (sameKind(p.event, event) &&
            ((key !== undefined && p.identities.has(key)) ||
              ((!p.transports.has(transport) || (id !== undefined && p.ids.has(id))) &&
                timesAgree(occurred_at, p.event.occurred_at)) ||
              (!key && p.identities.size === 0)))),
    );
    const existing =
      candidates.find((p) => key !== undefined && p.identities.has(key)) ??
      candidates.find((p) => id !== undefined && p.ids.has(id)) ??
      candidates[0];
    this.lastPush.set(serial, now);
    if (existing) {
      const previous = existing.event;
      existing.event = {
        ...event,
        received_at: previous.received_at,
        occurred_at: event.occurred_at ?? previous.occurred_at,
      };
      if (type === 'notification' && previous.event_type !== 'notification') {
        existing.event.event_type = previous.event_type;
        existing.event.person_name = previous.person_name;
        existing.event.recognition = previous.recognition;
      }
      if (!name && previous.event_type === 'person' && type === 'person' && previous.person_name) {
        existing.event.person_name = previous.person_name;
        existing.event.recognition = 'known';
      } else if (
        previous.event_type === 'person' &&
        type === 'person' &&
        recognitionRank[previous.recognition] > recognitionRank[existing.event.recognition]
      )
        existing.event.recognition = previous.recognition;
      this.metrics.duplicates++;
      if (key) existing.identities.add(key);
      if (id) existing.ids.add(id);
      existing.transports.add(transport);
    } else if (this.lateCopy(event, transport, id, now)) {
      this.metrics.duplicates++;
      if (key) this.remember([key]);
    } else this.queue(event, key, transport, id);
  }

  /**
   * A copy that arrives after its occurrence was delivered: with the same raw
   * identity, or over another transport. Event times, when both copies carry
   * one, agree within a second. Distinct identities over the same transport
   * stay distinct detections. A copy that adds a person name or a stronger
   * recognition than every candidate is delivered, not dropped.
   */
  private lateCopy(event: Draft, transport: string, id: string | undefined, now: number): boolean {
    this.delivered = this.delivered.filter((d) => now - d.received <= this.companionMs);
    const occurred = event.occurred_at === null ? undefined : Date.parse(event.occurred_at);
    const candidates = this.delivered.filter((d) => {
      if (
        d.serial !== event.serial ||
        !sameKind(d, event) ||
        !timesAgree(event.occurred_at, d.occurred_at)
      )
        return false;
      if (id !== undefined && d.ids.has(id)) return true;
      // Only the transport ties these copies. When the delivered copy has no
      // event time, the copy must have occurred around the time the first copy
      // arrived, which assumes the device and host clocks agree.
      return (
        !d.transports.has(transport) &&
        (d.occurred_at !== null ||
          occurred === undefined ||
          (occurred >= d.received - 2000 && occurred <= d.received + 1000))
      );
    });
    const match = [
      ...candidates.filter((d) => id !== undefined && d.ids.has(id)),
      ...candidates,
    ].find(
      (d) =>
        recognitionRank[event.recognition] <= recognitionRank[d.recognition] &&
        (event.person_name === null || event.person_name === d.person_name),
    );
    if (!match) return false;
    match.transports.add(transport);
    if (id) match.ids.add(id);
    match.occurred_at ??= event.occurred_at;
    return true;
  }

  device(serial: string, type: string, rawName?: string, stranger = false): void {
    const name = type === 'person' ? personName(rawName) : null;
    const pending = [...this.pending].filter((p) => p.event.serial === serial);
    const push = pending.find((p) => p.event.source === 'push' && p.event.event_type === type);
    const undecoded = pending.find(
      (p) => p.event.source === 'push' && p.event.event_type === 'notification',
    );
    if (undecoded) {
      undecoded.event.event_type = type;
      undecoded.event.person_name = name;
      undecoded.event.recognition =
        type === 'person'
          ? name
            ? 'known'
            : stranger
              ? 'unknown'
              : 'unidentified'
          : 'not_applicable';
    }
    if (push && name) {
      push.event.person_name = name;
      push.event.recognition = 'known';
    }
    // SDK simultaneousDetections synthesizes motion from people/vehicle alerts.
    // Prefer the upstream event, with its actual occurrence identity.
    if (
      pending.some((p) => p.event.source === 'push') ||
      Date.now() - (this.lastPush.get(serial) ?? -Infinity) < 1500
    ) {
      this.metrics.duplicates++;
      return;
    }
    const existing = pending.find(
      (p) =>
        p.event.source === 'device' &&
        (p.event.event_type === type || p.event.event_type === 'motion' || type === 'motion'),
    );
    const event: Draft = {
      serial,
      event_type: type,
      received_at: new Date().toISOString(),
      source: 'device',
      occurred_at: null,
      person_name: name,
      recognition:
        type === 'person'
          ? name
            ? 'known'
            : stranger
              ? 'unknown'
              : 'unidentified'
          : 'not_applicable',
    };
    if (existing) {
      // Merge the SDK's identity/person flags and generic motion fallback.
      if (type !== 'motion' || existing.event.event_type === 'motion')
        existing.event = {
          ...event,
          received_at: existing.event.received_at,
          person_name: name ?? existing.event.person_name,
          recognition: name || existing.event.person_name ? 'known' : event.recognition,
        };
      this.metrics.duplicates++;
    } else this.queue(event);
  }

  private queue(event: Draft, key?: string, transport?: string, id?: string): void {
    if (this.pending.size >= 256) this.flush(this.pending.values().next().value!);
    const pending: Pending = {
      event,
      identities: new Set(key ? [key] : []),
      ids: new Set(id ? [id] : []),
      transports: new Set(transport === undefined ? [] : [transport]),
      timer: setTimeout(() => this.flush(pending), this.settleMs),
    };
    pending.timer.unref();
    this.pending.add(pending);
  }
  private flush(pending: Pending): void {
    clearTimeout(pending.timer);
    this.pending.delete(pending);
    if (!this.known(pending.event.serial)) return;
    this.remember(pending.identities);
    if (pending.event.source === 'push') {
      this.delivered.push({
        serial: pending.event.serial,
        event_type: pending.event.event_type,
        eufy_event_type: pending.event.eufy_event_type,
        person_name: pending.event.person_name,
        recognition: pending.event.recognition,
        received: Date.parse(pending.event.received_at),
        occurred_at: pending.event.occurred_at,
        ids: pending.ids,
        transports: pending.transports,
      });
      if (this.delivered.length > 256) this.delivered.shift();
    }
    this.metrics.received++;
    this.metrics.last_received_at = pending.event.received_at;
    this.deliver({ ...pending.event, id: randomUUID() });
    this.changed();
  }
  private remember(keys: Iterable<string>): void {
    for (const key of keys) this.seen.set(key, Date.now() + 300_000);
    while (this.seen.size > 2048) this.seen.delete(this.seen.keys().next().value!);
  }
  exportSeen(): Record<string, number> {
    return Object.fromEntries([...this.seen].filter(([, expiry]) => expiry > Date.now()));
  }
  restoreSeen(saved: Record<string, number>): void {
    for (const [key, expiry] of Object.entries(saved).slice(-2048))
      if (
        /^[a-f0-9]{64}$/.test(key) &&
        Number.isFinite(expiry) &&
        expiry > Date.now() &&
        expiry <= Date.now() + 300000
      )
        this.seen.set(key, expiry);
  }
  close(): void {
    for (const p of this.pending) clearTimeout(p.timer);
    this.pending.clear();
    this.delivered = [];
    this.lastPush.clear();
    this.metrics.push_connected = false;
  }
}
