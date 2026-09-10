import type { Station } from './vendor/http/station.js';
import type { CommandResult } from './vendor/p2p/models.js';
import { CommandType } from './vendor/p2p/types.js';
import { PropertyName } from './vendor/http/types.js';
import { awaitEvent } from './operations.js';
import { EufyError } from './types.js';

export const guardModes = new Set([0, 1, 2, 3, 4, 5, 47, 63]);

/** Repeated P2P values count as observations; cached cloud values never do. */
export async function readGuardMode(station: Station, signal: AbortSignal): Promise<number> {
  return awaitEvent(
    station,
    'parameter observed',
    () => station.getCameraInfo(),
    (_s, type, value, source) => {
      const mode = Number(value);
      return type === CommandType.CMD_SET_ARMING && source === 'p2p' && guardModes.has(mode)
        ? mode
        : undefined;
    },
    signal,
    10000,
  );
}

/** One write, followed by a device read. An ACK alone cannot complete this. */
export function changeGuardMode(
  station: Station,
  mode: number,
  signal: AbortSignal,
  timeoutMs = 20000,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new EufyError('cancelled'));
  return new Promise((resolve, reject) => {
    let acknowledged = false,
      observed = false,
      done = false;
    const clean = () => {
      clearTimeout(timer);
      station.off('command result', command);
      station.off('parameter observed', observation);
      station.off('close', closed);
      signal.removeEventListener('abort', cancel);
    };
    const finish = (error?: EufyError) => {
      if (done) return;
      done = true;
      clean();
      error ? reject(error) : resolve();
    };
    const command = (_s: Station, result: CommandResult) => {
      const property = result.customData?.property;
      if (
        result.command_type !== CommandType.CMD_SET_ARMING ||
        property?.name !== PropertyName.StationGuardMode ||
        Number(property.value) !== mode
      )
        return;
      if (result.return_code !== 0) {
        finish(new EufyError('guard_mode_rejected', result.return_code));
        return;
      }
      acknowledged = true;
      // Confirm with telemetry obtained after the command was acknowledged.
      try {
        station.getCameraInfo();
      } catch {
        finish(new EufyError('guard_mode_unconfirmed'));
      }
    };
    const observation = (_s: Station, type: number, value: string, source: string) => {
      if (
        acknowledged &&
        type === CommandType.CMD_SET_ARMING &&
        source === 'p2p' &&
        Number(value) === mode
      )
        observed = true;
      if (acknowledged && observed) finish();
    };
    const closed = () => finish(new EufyError('guard_mode_unconfirmed'));
    const cancel = () => finish(new EufyError('guard_mode_unconfirmed'));
    const timer = setTimeout(closed, timeoutMs);
    station.on('command result', command);
    station.on('parameter observed', observation);
    station.on('close', closed);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      station.setGuardMode(mode);
    } catch {
      finish(new EufyError('guard_mode_rejected'));
    }
  });
}
