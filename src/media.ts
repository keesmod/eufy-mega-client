import type { StreamMetadata } from './vendor/p2p/interfaces.js';
import { VideoCodec, AudioCodec } from './vendor/p2p/types.js';
import type { MediaMetadata } from './types.js';

export const mediaMetadata = (m: StreamMetadata): MediaMetadata => ({
  videoCodec:
    m.videoCodec === VideoCodec.H264
      ? 'h264'
      : m.videoCodec === VideoCodec.H265
        ? 'h265'
        : 'unknown',
  audioCodec:
    m.audioCodec === AudioCodec.AAC
      ? 'aac'
      : m.audioCodec === AudioCodec.AAC_LC
        ? 'aac-lc'
        : m.audioCodec === AudioCodec.AAC_ELD
          ? 'aac-eld'
          : m.audioCodec === AudioCodec.NONE
            ? 'none'
            : 'unknown',
  fps: m.videoFPS,
  width: m.videoWidth,
  height: m.videoHeight,
});
