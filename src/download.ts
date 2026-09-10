import { randomUUID } from 'node:crypto';
import { PassThrough, type Readable } from 'node:stream';
import type { Station } from './vendor/http/station.js';
import type { Device } from './vendor/http/device.js';
import type { CommandResult } from './vendor/p2p/models.js';
import type { StreamMetadata, DatabaseQueryByDate } from './vendor/p2p/interfaces.js';
import { CommandType } from './vendor/p2p/types.js';
import { mediaMetadata } from './media.js';
import { EufyError, type RecordingDownload, type DownloadResult } from './types.js';

/** Owns one device transfer until its real finish or cancel acknowledgement. */
export function downloadRecording(
  station: Station,
  device: Device,
  record: DatabaseQueryByDate,
  signal: AbortSignal,
): Promise<RecordingDownload> {
  if (signal.aborted) return Promise.reject(new EufyError('cancelled'));
  return new Promise((resolve, reject) => {
    let handle: RecordingDownload | undefined;
    let bytes = 0,
      videoBytes = 0,
      done = false,
      deviceComplete = false,
      localFinished = false,
      drained = false;
    let stopping: Exclude<DownloadResult, { complete: true }>['reason'] | undefined;
    let stopTimer: NodeJS.Timeout | undefined;
    const source: Readable[] = [];
    const counters = new Map<Readable, (chunk: Buffer) => void>();
    const video = new PassThrough(),
      audio = new PassThrough();
    let finish!: (result: DownloadResult) => void;
    const completed = new Promise<DownloadResult>((res) => {
      finish = res;
    });
    const clean = () => {
      clearTimeout(timer);
      clearTimeout(stopTimer);
      clearInterval(bufferCheck);
      signal.removeEventListener('abort', cancelled);
      station.off('download start', started);
      station.off('download finish', ended);
      station.off('download complete', confirmed);
      station.off('command result', command);
      station.off('close', closed);
      for (const stream of source) {
        stream.off('error', closed);
        stream.off('data', counters.get(stream)!);
        stream.unpipe();
        stream.resume();
      }
    };
    const settle = (result: DownloadResult) => {
      if (done) return;
      done = true;
      clean();
      video.end();
      audio.end();
      finish(result);
      if (!handle)
        reject(new EufyError(result.complete ? 'empty_download' : `download_${result.reason}`));
    };
    const closed = () =>
      settle({
        complete: false,
        bytes,
        reason: stopping ?? 'connection_lost',
        stopConfirmed: false,
      });
    const stop = (reason: Exclude<DownloadResult, { complete: true }>['reason']) => {
      if (done || stopping) return completed;
      stopping = reason;
      stopTimer = setTimeout(() => {
        settle({ complete: false, bytes, reason, stopConfirmed: false });
        void station.close();
      }, 5000);
      try {
        station.cancelDownload(device);
      } catch {
        closed();
        void station.close();
      }
      return completed;
    };
    const cancelled = () => {
      void stop('cancelled');
    };
    const maybeComplete = () => {
      if (
        !done &&
        !stopping &&
        deviceComplete &&
        localFinished &&
        drained &&
        handle &&
        videoBytes > 0
      )
        settle({ complete: true, bytes });
    };
    const started = (
      _station: Station,
      channel: number,
      metadata: StreamMetadata,
      v: Readable,
      a: Readable,
    ) => {
      if (channel !== device.getChannel()) return;
      if (handle || stopping) {
        v.resume();
        a.resume();
        void stop('rejected');
        return;
      }
      source.push(v, a);
      const count = (chunk: Buffer, isVideo: boolean) => {
        bytes += chunk.length;
        if (isVideo) videoBytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) void stop('too_large');
      };
      counters.set(v, (chunk) => count(chunk, true));
      counters.set(a, (chunk) => count(chunk, false));
      v.on('data', counters.get(v)!);
      a.on('data', counters.get(a)!);
      for (const stream of source) stream.once('error', closed);
      v.pipe(video, { end: false });
      a.pipe(audio, { end: false });
      handle = {
        id: randomUUID(),
        deviceId: device.getSerial(),
        metadata: mediaMetadata(metadata),
        video,
        audio,
        completed,
        cancel: () => stop('cancelled'),
      };
      resolve(handle);
    };
    const ended = (_station: Station, channel: number) => {
      if (channel !== device.getChannel()) return;
      localFinished = true;
      // Source EOF is queued before this local event. Drain buffered bytes first.
      if (source.length)
        Promise.all(
          source.map((s) =>
            s.readableEnded
              ? Promise.resolve()
              : new Promise<void>((resolve) => s.once('end', resolve)),
          ),
        ).then(() => {
          drained = true;
          maybeComplete();
        });
      else if (!stopping) void stop('rejected');
    };
    const confirmed = (_station: Station, channel: number) => {
      if (channel === device.getChannel()) {
        deviceComplete = true;
        maybeComplete();
      }
    };
    const command = (_station: Station, result: CommandResult) => {
      if (result.channel !== device.getChannel()) return;
      if (result.command_type === CommandType.CMD_DOWNLOAD_CANCEL && stopping) {
        settle({
          complete: false,
          bytes,
          reason: stopping,
          stopConfirmed: result.return_code === 0,
        });
        // Reset binary sequencing before admitting another transfer.
        void station.close();
      } else if (
        result.command_type === CommandType.CMD_DOWNLOAD_VIDEO &&
        result.return_code !== 0
      ) {
        settle({ complete: false, bytes, reason: 'rejected', stopConfirmed: true });
      }
    };
    const timer = setTimeout(() => void stop('timeout'), 40000);
    const bufferCheck = setInterval(() => {
      if (
        source.reduce((n, s) => n + s.readableLength, video.readableLength + audio.readableLength) >
        32 * 1024 * 1024
      )
        void stop('too_large');
    }, 250);
    station.on('download start', started);
    station.on('download finish', ended);
    station.on('download complete', confirmed);
    station.on('command result', command);
    station.on('close', closed);
    signal.addEventListener('abort', cancelled, { once: true });
    void station.startDownload(device, record.storage_path, record.cipher_id).catch(() => {
      void stop('rejected');
    });
  });
}
