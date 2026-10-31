import type { Readable } from "stream";

/**
 * One frame pushed to a live media stream, on the camera's clock. `offset` is
 * the position of the frame's first byte in that stream, counted from 0, so a
 * consumer can pair the timing with the bytes however the stream chunks them.
 */
export interface FrameTiming {
  offset: number;
  bytes: number;
  timestampMs: number;
  keyFrame: boolean;
}

type FrameTimingListener = (timing: FrameTiming) => void;

// The station starts a stream after its first video and audio frames, so only
// a few frames wait for the consumer. A longer backlog keeps the newest ones.
const BACKLOG_FRAMES = 256;

class FrameTimingTap {
  private offset = 0;
  private backlog: FrameTiming[] = [];
  private listener?: FrameTimingListener;

  record(bytes: number, timestampMs: number, keyFrame: boolean): void {
    if (bytes <= 0) return;
    const timing: FrameTiming = { offset: this.offset, bytes, timestampMs, keyFrame };
    this.offset += bytes;
    if (this.listener) {
      deliver(this.listener, timing);
      return;
    }
    this.backlog.push(timing);
    if (this.backlog.length > BACKLOG_FRAMES) this.backlog.shift();
  }

  listen(listener: FrameTimingListener): void {
    if (this.listener) throw new Error("Frame timing already has a listener");
    this.listener = listener;
    const backlog = this.backlog;
    this.backlog = [];
    for (const timing of backlog) deliver(listener, timing);
  }
}

// A consumer's error cannot change, end or delay the stream.
function deliver(listener: FrameTimingListener, timing: FrameTiming): void {
  try {
    listener(timing);
  } catch {
    // Ignored on purpose.
  }
}

const taps = new WeakMap<Readable, FrameTimingTap>();

function tap(stream: Readable): FrameTimingTap {
  let found = taps.get(stream);
  if (!found) {
    found = new FrameTimingTap();
    taps.set(stream, found);
  }
  return found;
}

/**
 * Record one frame right before its bytes are pushed to `stream`. Every push
 * to a live media stream records its length, so the offsets stay exact.
 */
export function recordFrameTiming(
  stream: Readable | null | undefined,
  bytes: number,
  timestampMs: number,
  keyFrame: boolean
): void {
  if (stream) tap(stream).record(bytes, timestampMs, keyFrame);
}

/**
 * Receive the timing of every frame of `stream`, first the frames already
 * pushed, then each new frame synchronously before its bytes are pushed. One
 * listener per stream.
 */
export function listenFrameTiming(stream: Readable, listener: FrameTimingListener): void {
  tap(stream).listen(listener);
}
