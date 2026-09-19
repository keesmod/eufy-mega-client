import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceTransport } from '../dist/device-transport.js';

// Per-start upper bound. Fake stations establish the transport's validation
// and timer only. Bench evidence: docs/research/LIVE_BOUND_2026-09-19.md.
function fakeStation(serial, connected = false) {
  const station = Object.assign(new EventEmitter(), {
    starts: 0,
    stops: 0,
    disposed: 0,
    getSerial: () => serial,
    hasProperty: () => false,
    isConnected: () => connected,
    getCameraInfo: () => {},
    connect: async () => {
      connected = true;
      station.emit('encryption ready', station, 'lan-derived');
    },
    startLivestream: (camera) => {
      station.starts++;
      queueMicrotask(() =>
        station.emit(
          'livestream start',
          station,
          camera.getChannel(),
          { videoCodec: 0, audioCodec: 1, videoFPS: 15, videoWidth: 1920, videoHeight: 1080 },
          new Readable({ read() {} }),
          new Readable({ read() {} }),
        ),
      );
    },
    stopLivestream: (camera) => {
      station.stops++;
      station.emit('livestream stop', station, camera.getChannel());
    },
    close: async () => {
      if (!connected) return;
      connected = false;
      station.emit('close', station);
    },
    dispose: async () => {
      station.disposed++;
      await station.close();
    },
    ack: (channel, code = 0) =>
      station.emit('command result', station, { command_type: 1004, channel, return_code: code }),
  });
  return station;
}
function fixture(options = {}) {
  const t = new DeviceTransport(options);
  const primary = fakeStation('HB', true);
  const extras = [];
  t.createExtraStation = async (stationId) => {
    const station = fakeStation(stationId);
    extras.push(station);
    return station;
  };
  t.stations.set('HB', primary);
  t.encryption.set('HB', 'lan-derived');
  t.raw.set('CAM1', { device_sn: 'CAM1', device_model: 'T8160', device_type: 19, parent_sn: 'HB' });
  t.cameras.set('CAM1', {
    getModel: () => 'T8160',
    getStationSerial: () => 'HB',
    getChannel: () => 1,
    destroy() {},
    removeAllListeners() {},
  });
  t.bind(primary);
  return { t, primary, extras };
}
test('the ceiling accepts 120000 to 3600000 milliseconds', async () => {
  for (const bound of [119999, 3600001, 120000.5, 0, -1, Number.NaN])
    assert.throws(
      () => new DeviceTransport({ liveUpperBoundMs: bound }),
      (error) => error.code === 'invalid_live_bound',
    );
  for (const bound of [120000, 3600000])
    await new DeviceTransport({ liveUpperBoundMs: bound }).close();
});
test('a per-start bound must lie between one second and the ceiling', async () => {
  const f = fixture({ liveUpperBoundMs: 300000 });
  const d = fixture();
  try {
    for (const value of [999, 300001, 1000.5, Number.NaN, 0])
      await assert.rejects(
        f.t.startLive('CAM1', undefined, value),
        (error) => error.code === 'invalid_live_bound',
      );
    await assert.rejects(
      d.t.startLive('CAM1', undefined, 120001),
      (error) => error.code === 'invalid_live_bound',
    );
    assert.equal(f.primary.starts + d.primary.starts, 0);
    const stream = await d.t.startLive('CAM1', undefined, 120000);
    const stopping = stream.stop();
    d.primary.ack(1);
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
  } finally {
    await f.t.close();
    await d.t.close();
  }
});
test('the primary stream ends at its own bound with a device-confirmed STOP', async () => {
  const f = fixture({ liveUpperBoundMs: 300000 });
  try {
    const stream = await f.t.startLive('CAM1', undefined, 1000);
    await delay(850);
    assert.equal(f.primary.stops, 0);
    await delay(300);
    assert.equal(f.primary.stops, 1);
    f.primary.ack(1);
    assert.deepEqual(await stream.ended, { confirmed: true, reason: 'device' });
    assert.equal(f.t.lives.size, 0);
  } finally {
    await f.t.close();
  }
});
test('an extra-session stream ends at its own bound and releases its session', async () => {
  const f = fixture({ maxLiveStreamsPerStation: 2, liveUpperBoundMs: 300000 });
  try {
    const stream = await f.t.startLive('CAM1', undefined, 1000);
    const extra = f.extras[0];
    assert.equal(f.t.lives.size, 0);
    await delay(850);
    assert.equal(extra.stops, 0);
    await delay(300);
    assert.equal(extra.stops, 1);
    assert.equal(f.primary.stops, 0);
    extra.ack(1);
    assert.deepEqual(await stream.ended, { confirmed: true, reason: 'device' });
    await delay(5);
    assert.equal(extra.disposed, 1);
    assert.equal(f.t.extraLives.size, 0);
  } finally {
    await f.t.close();
  }
});
