import type { Readable } from 'node:stream';
import { listenFrameTiming } from './vendor/p2p/frame-timing.js';
import type { LiveFrameTiming } from './types.js';

/** Pass the camera timing of each frame of one live stream on to the caller. */
export function tapLiveFrames(
  video: Readable,
  audio: Readable,
  onFrameTiming?: (timing: LiveFrameTiming) => void,
): void {
  if (!onFrameTiming) return;
  for (const [kind, stream] of [
    ['video', video],
    ['audio', audio],
  ] as const)
    listenFrameTiming(stream, (timing) =>
      onFrameTiming({
        kind,
        offset: timing.offset,
        bytes: timing.bytes,
        timestampMs: timing.timestampMs,
        keyFrame: timing.keyFrame,
      }),
    );
}
