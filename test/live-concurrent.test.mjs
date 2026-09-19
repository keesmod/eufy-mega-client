import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceTransport } from '../dist/device-transport.js';

// Concurrent live streams per station. Fake station objects establish the
// transport's ownership rules only. HomeBase behaviour with several sessions
// is bench evidence in docs/research/CONCURRENT_LIVE_2026-09-18.md and
// docs/research/LIVE_BOUND_2026-09-19.md.
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
    infos: 0,
    getSerial: () => serial,
    hasProperty: () => false,
    isConnected: () => connected,
    // Telemetry after a command: the station reports guard mode 1 over P2P.
    getCameraInfo: () => {
      station.infos++;
      queueMicrotask(() => station.emit('parameter observed', station, 1224, '1', 'p2p'));
    },
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
  primary.databaseQueryLatestInfo = () =>
    queueMicrotask(() =>
      t.emit('snapshot', {
        deviceId: 'CAM1',
        data: Buffer.from([255, 216, 255, 217]),
        mime: 'image/jpeg',
        receivedAt: new Date().toISOString(),
      }),
    );
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
test('by default the single stream uses the primary session and a second camera is refused', async () => {
  const f = fixture({});
  try {
    const first = await f.t.startLive('CAM1');
    assert.equal(f.extras.length, 0);
    assert.equal(f.t.lives.get('HB').handle, first);
    await assert.rejects(f.t.startLive('CAM1'), (error) => error.code === 'station_busy');
    await assert.rejects(f.t.startLive('CAM2'), (error) => error.code === 'station_busy');
    await assert.rejects(f.t.setGuardMode('HB', 1), (error) => error.code === 'station_busy');
    assert.deepEqual(await f.stopConfirmed(first, f.primary, 1), {
      confirmed: true,
      reason: 'device',
    });
  } finally {
    await f.t.close();
  }
});
test('with concurrency enabled every camera streams over its own session and confirms STOP there', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    assert.equal(f.extras.length, 1);
    assert.equal(f.primary.starts, 0);
    assert.equal(f.t.lives.size, 0);
    assert.equal(f.t.extraLives.get('HB#live:1').handle, first);
    const second = await f.t.startLive('CAM2');
    assert.equal(f.extras.length, 2);
    assert.equal(f.t.extraLives.get('HB#live:2').handle, second);
    assert.notEqual(first.id, second.id);
    await assert.rejects(f.t.startLive('CAM1'), (error) => error.code === 'station_busy');
    await assert.rejects(f.t.startLive('CAM3'), (error) => error.code === 'station_busy');
    const stopping = second.stop();
    assert.equal(f.extras[1].stops, 1);
    assert.equal(f.extras[0].stops, 0);
    assert.equal(f.primary.stops, 0);
    // A STOP acknowledgement on another session cannot confirm this stream.
    f.primary.ack(2);
    f.extras[0].ack(2);
    assert.equal(await Promise.race([stopping, delay(10, 'pending')]), 'pending');
    f.extras[1].ack(2);
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
    assert.equal(f.extras[1].disposed, 1);
    assert.equal(f.t.extraLives.size, 1);
    assert.equal(f.t.extraLives.get('HB#live:1').handle, first);
    assert.deepEqual(await f.stopConfirmed(first, f.extras[0], 1), {
      confirmed: true,
      reason: 'device',
    });
    assert.equal(f.extras[0].disposed, 1);
    assert.equal(f.t.extraLives.size, 0);
    assert.equal(f.primary.stops, 0);
    assert.equal(f.primary.closes, 0);
    assert.deepEqual(f.stopped, [
      { deviceId: 'CAM2', confirmed: true, reason: 'device' },
      { deviceId: 'CAM1', confirmed: true, reason: 'device' },
    ]);
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
    assert.equal(f.extras.length, 3);
    await assert.rejects(f.t.startLive('CAM4'), (error) => error.code === 'station_busy');
    assert.deepEqual(await f.stopConfirmed(third, f.extras[2], 3), {
      confirmed: true,
      reason: 'device',
    });
    // A released slot admits the next camera on a fresh session.
    const fourth = await f.t.startLive('CAM4');
    assert.equal(f.extras.length, 4);
    assert.equal(f.t.extraLives.get('HB#live:4').handle, fourth);
    for (const [stream, station, channel] of [
      [fourth, f.extras[3], 4],
      [second, f.extras[1], 2],
      [first, f.extras[0], 1],
    ])
      assert.deepEqual(await f.stopConfirmed(stream, station, channel), {
        confirmed: true,
        reason: 'device',
      });
    assert.equal(f.t.lives.size + f.t.extraLives.size, 0);
    assert.equal(f.primary.starts, 0);
  } finally {
    await f.t.close();
  }
});
test('a second camera does not wait for a pending start of the first', async () => {
  const f = fixture();
  let release;
  const create = f.t.createExtraStation;
  f.t.createExtraStation = async (stationId) => {
    const station = await create(stationId);
    if (f.extras.length === 1)
      station.startLivestream = (camera) => {
        station.starts++;
        release = () =>
          station.emit(
            'livestream start',
            station,
            camera.getChannel(),
            metadata,
            new Readable({ read() {} }),
            new Readable({ read() {} }),
          );
      };
    return station;
  };
  try {
    const starting = f.t.startLive('CAM1');
    await delay(0);
    assert.equal(f.t.extraStarting.get('HB#live:1'), 'HB');
    await assert.rejects(f.t.startLive('CAM1'), (error) => error.code === 'station_busy');
    const second = await f.t.startLive('CAM2');
    assert.equal(f.extras.length, 2);
    assert.equal(f.t.extraLives.get('HB#live:2').handle, second);
    await assert.rejects(f.t.startLive('CAM3'), (error) => error.code === 'station_busy');
    release();
    const first = await starting;
    assert.equal(f.t.extraLives.get('HB#live:1').handle, first);
    assert.equal(f.t.lives.size, 0);
    assert.deepEqual(await f.stopConfirmed(second, f.extras[1], 2), {
      confirmed: true,
      reason: 'device',
    });
    assert.deepEqual(await f.stopConfirmed(first, f.extras[0], 1), {
      confirmed: true,
      reason: 'device',
    });
  } finally {
    await f.t.close();
  }
});
test('extra streams leave the primary session free for mode commands and snapshots', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    assert.equal(f.t.lives.size, 0);
    const mode = await f.t.setGuardMode('HB', 1);
    assert.equal(mode.confirmed, true);
    assert.equal(mode.commandSent, false);
    assert.equal(mode.state.guardMode, 1);
    assert.equal(f.primary.infos, 1);
    const snapshot = await f.t.snapshot('CAM1');
    assert.equal(snapshot.mime, 'image/jpeg');
    assert.equal(f.t.extraLives.get('HB#live:1').handle, first);
    assert.equal(f.extras[0].stops, 0);
    // Recording transfers, recovery of other cameras and reloads still wait.
    assert.equal(f.t.extraBusy('HB'), true);
    await assert.rejects(f.t.ensureLiveStopped('CAM3'), (error) => error.code === 'station_busy');
    await assert.rejects(f.t.load(new Map(f.t.raw)), (error) => error.code === 'devices_busy');
    // A camera's own extra stream is stopped on its session, without closing the primary.
    const stopping = f.t.ensureLiveStopped('CAM1');
    f.extras[0].ack(1);
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
    assert.equal(f.extras[0].stops, 1);
    assert.equal(f.primary.closes, 0);
    assert.equal(f.t.extraBusy('HB'), false);
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
    const extra = f.extras[1];
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
    assert.equal(f.t.extraLives.get('HB#live:1').handle, first);
    assert.equal(f.extras[0].stops, 0);
    assert.deepEqual(await f.stopConfirmed(first, f.extras[0], 1), {
      confirmed: true,
      reason: 'device',
    });
  } finally {
    await f.t.close();
  }
});
test('a lost extra session ends only its stream and releases its socket', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    const second = await f.t.startLive('CAM2');
    await f.extras[1].close();
    assert.deepEqual(await second.ended, { confirmed: false, reason: 'connection_lost' });
    await delay(5);
    assert.equal(f.extras[1].disposed, 1);
    assert.equal(f.t.extraLives.size, 1);
    assert.equal(f.t.extraLives.get('HB#live:1').handle, first);
    assert.equal(f.t.state('HB').connected, true);
    assert.deepEqual(f.stopped, [
      { deviceId: 'CAM2', confirmed: false, reason: 'connection_lost' },
    ]);
    assert.deepEqual(await f.stopConfirmed(first, f.extras[0], 1), {
      confirmed: true,
      reason: 'device',
    });
  } finally {
    await f.t.close();
  }
});
test('a lost primary session leaves the extra streams running', async () => {
  const f = fixture();
  try {
    const first = await f.t.startLive('CAM1');
    const second = await f.t.startLive('CAM2');
    await f.primary.close();
    assert.equal(f.t.state('HB').connected, false);
    assert.equal(f.stopped.length, 0);
    assert.equal(f.t.extraLives.size, 2);
    assert.equal(f.extras[0].closes + f.extras[1].closes, 0);
    assert.deepEqual(await f.stopConfirmed(second, f.extras[1], 2), {
      confirmed: true,
      reason: 'device',
    });
    assert.deepEqual(await f.stopConfirmed(first, f.extras[0], 1), {
      confirmed: true,
      reason: 'device',
    });
    assert.equal(f.extras[0].disposed + f.extras[1].disposed, 2);
  } finally {
    await f.t.close();
  }
});
test('closing the transport stops every extra session and disposes it', async () => {
  const f = fixture();
  const first = await f.t.startLive('CAM1');
  const second = await f.t.startLive('CAM2');
  const closing = f.t.close();
  await delay(0);
  assert.equal(f.primary.stops, 0);
  assert.equal(f.extras[0].stops, 1);
  assert.equal(f.extras[1].stops, 1);
  f.extras[0].ack(1);
  f.extras[1].ack(2);
  await closing;
  assert.deepEqual(await first.ended, { confirmed: true, reason: 'device' });
  assert.deepEqual(await second.ended, { confirmed: true, reason: 'device' });
  assert.equal(f.extras[0].disposed + f.extras[1].disposed, 2);
});
