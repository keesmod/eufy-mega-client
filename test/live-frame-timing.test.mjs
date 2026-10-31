import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { P2PClientProtocol } from '../dist/vendor/p2p/session.js';
import { CommandType, P2PDataType } from '../dist/vendor/p2p/types.js';
import { listenFrameTiming, recordFrameTiming } from '../dist/vendor/p2p/frame-timing.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { EufyMegaClient } from '../dist/index.js';

const HEADER = 22;
// One CMD_VIDEO_FRAME payload: the 22 byte header, then `body`.
function videoFrame(body, { key = false, timestamp = 0, seq = 0 } = {}) {
  const data = Buffer.alloc(HEADER + body.length);
  data.writeUInt32LE(body.length, 0);
  data[4] = key ? 1 : 0;
  data[5] = 1;
  data.writeUInt16LE(seq, 6);
  data.writeUInt16LE(15, 8);
  data.writeUInt16LE(640, 10);
  data.writeUInt16LE(360, 12);
  data.writeUIntLE(timestamp, 14, 6);
  body.copy(data, HEADER);
  return data;
}
// One CMD_AUDIO_FRAME payload with a single 9 byte ADTS frame.
function audioFrame(timestamp) {
  const data = Buffer.alloc(16 + 9);
  data.writeUInt32LE(9, 0);
  data[5] = 0;
  data.writeUIntLE(timestamp, 8, 6);
  Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x01, 0x3f, 0xfc, 0x00, 0x00]).copy(data, 16);
  return data;
}
const slice = (marker, size) =>
  Buffer.concat([Buffer.from([0, 0, 0, 1, marker]), Buffer.alloc(size - 5, marker)]);

function protocol() {
  return new P2PClientProtocol(
    {
      station_sn: 'T8030_FIXTURE',
      device_type: 18,
      app_conn: '',
      devices: [],
      member: { admin_user_id: 'test' },
    },
    {},
  );
}
function send(p, commandId, data) {
  p.handleDataBinaryAndVideo({
    dataType: P2PDataType.VIDEO,
    commandId,
    channel: 0,
    signCode: 0,
    data,
  });
}

test('each pushed live frame carries its own header timing and exact byte offset', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = protocol();
  let video, audio;
  p.on('livestream started', (_channel, _metadata, v, a) => {
    video = v;
    audio = a;
  });
  const timings = { video: [], audio: [] };
  const bytes = { video: [], audio: [] };
  try {
    send(
      p,
      CommandType.CMD_VIDEO_FRAME,
      videoFrame(slice(0x65, 40), { key: true, timestamp: 1000 }),
    );
    send(p, CommandType.CMD_AUDIO_FRAME, audioFrame(1010));
    assert.ok(video && audio, 'the stream started after the first video and audio');
    // Frames pushed before the consumer listens are replayed on listen.
    send(p, CommandType.CMD_VIDEO_FRAME, videoFrame(slice(0x41, 12), { timestamp: 1067 }));
    let received = 0;
    listenFrameTiming(video, (timing) => timings.video.push({ ...timing, received }));
    listenFrameTiming(audio, (timing) => timings.audio.push(timing));
    video.on('data', (chunk) => {
      bytes.video.push(chunk);
      received += chunk.length;
    });
    audio.on('data', (chunk) => bytes.audio.push(chunk));
    // Drain the buffered start, so every later push emits 'data' at once and
    // a push before its timing would show up in `received`.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(received, 40);
    // A frame split over two messages keeps the timing of its first part.
    send(p, CommandType.CMD_VIDEO_FRAME, videoFrame(slice(0x41, 20), { timestamp: 1133 }));
    send(p, CommandType.CMD_VIDEO_FRAME, videoFrame(Buffer.alloc(7, 0x22), { timestamp: 9999 }));
    send(
      p,
      CommandType.CMD_VIDEO_FRAME,
      videoFrame(slice(0x65, 30), { key: true, timestamp: 1200 }),
    );
    send(p, CommandType.CMD_AUDIO_FRAME, audioFrame(1074));
    send(p, CommandType.CMD_VIDEO_FRAME, videoFrame(slice(0x41, 10), { timestamp: 1267 }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      timings.video.map(({ offset, bytes, timestampMs, keyFrame }) => ({
        offset,
        bytes,
        timestampMs,
        keyFrame,
      })),
      [
        { offset: 0, bytes: 40, timestampMs: 1000, keyFrame: true },
        { offset: 40, bytes: 12, timestampMs: 1067, keyFrame: false },
        { offset: 52, bytes: 27, timestampMs: 1133, keyFrame: false },
        { offset: 79, bytes: 30, timestampMs: 1200, keyFrame: true },
      ],
    );
    const pushed = Buffer.concat(bytes.video);
    for (const timing of timings.video) {
      const frame = pushed.subarray(timing.offset, timing.offset + timing.bytes);
      assert.equal(frame.length, timing.bytes);
      assert.deepEqual(
        [...frame.subarray(0, 4)],
        [0, 0, 0, 1],
        'each timing starts at a start code',
      );
    }
    assert.equal(pushed.length, 79 + 30, 'the newest frame waits for the next start code');
    assert.deepEqual(
      timings.audio.map(({ offset, bytes, timestampMs, keyFrame }) => ({
        offset,
        bytes,
        timestampMs,
        keyFrame,
      })),
      [
        { offset: 0, bytes: 9, timestampMs: 1010, keyFrame: false },
        { offset: 9, bytes: 9, timestampMs: 1074, keyFrame: false },
      ],
    );
    assert.equal(Buffer.concat(bytes.audio).length, 18);
    // A new frame's timing arrives before any of its bytes.
    for (const timing of timings.video.slice(2)) assert.ok(timing.received <= timing.offset);
  } finally {
    await p.dispose();
  }
});

test('each ADTS frame of one audio message gets its own timing with the message timestamp', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = protocol();
  let audio;
  p.on('livestream started', (_channel, _metadata, _v, a) => {
    audio = a;
  });
  try {
    send(
      p,
      CommandType.CMD_VIDEO_FRAME,
      videoFrame(slice(0x65, 20), { key: true, timestamp: 1000 }),
    );
    const adts = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x01, 0x3f, 0xfc, 0x00, 0x00]);
    const two = Buffer.alloc(16 + 18);
    two.writeUInt32LE(18, 0);
    two.writeUIntLE(2000, 8, 6);
    adts.copy(two, 16);
    adts.copy(two, 25);
    send(p, CommandType.CMD_AUDIO_FRAME, two);
    const seen = [];
    listenFrameTiming(audio, (timing) => seen.push(timing));
    assert.deepEqual(seen, [
      { offset: 0, bytes: 9, timestampMs: 2000, keyFrame: false },
      { offset: 9, bytes: 9, timestampMs: 2000, keyFrame: false },
    ]);
  } finally {
    await p.dispose();
  }
});

test('frame timing keeps the newest backlog, isolates a throwing listener and allows one listener', () => {
  const stream = new Readable({ read() {} });
  for (let i = 0; i < 300; i++) recordFrameTiming(stream, 10, i, i === 0);
  recordFrameTiming(stream, 0, 999, false);
  recordFrameTiming(null, 10, 1, false);
  const seen = [];
  listenFrameTiming(stream, (timing) => {
    seen.push(timing);
    throw new Error('consumer failure');
  });
  assert.equal(seen.length, 256);
  assert.deepEqual(seen[0], { offset: 440, bytes: 10, timestampMs: 44, keyFrame: false });
  assert.deepEqual(seen.at(-1), { offset: 2990, bytes: 10, timestampMs: 299, keyFrame: false });
  recordFrameTiming(stream, 5, 300, true);
  assert.deepEqual(seen.at(-1), { offset: 3000, bytes: 5, timestampMs: 300, keyFrame: true });
  assert.throws(() => listenFrameTiming(stream, () => {}), /already has a listener/);
});

function fixture(onStart) {
  const t = new DeviceTransport();
  const station = Object.assign(new EventEmitter(), {
    getSerial: () => 'HB',
    hasProperty: () => false,
    isConnected: () => true,
    getCameraInfo: () => {},
    connect: async () => station.emit('encryption ready', station, 'lan-derived'),
    startLivestream: () => queueMicrotask(onStart),
    stopLivestream: () => station.emit('livestream stop', station, 1),
    close: async () => station.emit('close', station),
    dispose: async () => {},
  });
  t.stations.set('HB', station);
  t.encryption.set('HB', 'lan-derived');
  t.raw.set('CAM', { device_sn: 'CAM', device_model: 'T8160', device_type: 19, parent_sn: 'HB' });
  t.cameras.set('CAM', {
    getModel: () => 'T8160',
    getStationSerial: () => 'HB',
    getChannel: () => 1,
    destroy() {},
    removeAllListeners() {},
  });
  t.bind(station);
  return {
    t,
    station,
    ack: () =>
      station.emit('command result', station, { command_type: 1004, channel: 1, return_code: 0 }),
  };
}

test('startLive passes each frame timing on, the backlog first, and ignores listener errors', async () => {
  const video = new Readable({ read() {} });
  const audio = new Readable({ read() {} });
  recordFrameTiming(video, 40, 1000, true);
  video.push(Buffer.alloc(40));
  const f = fixture(() =>
    f.station.emit(
      'livestream start',
      f.station,
      1,
      { videoCodec: 0, audioCodec: 1, videoFPS: 15, videoWidth: 640, videoHeight: 360 },
      video,
      audio,
    ),
  );
  const seen = [];
  try {
    const stream = await f.t.startLive('CAM', undefined, undefined, undefined, (timing) => {
      seen.push(timing);
      throw new Error('consumer failure');
    });
    recordFrameTiming(audio, 9, 1010, false);
    recordFrameTiming(video, 12, 1067, false);
    assert.deepEqual(seen, [
      { kind: 'video', offset: 0, bytes: 40, timestampMs: 1000, keyFrame: true },
      { kind: 'audio', offset: 0, bytes: 9, timestampMs: 1010, keyFrame: false },
      { kind: 'video', offset: 40, bytes: 12, timestampMs: 1067, keyFrame: false },
    ]);
    const stopped = stream.stop();
    f.ack();
    await stopped;
  } finally {
    await f.t.close();
  }
});

test('EufyMegaClient.startLive forwards onFrameTiming with the other options', async () => {
  const calls = [];
  const client = Object.create(EufyMegaClient.prototype);
  client.closed = false;
  client.transportLoading = Promise.resolve({
    startLive: async (...args) => (calls.push(args), 'stream'),
  });
  const onProgress = () => {};
  const onFrameTiming = () => {};
  const signal = new AbortController().signal;
  assert.equal(
    await client.startLive('CAM', { signal, maxDurationMs: 5000, onProgress, onFrameTiming }),
    'stream',
  );
  assert.deepEqual(calls, [['CAM', signal, 5000, onProgress, onFrameTiming]]);
});

test('startLive without onFrameTiming leaves the streams untouched', async () => {
  const video = new Readable({ read() {} });
  const audio = new Readable({ read() {} });
  const f = fixture(() =>
    f.station.emit(
      'livestream start',
      f.station,
      1,
      { videoCodec: 0, audioCodec: 1, videoFPS: 15, videoWidth: 640, videoHeight: 360 },
      video,
      audio,
    ),
  );
  try {
    const stream = await f.t.startLive('CAM');
    assert.equal(stream.video, video);
    // Nobody listened, so a later consumer can still attach.
    const seen = [];
    listenFrameTiming(video, (timing) => seen.push(timing));
    recordFrameTiming(video, 5, 1, false);
    assert.equal(seen.length, 1);
    const stopped = stream.stop();
    f.ack();
    await stopped;
  } finally {
    await f.t.close();
  }
});
