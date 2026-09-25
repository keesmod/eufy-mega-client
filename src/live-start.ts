import type { EventEmitter } from 'node:events';
import type { LiveStartProgress, LiveStartStage } from './types.js';
import type { CommandResult } from './vendor/p2p/models.js';
import { CommandType } from './vendor/p2p/types.js';
import { ParamType } from './vendor/http/types.js';

/**
 * Command types a station's answer to START carries: plain START, START nested
 * in a payload command, the record view start and the doorbell payload start.
 * The P2P session reports the nested type when there is one.
 */
const startCommands = new Set<number>([
  CommandType.CMD_START_REALTIME_MEDIA,
  CommandType.CMD_RECORD_VIEW,
  ParamType.COMMAND_START_LIVESTREAM,
]);
const elapsed = (value: number) => Math.min(3_600_000, Math.max(0, Math.round(value)));
const int32 = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= -2_147_483_648 &&
  value <= 2_147_483_647;

/** Reports each stage of one live start once, in the order observed. Never throws. */
export class LiveStartObserver {
  private readonly started = performance.now();
  private readonly seen = new Set<LiveStartStage>();
  constructor(private readonly callback?: (progress: LiveStartProgress) => void) {}
  mark(stage: LiveStartStage, returnCode?: number): void {
    if (!this.callback || this.seen.has(stage)) return;
    this.seen.add(stage);
    const progress: LiveStartProgress = {
      stage,
      elapsedMs: elapsed(performance.now() - this.started),
    };
    if (stage === 'start_result' && int32(returnCode)) progress.returnCode = returnCode;
    try {
      this.callback(progress);
    } catch {
      // A consumer's failure never alters the start.
    }
  }
  /**
   * Listens on the session that carries the start for the station's answer to
   * START and for the library ending the stream without media. Returns the
   * function that removes both listeners.
   */
  watch(station: EventEmitter, channel: number): () => void {
    if (!this.callback) return () => {};
    const result = (_station: unknown, command: CommandResult) => {
      if (command?.channel === channel && startCommands.has(command.command_type))
        this.mark('start_result', command.return_code);
    };
    const noData = (_station: unknown, stream: number) => {
      if (stream === channel) this.mark('no_data_end');
    };
    station.on('command result', result);
    station.on('livestream no data', noData);
    return () => {
      station.off('command result', result);
      station.off('livestream no data', noData);
    };
  }
}
