import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { EufyMegaClient } from '../dist/index.js';
import { SnapshotRefreshCounter } from '../dist/snapshot-refresh.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
import { mediaFixture } from './fixtures/media.mjs';
import { indoorMedia } from './fixtures/indoor-media.mjs';

// ha-eufy-cam#293: synthetic latest-info rows and picture replies. No hardware.
const e10 = indoorMedia.find((p) => p.model === 'T8404');
const jpeg = Buffer.from([255, 216, 255, 0, 255, 217]);
const triggers = ['push', 'request', 'connect'];
const rowKeys = [
  'no_row',
  'homebase_path',
  'unchanged_path',
  'cloud_path_only',
  'no_path',
  'path_absent',
  'invalid_path',
];
const changeKeys = ['first', 'increased', 'unchanged', 'decreased', 'unavailable'];
const downloadKeys = ['kept', 'not_jpeg', 'too_large', 'superseded', 'no_reply'];
const zeros = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
const perTrigger = (keys) => Object.fromEntries(triggers.map((t) => [t, zeros(keys)]));
const emptyModel = () => ({
  rows: perTrigger(rowKeys),
  eventCounts: perTrigger(changeKeys),
  downloads: zeros(downloadKeys),
});

/** Answers each latest-info query with the next rows and each download with `reply(path)`. */
function station(f, reply = () => jpeg) {
  const answers = [];
  f.station.databaseQueryLatestInfo = () => {
    const next = answers.shift();
    if (next) f.station.emit('database query latest', f.station, next.code ?? 0, next.rows);
  };
  f.station.downloadImage = (path) => {
    const data = reply(path);
    if (data) f.station.emit('image download', f.station, path, data);
  };
  return answers;
}
/** One push-triggered refresh, as processPush starts it 2 seconds after a push. */
function push(t, f, rows) {
  f.answers.push({ rows });
  f.transport.refreshSnapshots(f.camera.parent_sn);
  t.mock.timers.tick(2000);
}
const row = (f, fields) => ({ device_sn: f.camera.device_sn, ...fields });

test('a requested snapshot counts its reply, row and kept picture by model, without serial or path', async () => {
  const f = await mediaFixture(e10);
  try {
    f.answers = station(f);
    f.answers.push({ rows: [row(f, { event_count: 3, crop_local_path: '/synthetic/e10-1' })] });
    const image = await f.transport.snapshot(f.camera.device_sn);
    assert.deepEqual(image.data, jpeg);
    const status = f.transport.snapshotRefreshStatus();
    const expected = emptyModel();
    expected.rows.request.homebase_path = 1;
    expected.eventCounts.request.first = 1;
    expected.downloads.kept = 1;
    // models has no prototype, so a model can never be named like an Object property.
    assert.equal(Object.getPrototypeOf(status.models), null);
    assert.deepEqual(
      { ...status, models: { ...status.models } },
      {
        replies: { push: 0, request: 1, connect: 0 },
        failedReplies: 0,
        models: { T8404: expected },
      },
    );
    const text = JSON.stringify(status);
    for (const secret of [f.camera.device_sn, f.camera.parent_sn, 'synthetic'])
      assert.equal(text.includes(secret), false, secret);
  } finally {
    await f.close();
  }
});

test('push refreshes count each row outcome and event_count change, and fetch only new HomeBase paths', async (t) => {
  const f = await mediaFixture(e10);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const requested = [];
    f.answers = station(f, (path) => {
      requested.push(path);
      return jpeg;
    });
    push(t, f, [row(f, { event_count: 3, crop_local_path: '/synthetic/one' })]);
    push(t, f, [row(f, { event_count: 4, crop_local_path: '/synthetic/one' })]);
    push(t, f, [row(f, { event_count: 4, crop_local_path: '/synthetic/one' })]);
    push(t, f, [row(f, { event_count: 5, crop_local_path: '/synthetic/two' })]);
    push(t, f, [row(f, { event_count: 5, crop_cloud_path: '/synthetic/cloud' })]);
    push(t, f, [row(f, { event_count: 2, crop_cloud_path: '' })]);
    push(t, f, [row(f, { event_count: -1, crop_local_path: 'x'.repeat(2049) })]);
    push(t, f, [row(f, { crop_local_path: 7 })]);
    // The protocol layer's row for a reply without a crop_hb3_path field.
    push(t, f, [row(f, { event_count: 2, crop_local_path: undefined })]);
    push(t, f, []);
    push(t, f, [{ device_sn: 'UNADMITTED', event_count: 1, crop_local_path: '/synthetic/other' }]);
    assert.deepEqual(requested, ['/synthetic/one', '/synthetic/two']);
    assert.deepEqual(f.transport.snapshots.get(f.camera.device_sn).data, jpeg);
    const status = f.transport.snapshotRefreshStatus();
    assert.deepEqual(status.replies, { push: 11, request: 0, connect: 0 });
    const counts = status.models.T8404;
    assert.deepEqual(counts.rows.push, {
      no_row: 2,
      homebase_path: 2,
      unchanged_path: 2,
      cloud_path_only: 1,
      no_path: 1,
      path_absent: 1,
      invalid_path: 2,
    });
    assert.deepEqual(counts.eventCounts.push, {
      first: 1,
      increased: 2,
      unchanged: 3,
      decreased: 1,
      unavailable: 2,
    });
    assert.deepEqual(counts.downloads, { ...zeros(downloadKeys), kept: 2 });
    assert.deepEqual(Object.keys(status.models), ['T8404']);
  } finally {
    await f.close();
  }
});

test('download outcomes: superseded, no reply after 15 seconds, not a JPEG and too large', async (t) => {
  const f = await mediaFixture(e10);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let reply = () => undefined;
    f.answers = station(f, (path) => reply(path));
    const downloads = () => f.transport.snapshotRefreshStatus().models.T8404.downloads;
    push(t, f, [row(f, { event_count: 1, crop_local_path: '/synthetic/a' })]);
    // The same path again without a picture keeps waiting for the same reply.
    push(t, f, [row(f, { event_count: 1, crop_local_path: '/synthetic/a' })]);
    assert.equal(downloads().superseded, 0);
    push(t, f, [row(f, { event_count: 2, crop_local_path: '/synthetic/b' })]);
    assert.equal(downloads().superseded, 1);
    // A late reply for the superseded path is not counted again and not kept.
    f.station.emit('image download', f.station, '/synthetic/a', jpeg);
    assert.equal(f.transport.snapshots.has(f.camera.device_sn), false);
    t.mock.timers.tick(14_999);
    assert.equal(downloads().no_reply, 0);
    t.mock.timers.tick(1);
    assert.equal(downloads().no_reply, 1);
    reply = () => Buffer.from('synthetic text');
    push(t, f, [row(f, { event_count: 3, crop_local_path: '/synthetic/c' })]);
    const large = Buffer.alloc(5_000_001);
    large.set([255, 216, 255]);
    reply = () => large;
    push(t, f, [row(f, { event_count: 4, crop_local_path: '/synthetic/d' })]);
    assert.deepEqual(downloads(), {
      kept: 0,
      not_jpeg: 1,
      too_large: 1,
      superseded: 1,
      no_reply: 1,
    });
    assert.equal(f.transport.snapshots.has(f.camera.device_sn), false);
    // Nothing is waiting any more, so no later timer counts again.
    t.mock.timers.tick(60_000);
    assert.equal(downloads().no_reply, 1);
  } finally {
    await f.close();
  }
});

test('an unrequested reply counts as connect, a failed reply is counted and not read, and replies keep query order', async (t) => {
  const f = await mediaFixture(e10);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    f.answers = station(f);
    f.station.emit('database query latest', f.station, 0, [
      row(f, { event_count: 1, crop_cloud_path: '/synthetic/cloud' }),
    ]);
    f.station.emit('database query latest', f.station, -1, [
      row(f, { event_count: 2, crop_local_path: '/synthetic/failed' }),
    ]);
    assert.equal(f.transport.covers.has(f.camera.device_sn), false, 'a failed reply is not read');
    // Two queries in flight: the replies come back in the order they were asked.
    f.station.databaseQueryLatestInfo = () => {};
    f.transport.refreshSnapshots(f.camera.parent_sn);
    t.mock.timers.tick(2000);
    const asking = f.transport.snapshot(f.camera.device_sn);
    await turn();
    f.station.emit('database query latest', f.station, 0, [
      row(f, { event_count: 3, crop_local_path: '/synthetic/push' }),
    ]);
    f.station.emit('database query latest', f.station, 0, []);
    assert.deepEqual((await asking).data, jpeg);
    const status = f.transport.snapshotRefreshStatus();
    assert.deepEqual(status.replies, { push: 1, request: 1, connect: 1 });
    assert.equal(status.failedReplies, 1);
    const counts = status.models.T8404;
    assert.equal(counts.rows.connect.cloud_path_only, 1);
    assert.equal(counts.eventCounts.connect.first, 1);
    assert.equal(counts.rows.push.homebase_path, 1);
    assert.equal(counts.eventCounts.push.increased, 1);
    assert.equal(counts.rows.request.no_row, 1);
    assert.deepEqual(counts.eventCounts.request, zeros(changeKeys));
    assert.equal(counts.downloads.kept, 1);
  } finally {
    await f.close();
  }
});

test('closing the transport stops waiting for requested pictures and forgets queued queries', async (t) => {
  const f = await mediaFixture(e10);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.answers = station(f, () => undefined);
  push(t, f, [row(f, { event_count: 1, crop_local_path: '/synthetic/pending' })]);
  await f.close();
  t.mock.timers.tick(60_000);
  assert.equal(f.transport.snapshotRefreshStatus().models.T8404.downloads.no_reply, 0);
  assert.equal(f.transport.pendingImages.size, 0);
  assert.equal(f.transport.latestQueries.size, 0);
});

test('the counter keeps 16 models, then other, and names an absent model unknown', () => {
  const counter = new SnapshotRefreshCounter();
  for (let i = 0; i < 20; i++) counter.download(`T90${String(i).padStart(2, '0')}`, 'kept');
  counter.row(undefined, 'push', 'no_row', 'first');
  counter.row('', 'push', 'homebase_path', 'first');
  const status = counter.snapshot();
  assert.equal(Object.keys(status.models).length, 17);
  assert.equal(status.models.other.downloads.kept, 4);
  assert.equal(status.models.other.rows.push.no_row, 1);
  assert.equal(status.models.other.rows.push.homebase_path, 1);
  // A no_row has no event_count, so it is not counted as a change.
  assert.equal(status.models.other.eventCounts.push.first, 1);
  const fresh = new SnapshotRefreshCounter();
  fresh.row(undefined, 'connect', 'cloud_path_only', 'unavailable');
  assert.equal(fresh.snapshot().models.unknown.rows.connect.cloud_path_only, 1);
  // The snapshot is a copy.
  fresh.snapshot().models.unknown.rows.connect.cloud_path_only = 99;
  assert.equal(fresh.snapshot().models.unknown.rows.connect.cloud_path_only, 1);
});

test('the client reports zero counts before the device transport exists', () => {
  const client = new EufyMegaClient(cloudFixture({ inventory: [] }).options);
  const status = client.snapshotRefreshStatus;
  assert.deepEqual(
    { ...status, models: { ...status.models } },
    {
      replies: { push: 0, request: 0, connect: 0 },
      failedReplies: 0,
      models: {},
    },
  );
});

test("the session's own query on connect is matched first, so a request reply keeps its trigger", async () => {
  const f = await mediaFixture(e10);
  try {
    f.answers = station(f);
    f.station.hasCommand = () => true;
    f.station.emit('connect', f.station);
    f.station.databaseQueryLatestInfo = () => {};
    const asking = f.transport.snapshot(f.camera.device_sn);
    await turn();
    f.station.emit('database query latest', f.station, 0, [
      row(f, { event_count: 1, crop_cloud_path: '/synthetic/cloud' }),
    ]);
    f.station.emit('database query latest', f.station, 0, [
      row(f, { event_count: 2, crop_local_path: '/synthetic/request' }),
    ]);
    assert.deepEqual((await asking).data, jpeg);
    const status = f.transport.snapshotRefreshStatus();
    assert.deepEqual(status.replies, { push: 0, request: 1, connect: 1 });
    assert.equal(status.models.T8404.rows.connect.cloud_path_only, 1);
    assert.equal(status.models.T8404.rows.request.homebase_path, 1);
    // A station without the command sends no query of its own on connect.
    f.station.hasCommand = () => false;
    f.station.emit('connect', f.station);
    assert.equal(f.transport.latestQueries.get(f.camera.parent_sn).length, 0);
  } finally {
    await f.close();
  }
});

test('the query queue: a closed session forgets it, it keeps four, a query 15 seconds old is dropped and a throw unqueues', async (t) => {
  const f = await mediaFixture(e10);
  try {
    const id = f.camera.parent_sn;
    f.answers = station(f);
    f.station.databaseQueryLatestInfo = () => {};
    f.transport.queryLatest(id, f.station, 'push');
    f.station.emit('close', f.station);
    assert.equal(f.transport.latestQueries.has(id), false);
    f.transport.queryLatest(id, f.station, 'request');
    for (let i = 0; i < 4; i++) f.transport.queryLatest(id, f.station, 'push');
    assert.equal(f.transport.latestQueries.get(id).length, 4);
    for (let i = 0; i < 4; i++) f.station.emit('database query latest', f.station, 0, []);
    assert.deepEqual(f.transport.snapshotRefreshStatus().replies, {
      push: 4,
      request: 0,
      connect: 0,
    });
    let now = 1000;
    t.mock.method(performance, 'now', () => now);
    f.transport.queryLatest(id, f.station, 'request');
    now += 15_001;
    f.transport.queryLatest(id, f.station, 'push');
    f.station.emit('database query latest', f.station, 0, []);
    assert.deepEqual(f.transport.snapshotRefreshStatus().replies, {
      push: 5,
      request: 0,
      connect: 0,
    });
    f.station.databaseQueryLatestInfo = () => {
      throw new Error('synthetic');
    };
    assert.throws(() => f.transport.queryLatest(id, f.station, 'push'), /synthetic/);
    assert.equal(f.transport.latestQueries.get(id).length, 0);
  } finally {
    await f.close();
  }
});

test('a throw from downloadImage still propagates and leaves nothing waiting', async () => {
  const f = await mediaFixture(e10);
  try {
    f.answers = station(f);
    f.station.downloadImage = () => {
      throw new Error('synthetic');
    };
    assert.throws(
      () =>
        f.station.emit('database query latest', f.station, 0, [
          row(f, { event_count: 1, crop_local_path: '/synthetic/throw' }),
        ]),
      /synthetic/,
    );
    assert.equal(f.transport.pendingImages.size, 0);
    assert.equal(f.transport.snapshotRefreshStatus().models.T8404.rows.connect.homebase_path, 1);
  } finally {
    await f.close();
  }
});

test('a repeated request for the same path waits 15 seconds from the last request', async (t) => {
  const f = await mediaFixture(e10);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    f.answers = station(f, () => undefined);
    push(t, f, [row(f, { event_count: 1, crop_local_path: '/synthetic/slow' })]);
    t.mock.timers.tick(8000);
    push(t, f, [row(f, { event_count: 1, crop_local_path: '/synthetic/slow' })]);
    // 15 seconds after the first request, 7 after the second.
    t.mock.timers.tick(5000);
    f.station.emit('image download', f.station, '/synthetic/slow', jpeg);
    const downloads = f.transport.snapshotRefreshStatus().models.T8404.downloads;
    assert.deepEqual(downloads, { ...zeros(downloadKeys), kept: 1 });
    assert.deepEqual(f.transport.snapshots.get(f.camera.device_sn).data, jpeg);
  } finally {
    await f.close();
  }
});
