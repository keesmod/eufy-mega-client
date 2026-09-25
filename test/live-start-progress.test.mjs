import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { DeviceTransport } from '../dist/device-transport.js';
import { P2PClientProtocol } from '../dist/vendor/p2p/session.js';
import { P2PDataType } from '../dist/vendor/p2p/types.js';

// The stages of a live start that a consumer records through onProgress. Fake
// stations stand in for the HomeBase: `answer` is its reply to START and
// `noData` the P2P library giving the stream up for lack of media.
const START = 1003;
const STOP = 1004;
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
    disposed: 0,
    getSerial: () => serial,
    hasProperty: () => false,
    isConnected: () => connected,
    connect: async () => {
      connected = true;
      station.emit('encryption ready', station, 'lan-derived');
    },
    // The default station delivers metadata. Tests replace this to hold it back.
    startLivestream: (camera) => {
      station.starts++;
      queueMicrotask(() => station.play(camera.getChannel()));
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
    play: (channel) =>
      station.emit(
        'livestream start',
        station,
        channel,
        metadata,
        new Readable({ read() {} }),
        new Readable({ read() {} }),
      ),
    answer: (channel, code, type = START) =>
      station.emit('command result', station, { command_type: type, channel, return_code: code }),
    noData: (channel) => station.emit('livestream no data', station, channel),
    ack: (channel) =>
      station.emit('command result', station, { command_type: STOP, channel, return_code: 0 }),
  });
  return station;
}
function fixture(options = { maxLiveStreamsPerStation: 2 }, configure = () => {}) {
  const t = new DeviceTransport(options);
  const primary = fakeStation('HB', true);
  const extras = [];
  t.createExtraStation = async () => {
    const station = fakeStation('HB');
    configure(station);
    extras.push(station);
    return station;
  };
  t.stations.set('HB', primary);
  t.encryption.set('HB', 'lan-derived');
  for (const channel of [1, 2]) {
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
  return { t, primary, extras };
}
const stages = (list) => list.map(({ stage, returnCode }) => ({ stage, returnCode }));
function assertProgress(list) {
  let last = 0;
  for (const progress of list) {
    assert.deepEqual(
      Object.keys(progress).filter((key) => !['stage', 'elapsedMs', 'returnCode'].includes(key)),
      [],
    );
    assert.ok(Number.isInteger(progress.elapsedMs) && progress.elapsedMs >= last);
    assert.ok(progress.elapsedMs <= 3_600_000);
    last = progress.elapsedMs;
  }
}
// Hold START on the extra session, as a HomeBase that answers but sends no stream.
const holdStart = (station) => {
  station.startLivestream = () => {
    station.starts++;
  };
};

test('a start answered with 0 reports every stage up to the metadata', async () => {
  const f = fixture(undefined, (station) => {
    station.startLivestream = (camera) => {
      station.starts++;
      queueMicrotask(() => {
        station.answer(camera.getChannel(), 0);
        station.play(camera.getChannel());
      });
    };
  });
  const seen = [];
  try {
    const stream = await f.t.startLive('CAM1', undefined, undefined, (p) => seen.push(p));
    assert.deepEqual(stages(seen), [
      { stage: 'session_ready', returnCode: undefined },
      { stage: 'start_issued', returnCode: undefined },
      { stage: 'start_result', returnCode: 0 },
      { stage: 'metadata', returnCode: undefined },
    ]);
    assertProgress(seen);
    // A START answer after the start resolved is no longer part of this start.
    f.extras[0].answer(1, 7);
    assert.equal(seen.length, 4);
    const stopping = stream.stop();
    f.extras[0].ack(1);
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
  } finally {
    await f.t.close();
  }
});

test('a refused START reports its return code and no metadata before the caller cancels', async () => {
  const f = fixture(undefined, holdStart);
  const seen = [];
  const abort = new AbortController();
  try {
    const starting = f.t.startLive('CAM1', abort.signal, undefined, (p) => seen.push(p));
    await delay(0);
    f.extras[0].answer(1, -133);
    const rejected = assert.rejects(starting, (error) => error.code === 'cancelled');
    abort.abort();
    await delay(0);
    f.extras[0].ack(1);
    await rejected;
    assert.deepEqual(stages(seen), [
      { stage: 'session_ready', returnCode: undefined },
      { stage: 'start_issued', returnCode: undefined },
      { stage: 'start_result', returnCode: -133 },
    ]);
    assertProgress(seen);
  } finally {
    await f.t.close();
  }
});

test('an accepted START without media reports the library ending the stream', async () => {
  const f = fixture(undefined, holdStart);
  const seen = [];
  const abort = new AbortController();
  try {
    const starting = f.t.startLive('CAM1', abort.signal, undefined, (p) => seen.push(p));
    await delay(0);
    f.extras[0].answer(1, 0);
    // Another channel's end belongs to another camera.
    f.extras[0].noData(2);
    f.extras[0].noData(1);
    const rejected = assert.rejects(starting, (error) => error.code === 'cancelled');
    abort.abort();
    await delay(0);
    f.extras[0].ack(1);
    await rejected;
    assert.deepEqual(stages(seen), [
      { stage: 'session_ready', returnCode: undefined },
      { stage: 'start_issued', returnCode: undefined },
      { stage: 'start_result', returnCode: 0 },
      { stage: 'no_data_end', returnCode: undefined },
    ]);
  } finally {
    await f.t.close();
  }
});

test('a START without any answer reports only the issue before the caller cancels', async () => {
  const f = fixture(undefined, holdStart);
  const seen = [];
  const abort = new AbortController();
  try {
    const starting = f.t.startLive('CAM1', abort.signal, undefined, (p) => seen.push(p));
    await delay(0);
    // Answers to other commands or channels are not the answer to this START.
    f.extras[0].answer(2, 0);
    f.extras[0].answer(1, 0, STOP);
    const rejected = assert.rejects(starting, (error) => error.code === 'cancelled');
    abort.abort();
    await delay(0);
    f.extras[0].ack(1);
    await rejected;
    assert.deepEqual(stages(seen), [
      { stage: 'session_ready', returnCode: undefined },
      { stage: 'start_issued', returnCode: undefined },
    ]);
  } finally {
    await f.t.close();
  }
});

test('a session that never becomes ready reports no stage and issues no START', async () => {
  const f = fixture(undefined, (station) => {
    station.connect = async () => {};
  });
  const seen = [];
  const abort = new AbortController();
  try {
    const starting = f.t.startLive('CAM1', abort.signal, undefined, (p) => seen.push(p));
    await delay(0);
    const rejected = assert.rejects(starting, (error) => error.code === 'cancelled');
    abort.abort();
    await rejected;
    assert.deepEqual(seen, []);
    assert.equal(f.extras[0].starts, 0);
    assert.equal(f.extras[0].disposed, 1);
  } finally {
    await f.t.close();
  }
});

test('the primary session reports the same stages', async () => {
  const f = fixture({});
  f.primary.startLivestream = (camera) => {
    f.primary.starts++;
    queueMicrotask(() => {
      f.primary.answer(camera.getChannel(), 0);
      f.primary.play(camera.getChannel());
    });
  };
  const seen = [];
  try {
    const stream = await f.t.startLive('CAM1', undefined, undefined, (p) => seen.push(p));
    assert.equal(f.extras.length, 0);
    assert.deepEqual(
      seen.map((p) => p.stage),
      ['session_ready', 'start_issued', 'start_result', 'metadata'],
    );
    const stopping = stream.stop();
    f.primary.ack(1);
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
  } finally {
    await f.t.close();
  }
});

test('a throwing callback, a repeated answer and an unbounded code leave the start unchanged', async () => {
  const f = fixture(undefined, (station) => {
    station.startLivestream = (camera) => {
      station.starts++;
      queueMicrotask(() => {
        station.answer(camera.getChannel(), 2 ** 40);
        station.answer(camera.getChannel(), 0);
        station.play(camera.getChannel());
      });
    };
  });
  const seen = [];
  try {
    const stream = await f.t.startLive('CAM1', undefined, undefined, (p) => {
      seen.push(p);
      throw new Error('consumer failure');
    });
    assert.deepEqual(stages(seen), [
      { stage: 'session_ready', returnCode: undefined },
      { stage: 'start_issued', returnCode: undefined },
      { stage: 'start_result', returnCode: undefined },
      { stage: 'metadata', returnCode: undefined },
    ]);
    assert.equal(f.t.extraLives.get('HB#live:1').handle, stream);
    const stopping = stream.stop();
    f.extras[0].ack(1);
    assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
  } finally {
    await f.t.close();
  }
});

test('the P2P session reports a video stream it gives up before any media', async () => {
  const run = (dataType, started) => {
    const protocol = Object.create(P2PClientProtocol.prototype);
    const events = [];
    protocol.emit = (...args) => events.push(args);
    protocol.currentMessageState = {};
    protocol.streamTimeouts = { streamStartWait: 5, streamDataWait: 5 };
    protocol.rawStation = { station_sn: 'FIXTURE' };
    protocol.deviceSNs = {};
    const ends = [];
    protocol.endStream = (type, sendStop) => ends.push({ type, sendStop });
    protocol.initializeMessageState(dataType);
    protocol.currentMessageState[dataType].p2pStreaming = true;
    protocol.currentMessageState[dataType].p2pStreamChannel = 3;
    protocol.currentMessageState[dataType].p2pStreamNotStarted = !started;
    protocol.waitForStreamData(dataType, true);
    return { events, ends };
  };
  const quiet = run(P2PDataType.VIDEO, false);
  const playing = run(P2PDataType.VIDEO, true);
  const binary = run(P2PDataType.BINARY, false);
  await delay(30);
  assert.deepEqual(quiet.events, [['livestream no data', 3]]);
  assert.deepEqual(quiet.ends, [{ type: P2PDataType.VIDEO, sendStop: true }]);
  // A stream that started keeps its stop event, and downloads are not live starts.
  assert.deepEqual(playing.events, []);
  assert.deepEqual(binary.events, []);
  assert.equal(playing.ends.length + binary.ends.length, 2);
});
