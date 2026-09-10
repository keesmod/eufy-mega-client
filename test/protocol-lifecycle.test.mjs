import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { P2PClientProtocol } from '../dist/vendor/p2p/session.js';
import { EventEmitter } from 'node:events';
import { CommandType, AudioCodec, P2PDataType } from '../dist/vendor/p2p/types.js';

test('audio arriving after the former 650 ms cutoff is included in the first stream metadata', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const protocol = new P2PClientProtocol(
    {
      station_sn: 'T8030_FIXTURE',
      device_type: 18,
      app_conn: '',
      devices: [],
      member: { admin_user_id: 'test' },
    },
    {},
  );
  const kind = P2PDataType.VIDEO;
  const started = [];
  protocol.on('livestream started', (_channel, metadata) => started.push({ ...metadata }));
  const video = Buffer.alloc(28);
  video.writeUInt32LE(6, 0);
  video[4] = 1;
  video[5] = 1;
  video.writeUInt16LE(15, 8);
  video.writeUInt16LE(640, 10);
  video.writeUInt16LE(360, 12);
  Buffer.from([0, 0, 0, 1, 0x65, 0]).copy(video, 22);
  try {
    protocol.handleDataBinaryAndVideo({
      dataType: kind,
      commandId: CommandType.CMD_VIDEO_FRAME,
      channel: 0,
      signCode: 0,
      data: video,
    });
    t.mock.timers.tick(900);
    assert.equal(
      started.length,
      0,
      'Video must not declare audio absent before a delayed AAC frame',
    );
    const audio = Buffer.alloc(16);
    audio[5] = 0;
    protocol.handleDataBinaryAndVideo({
      dataType: kind,
      commandId: CommandType.CMD_AUDIO_FRAME,
      channel: 0,
      signCode: 0,
      data: audio,
    });
    assert.equal(started.length, 1);
    assert.equal(started[0].audioCodec, AudioCodec.AAC);
  } finally {
    await protocol.dispose();
  }
});

test('a video-only stream still starts within the bounded audio discovery window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const protocol = new P2PClientProtocol(
    {
      station_sn: 'T8030_FIXTURE',
      device_type: 18,
      app_conn: '',
      devices: [],
      member: { admin_user_id: 'test' },
    },
    {},
  );
  const started = [];
  protocol.on('livestream started', (_channel, metadata) => started.push({ ...metadata }));
  const video = Buffer.alloc(28);
  video.writeUInt32LE(6, 0);
  video[4] = 1;
  video[5] = 1;
  Buffer.from([0, 0, 0, 1, 0x65, 0]).copy(video, 22);
  try {
    protocol.handleDataBinaryAndVideo({
      dataType: P2PDataType.VIDEO,
      commandId: CommandType.CMD_VIDEO_FRAME,
      channel: 0,
      signCode: 0,
      data: video,
    });
    t.mock.timers.tick(3000);
    assert.equal(started.length, 1);
    assert.equal(started[0].audioCodec, AudioCodec.NONE);
  } finally {
    await protocol.dispose();
  }
});

test('a media timeout from a cancelled transfer cannot stop a later stream after reconnect', async () => {
  const protocol = Object.create(P2PClientProtocol.prototype);
  protocol.currentMessageState = {};
  protocol.streamTimeouts = { streamDataWait: 15 };
  protocol.rawStation = { station_sn: 'FIXTURE' };
  protocol.deviceSNs = {};
  const stops = [];
  protocol.endStream = (type, sendStop) =>
    stops.push({ channel: protocol.currentMessageState[type].p2pStreamChannel, sendStop });
  protocol.initializeMessageState(1);
  // A late packet can arm the old timeout after its cancelled stream is idle.
  protocol.waitForStreamData(1, true);
  protocol.initializeMessageState(1);
  protocol.currentMessageState[1].p2pStreaming = true;
  protocol.currentMessageState[1].p2pStreamChannel = 2;
  await delay(35);
  assert.deepEqual(stops, []);
  // The current stream must retain its own timeout protection.
  protocol.waitForStreamData(1, true);
  await delay(35);
  assert.deepEqual(stops, [{ channel: 2, sendStop: true }]);
});

test('a device END closes its UDP socket before replacing it, including duplicate END packets', async () => {
  const protocol = Object.create(P2PClientProtocol.prototype);
  let closed = 0,
    replacements = 0;
  const socket = Object.assign(new EventEmitter(), {
    close(callback) {
      closed++;
      queueMicrotask(() => {
        this.emit('close');
        callback?.();
      });
    },
  });
  protocol.socket = socket;
  protocol.binded = true;
  protocol.rawStation = { station_sn: 'FIXTURE' };
  protocol.onClose = () => {
    replacements++;
    protocol.binded = false;
  };
  socket.on('close', () => protocol.onClose());
  const packet = Buffer.from([0xf1, 0xf0, 0, 0]);
  protocol.handleMsg(packet, { address: '127.0.0.1', port: 1234 });
  protocol.handleMsg(packet, { address: '127.0.0.1', port: 1234 });
  assert.equal(closed, 1);
  assert.equal(replacements, 0);
  await delay(0);
  assert.equal(replacements, 1);
});

test('simultaneous cleanup owners share one END send and one completed close', async () => {
  const protocol = new P2PClientProtocol(
    {
      station_sn: 'FIXTURE',
      device_type: 18,
      app_conn: '',
      devices: [],
      member: { admin_user_id: 'test' },
    },
    {},
  );
  let sends = 0,
    resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  protocol.connected = true;
  protocol.sendMessage = async () => {
    sends++;
    await gate;
  };
  const first = protocol.close(),
    second = protocol.close();
  try {
    assert.equal(sends, 1);
    assert.equal(first, second);
  } finally {
    resume();
    await Promise.all([first, second]);
    await protocol.dispose();
  }
});

test('a recovering camera gets the startup deadline before the shorter media-stall deadline applies', async () => {
  const protocol = Object.create(P2PClientProtocol.prototype);
  protocol.currentMessageState = {};
  protocol.streamTimeouts = { streamStartWait: 60, streamDataWait: 10 };
  protocol.rawStation = { station_sn: 'FIXTURE' };
  protocol.deviceSNs = {};
  const stops = [];
  protocol.endStream = (_type, sendStop) => stops.push(sendStop);
  protocol.initializeMessageState(1);
  protocol.waitForStreamData(1);
  await delay(25);
  assert.deepEqual(stops, []);
  // Receiving media switches to the shorter stall timeout.
  protocol.waitForStreamData(1, true);
  await delay(25);
  assert.deepEqual(stops, [true]);
});
