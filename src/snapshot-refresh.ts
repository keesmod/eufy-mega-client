import type {
  SnapshotDownloadOutcome,
  SnapshotEventCount,
  SnapshotQueryTrigger,
  SnapshotRefreshCounts,
  SnapshotRefreshObservation,
  SnapshotRowOutcome,
} from './types.js';

const triggers: readonly SnapshotQueryTrigger[] = ['push', 'request', 'connect'];
const rowOutcomes: readonly SnapshotRowOutcome[] = [
  'no_row',
  'homebase_path',
  'unchanged_path',
  'cloud_path_only',
  'no_path',
  'invalid_path',
];
const eventCounts: readonly SnapshotEventCount[] = [
  'first',
  'increased',
  'unchanged',
  'decreased',
  'unavailable',
];
const downloadOutcomes: readonly SnapshotDownloadOutcome[] = [
  'kept',
  'not_jpeg',
  'too_large',
  'superseded',
  'no_reply',
];
/** Model keys before `other`. */
const MODELS = 16;

const zeros = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
const perTrigger = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(triggers.map((trigger) => [trigger, zeros(keys)])) as Record<
    SnapshotQueryTrigger,
    Record<K, number>
  >;
const emptyCounts = (): SnapshotRefreshCounts => ({
  rows: perTrigger(rowOutcomes),
  eventCounts: perTrigger(eventCounts),
  downloads: zeros(downloadOutcomes),
});

/**
 * ha-eufy-cam#293: numbers-only counts of the snapshot refresh from latest
 * event rows, keyed by camera model. It never stores a serial or path.
 */
export class SnapshotRefreshCounter {
  private readonly replies = zeros(triggers);
  private failedReplies = 0;
  private readonly models = new Map<string, SnapshotRefreshCounts>();
  reply(trigger: SnapshotQueryTrigger, ok: boolean): void {
    if (ok) this.replies[trigger]++;
    else this.failedReplies++;
  }
  row(
    model: unknown,
    trigger: SnapshotQueryTrigger,
    outcome: SnapshotRowOutcome,
    change: SnapshotEventCount,
  ): void {
    const counts = this.counts(model);
    counts.rows[trigger][outcome]++;
    if (outcome !== 'no_row') counts.eventCounts[trigger][change]++;
  }
  download(model: unknown, outcome: SnapshotDownloadOutcome): void {
    this.counts(model).downloads[outcome]++;
  }
  snapshot(): SnapshotRefreshObservation {
    const models: Record<string, SnapshotRefreshCounts> = Object.create(null);
    for (const [model, counts] of this.models)
      models[model] = {
        rows: Object.fromEntries(
          triggers.map((trigger) => [trigger, { ...counts.rows[trigger] }]),
        ) as SnapshotRefreshCounts['rows'],
        eventCounts: Object.fromEntries(
          triggers.map((trigger) => [trigger, { ...counts.eventCounts[trigger] }]),
        ) as SnapshotRefreshCounts['eventCounts'],
        downloads: { ...counts.downloads },
      };
    return { replies: { ...this.replies }, failedReplies: this.failedReplies, models };
  }
  private counts(model: unknown): SnapshotRefreshCounts {
    let key = typeof model === 'string' && model ? model : 'unknown';
    if (!this.models.has(key) && this.models.size >= MODELS) key = 'other';
    let counts = this.models.get(key);
    if (!counts) this.models.set(key, (counts = emptyCounts()));
    return counts;
  }
}

/** How `event_count` changed against the previous value, which the caller keeps. */
export function eventCountChange(previous: number | undefined, value: unknown): SnapshotEventCount {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return 'unavailable';
  if (previous === undefined) return 'first';
  return (value as number) > previous
    ? 'increased'
    : (value as number) < previous
      ? 'decreased'
      : 'unchanged';
}
