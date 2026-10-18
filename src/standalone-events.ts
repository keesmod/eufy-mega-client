import type { PushMessage } from './vendor/push/models.js';
import type {
  StandalonePushObservation,
  StandalonePushRefusal,
  StandalonePushSource,
} from './types.js';

/**
 * ha-eufy-cam#185: the admission rule for pushes that name an experimental
 * standalone owner. Pure, no I/O. The rules are checked in a fixed order and the
 * first that fails is the refusal reason.
 */
export type PushSource = StandalonePushSource;
export interface StandaloneOwner {
  id: string;
  /** The inventory device type of the camera. */
  type: number;
  /** The exact profile allows standalone events. */
  events: boolean;
  /** The camera is initialised and neither it nor its session failed. */
  available: boolean;
  detects: (type: 'motion' | 'person') => boolean;
}
export type StandalonePushDecision =
  | { admitted: true; detection: 'motion' | 'person' }
  | { admitted: false; reason: StandalonePushRefusal };

const refusal = (reason: StandalonePushRefusal): StandalonePushDecision => ({
  admitted: false,
  reason,
});

export function decideStandalonePush(
  owner: StandaloneOwner,
  message: PushMessage,
): StandalonePushDecision {
  if (!owner.events) return refusal('events_not_enabled');
  if (!owner.available) return refusal('owner_unavailable');
  if (message.device_sn !== owner.id || message.station_sn !== owner.id)
    return refusal('serial_mismatch');
  if (message.type !== owner.type) return refusal('type_mismatch');
  // IndoorPushEvent motion and person detection only. Strict numbers.
  const detection =
    message.event_type === 3101 ? 'motion' : message.event_type === 3102 ? 'person' : undefined;
  if (detection === undefined || !owner.detects(detection)) return refusal('unsupported_event');
  return { admitted: true, detection };
}

const refusals: readonly StandalonePushRefusal[] = [
  'events_not_enabled',
  'owner_unavailable',
  'serial_mismatch',
  'type_mismatch',
  'unsupported_event',
];
const MAX_KEYS = 16;

/** Histogram key of one integer field. Nothing else of a message is kept. */
function key(value: unknown): string {
  if (value === undefined || value === null) return 'none';
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 99999
    ? String(value)
    : 'other';
}
function bump(histogram: Record<string, number>, value: unknown): void {
  let k = key(value);
  if (k !== 'none' && k !== 'other' && !Object.hasOwn(histogram, k)) {
    const numeric = Object.keys(histogram).filter((n) => n !== 'none' && n !== 'other').length;
    if (numeric >= MAX_KEYS) k = 'other';
  }
  histogram[k] = (histogram[k] ?? 0) + 1;
}

/** Numbers-only counts of standalone pushes. See StandalonePushObservation. */
export class StandalonePushCounter {
  private arrived = 0;
  private admitted = 0;
  private readonly refused = Object.fromEntries(refusals.map((r) => [r, 0])) as Record<
    StandalonePushRefusal,
    number
  >;
  private readonly sources: Record<StandalonePushSource, number> = { cloud: 0, local: 0 };
  private readonly eventCodes: Record<string, number> = Object.create(null);
  private readonly pushTypes: Record<string, number> = Object.create(null);
  record(decision: StandalonePushDecision, message: PushMessage, source: PushSource): void {
    this.arrived++;
    this.sources[source === 'local' ? 'local' : 'cloud']++;
    if (decision.admitted) this.admitted++;
    else this.refused[decision.reason]++;
    bump(this.eventCodes, message.event_type);
    bump(this.pushTypes, message.type);
  }
  snapshot(): StandalonePushObservation {
    return {
      arrived: this.arrived,
      admitted: this.admitted,
      refused: { ...this.refused },
      sources: { ...this.sources },
      eventCodes: { ...this.eventCodes },
      pushTypes: { ...this.pushTypes },
    };
  }
}
