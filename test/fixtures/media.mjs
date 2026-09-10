import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { DeviceTransport } from '../../dist/device-transport.js';
import { inventory } from './families.mjs';
import { CommandType } from '../../dist/vendor/p2p/types.js';

// Synthetic station event boundary, real camera factory and DeviceTransport lifecycle.
// Streams contain no recording or image bytes. No socket or hardware is opened.
export async function mediaFixture(profile) {
  const { camera } = inventory(profile);
  const transport = new DeviceTransport();
  await transport.load(new Map([[camera.device_sn, camera]]));
  const counts = { starts: 0, stops: 0, closes: 0 };
  const streams = [];
  let connected = true;
  const station = Object.assign(new EventEmitter(), {
    getSerial: () => camera.parent_sn,
    hasProperty: () => false,
    isConnected: () => connected,
    getCameraInfo() {},
    startLivestream() {
      counts.starts++;
    },
    stopLivestream() {
      counts.stops++;
      station.emit('livestream stop', station, camera.device_channel);
    },
    async close() {
      counts.closes++;
      connected = false;
      station.emit('close', station);
    },
    async dispose() {
      await station.close();
    },
  });
  transport.stations.set(camera.parent_sn, station);
  transport.encryption.set(camera.parent_sn, 'lan-derived');
  transport.bind(station);
  return {
    transport,
    station,
    counts,
    camera,
    startEvent(channel = camera.device_channel) {
      const video = new Readable({ read() {} }),
        audio = new Readable({ read() {} });
      streams.push(video, audio);
      station.emit(
        'livestream start',
        station,
        channel,
        { videoCodec: 0, audioCodec: 1, videoFPS: 15, videoWidth: 1920, videoHeight: 1080 },
        video,
        audio,
      );
    },
    ack(code = 0, channel = camera.device_channel) {
      station.emit('command result', station, {
        command_type: CommandType.CMD_STOP_REALTIME_MEDIA,
        channel,
        return_code: code,
      });
    },
    async close() {
      // Explicit connection loss keeps cleanup bounded even after an assertion fails.
      await station.close();
      await transport.close();
      for (const stream of streams) stream.destroy();
    },
  };
}
