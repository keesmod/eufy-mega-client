import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceTransport } from '../dist/device-transport.js';
function fixture() {
  const t = new DeviceTransport();
  let connected = true,
    stops = 0;
  const station = Object.assign(new EventEmitter(), {
    getSerial: () => 'HB',
    hasProperty: () => false,
    isConnected: () => connected,
    getCameraInfo: () => {},
    connect: async () => {
      connected = true;
      station.emit('encryption ready', station, 'lan-derived');
    },
    startLivestream: () =>
      queueMicrotask(() =>
        station.emit(
          'livestream start',
          station,
          1,
          { videoCodec: 0, audioCodec: 1, videoFPS: 15, videoWidth: 1920, videoHeight: 1080 },
          new Readable({ read() {} }),
          new Readable({ read() {} }),
        ),
      ),
    stopLivestream: () => {
      stops++;
      station.emit('livestream stop', station, 1);
    },
    close: async () => {
      connected = false;
      station.emit('close', station);
    },
    dispose: async () => {},
  });
  t.stations.set('HB', station);
  t.encryption.set('HB', 'lan-derived');
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
    stops: () => stops,
    ack: (code = 0, channel = 1) =>
      station.emit('command result', station, { command_type: 1004, channel, return_code: code }),
  };
}
test('local stream-stop event cannot confirm a physical stop without device acknowledgement', async () => {
  const f = fixture();
  try {
    const stream = await f.t.startLive('CAM');
    const stopping = stream.stop();
    assert.equal(await Promise.race([stopping, delay(15, 'pending')]), 'pending');
    f.ack(0, 2);
    assert.equal(await Promise.race([stopping, delay(10, 'pending')]), 'pending');
    f.ack();
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
  } finally {
    await f.t.close();
  }
});
test('old stream handles cannot stop a later stream on the same camera', async () => {
  const f = fixture();
  try {
    const old = await f.t.startLive('CAM');
    const first = old.stop();
    f.ack();
    await first;
    const current = await f.t.startLive('CAM');
    await old.stop();
    assert.equal(f.stops(), 1);
    const last = current.stop();
    f.ack();
    await last;
  } finally {
    await f.t.close();
  }
});
test('lost connections end streams as unconfirmed and release ownership', async () => {
  const f = fixture();
  try {
    const stream = await f.t.startLive('CAM');
    await f.station.close();
    assert.deepEqual(await stream.ended, { confirmed: false, reason: 'connection_lost' });
    assert.equal(f.t.lives.size, 0);
  } finally {
    await f.t.close();
  }
});
test('cancelling an issued start waits for device STOP before releasing its owner', async () => {
  const f = fixture(),
    abort = new AbortController();
  let issued = false;
  f.station.startLivestream = () => {
    issued = true;
  };
  const stopped = [];
  f.t.on('live-stop', (event) => stopped.push(event));
  try {
    const starting = f.t.startLive('CAM', abort.signal);
    await delay(0);
    assert.equal(issued, true);
    const rejected = assert.rejects(starting, (error) => error.code === 'cancelled');
    abort.abort();
    await delay(0);
    assert.equal(f.stops(), 1);
    assert.equal(f.t.starting.size, 1);
    assert.equal(stopped.length, 0);
    f.ack();
    await rejected;
    assert.equal(f.t.starting.size, 0);
    assert.equal(stopped[0].confirmed, true);
  } finally {
    await f.t.close();
  }
});
test('shutdown retains pending-start cleanup until the device acknowledges STOP', async () => {
  const f = fixture();
  let disposed = false;
  f.station.startLivestream = () => {};
  f.station.dispose = async () => {
    disposed = true;
  };
  const starting = f.t.startLive('CAM');
  const rejected = assert.rejects(starting, (error) => error.code === 'cancelled');
  await delay(0);
  const closing = f.t.close();
  await delay(0);
  assert.equal(disposed, false);
  assert.equal(f.stops(), 1);
  f.ack();
  await rejected;
  await closing;
  assert.equal(disposed, true);
});
test('recovery confirms STOP and retains ownership until the media connection is reset', async () => {
  const f = fixture();
  let forced = false,
    reconnecting = false,
    resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const connect = f.station.connect;
  f.station.connect = async () => {
    reconnecting = true;
    await gate;
    await connect();
  };
  f.station.stopLivestream = (_camera, force) => {
    forced = force;
  };
  try {
    const recovery = f.t.ensureLiveStopped('CAM');
    await delay(0);
    assert.equal(forced, true);
    assert.equal(await Promise.race([recovery, delay(10, 'pending')]), 'pending');
    f.ack();
    await delay(0);
    assert.equal(reconnecting, true);
    assert.equal(f.t.commands.has('HB'), true);
    await assert.rejects(f.t.startLive('CAM'), (error) => error.code === 'station_busy');
    assert.equal(await Promise.race([recovery, delay(10, 'pending')]), 'pending');
    resume();
    assert.equal((await recovery).confirmed, true);
    assert.equal(f.t.state('HB').connected, true);
    assert.equal(f.t.commands.size, 0);
  } finally {
    resume();
    await f.t.close();
  }
});
