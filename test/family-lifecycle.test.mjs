import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { Detections } from '../dist/detections.js';
import { batteryDoorbellMedia } from './fixtures/battery-doorbell-media.mjs';
import { eufycamMedia } from './fixtures/eufycam-media.mjs';
import { solocamMedia } from './fixtures/solocam-media.mjs';
import { walllightMedia } from './fixtures/walllight-media.mjs';
import { families } from './fixtures/families.mjs';
import { mediaFixture } from './fixtures/media.mjs';

for (const p of [
  ...walllightMedia,
  ...batteryDoorbellMedia.slice(1),
  ...solocamMedia.filter((p) => p.model !== 'T8134'),
  ...families.filter((p) => p.admitted),
  ...eufycamMedia.filter((p) => !['T8142', 'T8160'].includes(p.model)),
]) {
  test(`${p.id}: duplicate start/stop events preserve one stream and one confirmed outcome`, async () => {
    const f = await mediaFixture(p),
      outcomes = [];
    f.transport.on('live-stop', (event) => outcomes.push(event));
    try {
      const opening = f.transport.startLive(f.camera.device_sn);
      await turn();
      f.startEvent(f.camera.device_channel + 1);
      assert.equal(f.transport.lives.size, 0);
      f.startEvent();
      const stream = await opening;
      f.startEvent();
      assert.equal(f.transport.lives.size, 1);
      assert.equal(f.transport.lives.get(f.camera.parent_sn).handle, stream);
      assert.equal(f.counts.starts, 1);
      assert.equal(stream.metadata.videoCodec, 'h264');
      const stopping = stream.stop();
      f.station.emit('livestream stop', f.station, f.camera.device_channel);
      f.ack(0, f.camera.device_channel + 1);
      assert.equal(outcomes.length, 0);
      assert.equal(f.transport.lives.size, 1);
      f.ack();
      f.ack();
      assert.deepEqual(await stopping, { confirmed: true, reason: 'device' });
      assert.equal(outcomes.length, 1);
      assert.equal(f.counts.stops, 1);
      assert.equal(f.transport.lives.size, 0);
    } finally {
      await f.close();
    }
  });
  test(`${p.id}: cancelled start retains ownership until STOP acknowledgement`, async () => {
    const f = await mediaFixture(p),
      abort = new AbortController(),
      outcomes = [];
    f.transport.on('live-stop', (e) => outcomes.push(e));
    try {
      const opening = f.transport.startLive(f.camera.device_sn, abort.signal);
      const rejected = assert.rejects(opening, { code: 'cancelled' });
      await turn();
      abort.abort('PRIVATE_CANCEL_REASON');
      await turn();
      assert.equal(f.counts.starts, 1);
      assert.equal(f.counts.stops, 1);
      assert.equal(f.transport.starting.size, 1);
      await assert.rejects(f.transport.startLive(f.camera.device_sn), { code: 'station_busy' });
      assert.equal(outcomes.length, 0);
      f.ack();
      await rejected;
      assert.equal(f.transport.starting.size, 0);
      assert.deepEqual(
        outcomes.map(({ confirmed, reason }) => ({ confirmed, reason })),
        [{ confirmed: true, reason: 'device' }],
      );
    } finally {
      await f.close();
    }
  });
  test(`${p.id}: missing stop acknowledgement times out and closes the connection`, async (t) => {
    const f = await mediaFixture(p),
      outcomes = [];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    f.transport.on('live-stop', (e) => outcomes.push(e));
    try {
      const opening = f.transport.startLive(f.camera.device_sn);
      await turn();
      f.startEvent();
      const stream = await opening,
        stopping = stream.stop();
      t.mock.timers.tick(7999);
      assert.equal(outcomes.length, 0);
      assert.equal(f.transport.lives.size, 1);
      t.mock.timers.tick(1);
      assert.deepEqual(await stopping, { confirmed: false, reason: 'timeout' });
      assert.equal(f.counts.closes, 1);
      assert.equal(f.transport.lives.size, 0);
      f.ack();
      assert.equal(outcomes.length, 1, 'late ACK cannot turn a timeout into success');
      assert.equal(outcomes[0].confirmed, false);
    } finally {
      await f.close();
    }
  });
  test(`${p.id}: cancellation with no STOP acknowledgement releases only after bounded failure`, async (t) => {
    const f = await mediaFixture(p),
      abort = new AbortController(),
      outcomes = [];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    f.transport.on('live-stop', (e) => outcomes.push(e));
    try {
      const opening = f.transport.startLive(f.camera.device_sn, abort.signal);
      const rejected = assert.rejects(opening, { code: 'cancelled' });
      await turn();
      abort.abort();
      await turn();
      t.mock.timers.tick(7999);
      assert.equal(f.transport.starting.size, 1);
      t.mock.timers.tick(1);
      await rejected;
      assert.equal(f.transport.starting.size, 0);
      assert.equal(f.counts.closes, 1);
      assert.equal(f.counts.starts, 1);
      assert.equal(f.counts.stops, 1);
      assert.equal(outcomes[0].confirmed, false);
    } finally {
      await f.close();
    }
  });
  test(`${p.id}: duplicate detection delivery and restored replay stay suppressed`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1789052400000 });
    const events = [],
      id = `${p.model}_SYNTHETIC`;
    const make = () =>
      new Detections(
        (candidate) => candidate === id,
        (e) => events.push(e),
        () => {},
        5,
      );
    let detections = make();
    try {
      const message = {
        device_sn: id,
        station_sn: 'T8030_SYNTHETIC',
        event_type: 3111,
        event_time: Date.now(),
        unique_id: 'SYNTHETIC_EVENT',
        type: 1,
        person_name: 'Synthetic Person',
      };
      detections.device(id, 'motion');
      detections.push(message);
      detections.push(message);
      t.mock.timers.tick(5);
      assert.equal(events.length, 1);
      assert.equal(events[0].person_name, 'Synthetic Person');
      const seen = detections.exportSeen();
      detections.close();
      detections = make();
      detections.restoreSeen(seen);
      detections.push(message);
      t.mock.timers.tick(5);
      assert.equal(events.length, 1);
      detections.push({ ...message, unique_id: 'NEXT_SYNTHETIC_EVENT' });
      t.mock.timers.tick(5);
      assert.equal(events.length, 2);
    } finally {
      detections.close();
    }
  });
}

test('restored duplicate cache rejects expired and overlong entries', (t) => {
  const now = 1789052400000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  const events = [],
    make = () =>
      new Detections(
        () => true,
        (event) => events.push(event),
        () => {},
        5,
      );
  const message = {
    device_sn: 'SYNTHETIC_CAMERA',
    event_type: 3111,
    event_time: now,
    unique_id: 'SYNTHETIC_EVENT',
    type: 1,
  };
  const original = make();
  original.push(message);
  t.mock.timers.tick(5);
  const saved = original.exportSeen();
  original.close();
  const key = Object.keys(saved)[0];
  assert.ok(key);
  for (const offset of [0, 300001]) {
    const expiry = Date.now() + offset;
    const restored = make();
    try {
      restored.restoreSeen({ [key]: expiry });
      assert.deepEqual(restored.exportSeen(), {});
      const count = events.length;
      restored.push(message);
      t.mock.timers.tick(5);
      assert.equal(events.length, count + 1);
    } finally {
      restored.close();
    }
  }
});
