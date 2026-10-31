import type { Station } from './vendor/http/station.js';
import type { Device } from './vendor/http/device.js';
import type { CommandResult } from './vendor/p2p/models.js';
import { CommandType, ErrorCode } from './vendor/p2p/types.js';
import { CommandName } from './vendor/http/types.js';
import { EufyError } from './types.js';

/**
 * ha-eufy-cam#229: one preset move and its HomeBase result. Resolves with the
 * time from the send to that result. A result is acceptance by the HomeBase,
 * never proof that the camera finished moving. Sends once and never retries.
 */
export function movePreset(
  station: Station,
  camera: Device,
  preset: number,
  signal: AbortSignal,
  timeoutMs = 40000,
): Promise<number> {
  if (signal.aborted) return Promise.reject(new EufyError('cancelled'));
  return new Promise((resolve, reject) => {
    const channel = camera.getChannel();
    let done = false,
      sentAt = 0;
    const clean = () => {
      clearTimeout(timer);
      station.off('command result', command);
      station.off('close', unconfirmed);
      station.off('connection error', unconfirmed);
      signal.removeEventListener('abort', unconfirmed);
    };
    const finish = (error?: EufyError) => {
      if (done) return;
      done = true;
      clean();
      if (error) reject(error);
      else resolve(Math.max(0, Math.round(performance.now() - sentAt)));
    };
    const command = (_s: Station, result: CommandResult) => {
      const sent = result.customData?.command;
      if (
        result.command_type !== CommandType.CMD_FLOODLIGHT_SET_MOTION_PRESET_POSITION ||
        result.channel !== channel ||
        sent?.name !== CommandName.DevicePresetPosition ||
        sent.value !== preset
      )
        return;
      const code = result.return_code;
      if (code === 0) finish();
      // The session's own results: it gave up on the move, or the move aged out of its queue.
      else if (code === ErrorCode.ERROR_COMMAND_TIMEOUT || code === ErrorCode.ERROR_CONNECT_TIMEOUT)
        finish(new EufyError('preset_move_unconfirmed', code));
      else finish(new EufyError('preset_move_rejected', code));
    };
    const unconfirmed = () => finish(new EufyError('preset_move_unconfirmed'));
    const timer = setTimeout(unconfirmed, timeoutMs);
    station.on('command result', command);
    station.on('close', unconfirmed);
    station.on('connection error', unconfirmed);
    signal.addEventListener('abort', unconfirmed, { once: true });
    sentAt = performance.now();
    try {
      station.presetPosition(camera, preset);
    } catch {
      finish(new EufyError('preset_move_failed'));
    }
  });
}
