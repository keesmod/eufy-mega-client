import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceTransport } from '../dist/device-transport.js';

// Research prototype for #157: a second live camera on one station opens its
// own P2P session. These tests use fake station objects, so they establish the
// transport's ownership rules only, not HomeBase behaviour.
const metadata = {
  videoCodec: 0,
  audioCodec: 1,
  videoFPS: 15,
  videoWidth: 1920,
  videoHeight: 1080,
};
function fakeStation(serial, connected = false) {
  const station = Object.assign(new EventEmitter(), {
    starts: 0,
    stops: 0,
    closes: 0,
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
          metadata,
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
      station.closes++;
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
function fixture(flag = true) {
  const t = new DeviceTransport();
  t.concurrentLiveSessions = flag;
  const primary = fakeStation('HB', true);
  const extras = [];
  t.createExtraStation = async (stationId) => {
    assert.equal(stationId, 'HB');
    const station = fakeStation(stationId);
    extras.push(station);
    return station;
  };
  t.stations.set('HB', primary);
  t.encryption.set('HB', 'lan-derived');
  for (const channel of [1, 2, 3]) {
    const id = `CAM${channel}`;
    t.raw.set(id, { device_sn: id, device_model: 'T8160', device_type: 19, parent_sn: 'HB' });
    t.cameras.set(id, {
      getModel: () => 'T8160',
      getStationSerial: () => 'HB',
      getChannel: () => channel,
      destroy() {},
      removeAllListeners() {},
    });
  }
  t.bind(primary);
  const stopped = [];
  t.on('live-stop', (event) => stopped.push(event));
  return { t, primary, extras, stopped };
}
test('without the research flag a second camera on the station is still refused', async () => {
  const f = fixture(false);
  try {
    const first = await f.t.startLive('CAM1');
    await assert.rejects(f.t.startLive('CAM2'), (error) => error.code === 'station_busy');
    assert.equal(f.extras.length, 0);
    const stopping = first.stop();
    f.primary.ack(1);
    await stopping;
  } finally {
    await f.t.close();
  }
});
test('the first camera on an idle station keeps using the primary session', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    assert.equal(f.extras.length, 0);
    assert.equal(f.t.lives.get('HB').handle, first);
    await assert.rejects(f.t.startLive('CAM1'), (error) => error.code === 'station_busy');
    const stopping = first.stop();
    f.primary.ack(1);
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
  } finally {
    await f.t.close();
  }
});
test('a second camera streams over its own session and confirms STOP there', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    const second = await f.t.startLive('CAM2');
    assert.equal(f.extras.length, 1);
    const extra = f.extras[0];
    assert.equal(extra.starts, 1);
    assert.equal(f.primary.starts, 1);
    assert.equal(f.t.lives.get('HB').handle, first);
    assert.equal(f.t.extraLives.get('HB#live:2').handle, second);
    assert.notEqual(first.id, second.id);
    await assert.rejects(f.t.startLive('CAM2'), (error) => error.code === 'station_busy');
    const stopping = second.stop();
    assert.equal(extra.stops, 1);
    assert.equal(f.primary.stops, 0);
    // A STOP acknowledgement on the primary session cannot confirm the extra stream.
    f.primary.ack(2);
    assert.equal(await Promise.race([stopping, delay(10, 'pending')]), 'pending');
    extra.ack(2);
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
    assert.equal(extra.disposed, 1);
    assert.equal(f.t.extraLives.size, 0);
    assert.equal(f.t.lives.get('HB').handle, first);
    assert.deepEqual(f.stopped, [{ deviceId: 'CAM2', confirmed: true, reason: 'device' }]);
    const stopFirst = first.stop();
    f.primary.ack(1);
    assert.deepEqual(await stopFirst, { confirmed: true, reason: 'device' });
    assert.equal(f.primary.stops, 1);
    assert.equal(f.primary.closes, 0);
  } finally {
    await f.t.close();
  }
});
test('an active extra stream blocks station commands until it is released', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    const second = await f.t.startLive('CAM2');
    const stopFirst = first.stop();
    f.primary.ack(1);
    await stopFirst;
    assert.equal(f.t.lives.size, 0);
    await assert.rejects(f.t.setGuardMode('HB', 0), (error) => error.code === 'station_busy');
    await assert.rejects(f.t.ensureLiveStopped('CAM3'), (error) => error.code === 'station_busy');
    const stopSecond = f.t.ensureLiveStopped('CAM2');
    f.extras[0].ack(2);
    assert.deepEqual(await stopSecond, { confirmed: true, reason: 'device' });
    assert.equal(f.extras[0].stops, 1);
  } finally {
    await f.t.close();
  }
});
test('cancelling an issued extra start waits for STOP on the extra session', async () => {
  const f = fixture();
  const abort = new AbortController();
  try {
    const first = await f.t.startLive('CAM1');
    f.t.createExtraStation = async () => {
      const station = fakeStation('HB');
      station.startLivestream = () => {
        station.starts++;
      };
      f.extras.push(station);
      return station;
    };
    const starting = f.t.startLive('CAM2', abort.signal);
    await delay(0);
    const extra = f.extras[0];
    assert.equal(extra.starts, 1);
    const rejected = assert.rejects(starting, (error) => error.code === 'cancelled');
    abort.abort();
    await delay(0);
    assert.equal(extra.stops, 1);
    assert.equal(f.t.extraStarting.size, 1);
    assert.equal(f.stopped.length, 0);
    assert.equal(extra.disposed, 0);
    extra.ack(2);
    await rejected;
    assert.equal(f.t.extraStarting.size, 0);
    assert.deepEqual(f.stopped, [{ deviceId: 'CAM2', confirmed: true, reason: 'device' }]);
    assert.equal(extra.disposed, 1);
    assert.equal(f.t.lives.get('HB').handle, first);
    assert.equal(f.primary.stops, 0);
    const stopFirst = first.stop();
    f.primary.ack(1);
    assert.deepEqual(await stopFirst, { confirmed: true, reason: 'device' });
  } finally {
    await f.t.close();
  }
});
test('a lost extra session ends only the extra stream and releases its socket', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    const second = await f.t.startLive('CAM2');
    await f.extras[0].close();
    assert.deepEqual(await second.ended, { confirmed: false, reason: 'connection_lost' });
    await delay(5);
    assert.equal(f.extras[0].disposed, 1);
    assert.equal(f.t.extraLives.size, 0);
    assert.equal(f.t.lives.get('HB').handle, first);
    assert.equal(f.t.state('HB').connected, true);
    assert.deepEqual(f.stopped, [
      { deviceId: 'CAM2', confirmed: false, reason: 'connection_lost' },
    ]);
    const stopFirst = first.stop();
    f.primary.ack(1);
    assert.deepEqual(await stopFirst, { confirmed: true, reason: 'device' });
  } finally {
    await f.t.close();
  }
});
test('closing the transport stops both sessions and disposes the extra one', async () => {
  const f = fixture();
  const first = await f.t.startLive('CAM1');
  const second = await f.t.startLive('CAM2');
  const closing = f.t.close();
  await delay(0);
  assert.equal(f.primary.stops, 1);
  assert.equal(f.extras[0].stops, 1);
  f.primary.ack(1);
  f.extras[0].ack(2);
  await closing;
  assert.deepEqual(await first.ended, { confirmed: true, reason: 'device' });
  assert.deepEqual(await second.ended, { confirmed: true, reason: 'device' });
  assert.equal(f.extras[0].disposed, 1);
});
