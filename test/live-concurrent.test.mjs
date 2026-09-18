import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceTransport } from '../dist/device-transport.js';

// Concurrent live streams per station. Fake station objects establish the
// transport's ownership rules only. HomeBase behaviour with several sessions
// is bench evidence in docs/research/CONCURRENT_LIVE_2026-09-18.md.
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
function fixture(options = { maxLiveStreamsPerStation: 2 }) {
  const t = new DeviceTransport(options);
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
  for (const channel of [1, 2, 3, 4]) {
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
  const stopConfirmed = async (stream, station, channel) => {
    const stopping = stream.stop();
    station.ack(channel);
    return stopping;
  };
  return { t, primary, extras, stopped, stopConfirmed };
}
test('the option accepts 1 to 4 concurrent streams per station', async () => {
  for (const limit of [0, 5, 1.5, -1, Number.NaN])
    assert.throws(
      () => new DeviceTransport({ maxLiveStreamsPerStation: limit }),
      (error) => error.code === 'invalid_live_stream_limit',
    );
  for (const limit of [1, 4])
    await new DeviceTransport({ maxLiveStreamsPerStation: limit }).close();
  await new DeviceTransport().close();
});
test('by default a second camera on the station is still refused', async () => {
  const f = fixture({});
  try {
    const first = await f.t.startLive('CAM1');
    await assert.rejects(f.t.startLive('CAM2'), (error) => error.code === 'station_busy');
    assert.equal(f.extras.length, 0);
    assert.deepEqual(await f.stopConfirmed(first, f.primary, 1), {
      confirmed: true,
      reason: 'device',
    });
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
    assert.deepEqual(await f.stopConfirmed(first, f.primary, 1), {
      confirmed: true,
      reason: 'device',
    });
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
    assert.deepEqual(await f.stopConfirmed(first, f.primary, 1), {
      confirmed: true,
      reason: 'device',
    });
    assert.equal(f.primary.stops, 1);
    assert.equal(f.primary.closes, 0);
  } finally {
    await f.t.close();
  }
});
test('the limit counts every session and pending start on the station', async () => {
  const f = fixture({ maxLiveStreamsPerStation: 3 });
  try {
    const first = await f.t.startLive('CAM1');
    const second = await f.t.startLive('CAM2');
    const third = await f.t.startLive('CAM3');
    assert.equal(f.extras.length, 2);
    await assert.rejects(f.t.startLive('CAM4'), (error) => error.code === 'station_busy');
    assert.deepEqual(await f.stopConfirmed(third, f.extras[1], 3), {
      confirmed: true,
      reason: 'device',
    });
    // A released slot admits the next camera on a fresh session.
    const fourth = await f.t.startLive('CAM4');
    assert.equal(f.extras.length, 3);
    assert.equal(f.t.extraLives.get('HB#live:4').handle, fourth);
    for (const [stream, station, channel] of [
      [fourth, f.extras[2], 4],
      [second, f.extras[0], 2],
      [first, f.primary, 1],
    ])
      assert.deepEqual(await f.stopConfirmed(stream, station, channel), {
        confirmed: true,
        reason: 'device',
      });
    assert.equal(f.t.lives.size + f.t.extraLives.size, 0);
  } finally {
    await f.t.close();
  }
});
test('a second camera does not wait for a pending primary start', async () => {
  const f = fixture();
  let release;
  f.primary.startLivestream = (camera) => {
    f.primary.starts++;
    release = () =>
      f.primary.emit(
        'livestream start',
        f.primary,
        camera.getChannel(),
        metadata,
        new Readable({ read() {} }),
        new Readable({ read() {} }),
      );
  };
  try {
    const starting = f.t.startLive('CAM1');
    await delay(0);
    assert.equal(f.t.starting.get('HB'), 1);
    await assert.rejects(f.t.startLive('CAM1'), (error) => error.code === 'station_busy');
    const second = await f.t.startLive('CAM2');
    assert.equal(f.extras.length, 1);
    assert.equal(f.t.extraLives.get('HB#live:2').handle, second);
    release();
    const first = await starting;
    assert.equal(f.t.lives.get('HB').handle, first);
    assert.deepEqual(await f.stopConfirmed(second, f.extras[0], 2), {
      confirmed: true,
      reason: 'device',
    });
    assert.deepEqual(await f.stopConfirmed(first, f.primary, 1), {
      confirmed: true,
      reason: 'device',
    });
  } finally {
    await f.t.close();
  }
});
test('extra streams block station commands and recovery of other cameras', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    const second = await f.t.startLive('CAM2');
    assert.deepEqual(await f.stopConfirmed(first, f.primary, 1), {
      confirmed: true,
      reason: 'device',
    });
    assert.equal(f.t.lives.size, 0);
    await assert.rejects(f.t.setGuardMode('HB', 0), (error) => error.code === 'station_busy');
    await assert.rejects(f.t.ensureLiveStopped('CAM3'), (error) => error.code === 'station_busy');
    await assert.rejects(f.t.load(new Map(f.t.raw)), (error) => error.code === 'devices_busy');
    // A camera's own extra stream is stopped on its session, without closing the primary.
    const stopSecond = f.t.ensureLiveStopped('CAM2');
    f.extras[0].ack(2);
    assert.deepEqual(await stopSecond, { confirmed: true, reason: 'device' });
    assert.equal(f.extras[0].stops, 1);
    assert.equal(f.primary.closes, 0);
    assert.equal(second.deviceId, 'CAM2');
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
    assert.deepEqual(await f.stopConfirmed(first, f.primary, 1), {
      confirmed: true,
      reason: 'device',
    });
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
    assert.deepEqual(await f.stopConfirmed(first, f.primary, 1), {
      confirmed: true,
      reason: 'device',
    });
  } finally {
    await f.t.close();
  }
});
test('a lost primary session ends its stream and leaves the extra stream running', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    const second = await f.t.startLive('CAM2');
    await f.primary.close();
    assert.deepEqual(await first.ended, { confirmed: false, reason: 'connection_lost' });
    assert.equal(f.t.lives.size, 0);
    assert.equal(f.t.extraLives.get('HB#live:2').handle, second);
    assert.equal(f.extras[0].closes, 0);
    assert.deepEqual(await f.stopConfirmed(second, f.extras[0], 2), {
      confirmed: true,
      reason: 'device',
    });
    assert.equal(f.extras[0].disposed, 1);
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
