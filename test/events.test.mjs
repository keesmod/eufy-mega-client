import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Detections } from '../dist/detections.js';
import { PushClient } from '../dist/vendor/push/client.js';
import { PushNotificationService } from '../dist/vendor/push/service.js';
import { EventTransport } from '../dist/event-transport.js';
import { EventEmitter } from 'node:events';
test('shutdown cancels pending event startup without waiting for its request timeout', async () => {
  const original = PushNotificationService.initialize;
  const service = Object.assign(new EventEmitter(), {
    open: async () => new Promise(() => {}),
    close() {},
    getPersistentIds: () => [],
  });
  PushNotificationService.initialize = async () => service;
  const transport = new EventTransport(
    { getEventSession: () => undefined },
    () => true,
    () => {},
  );
  try {
    const opening = transport.open();
    const rejected = assert.rejects(opening, (error) => error.code === 'cancelled');
    await delay(0);
    await transport.close();
    await rejected;
    assert.equal(transport.active, false);
  } finally {
    PushNotificationService.initialize = original;
    await transport.close();
  }
});
test('FCM parser reset keeps exactly one delivery subscription across reconnects', async () => {
  const client = await PushClient.init({ androidId: '123', securityToken: '456' });
  let connections = 0;
  client.on('connect', () => connections++);
  try {
    for (let i = 0; i < 3; i++) {
      client.initialize();
      assert.equal(client.pushClientParser.listenerCount('message'), 1);
      client.pushClientParser.emit('message', { tag: 3, object: {} });
    }
    assert.equal(connections, 3);
  } finally {
    client.close();
  }
});
test('person identity survives cross-transport duplicates and restart replay is suppressed', async () => {
  const events = [];
  let d = new Detections(
    (id) => id === 'CAM',
    (e) => events.push(e),
    () => {},
    5,
  );
  const message = {
    device_sn: 'CAM',
    station_sn: 'HB',
    event_type: 3111,
    event_time: Date.now(),
    unique_id: 'event-1',
    type: 1,
    person_name: 'Fixture Person',
  };
  d.device('CAM', 'motion');
  d.push(message);
  d.push({ ...message, type: 2 });
  await delay(15);
  assert.equal(events.length, 1);
  assert.equal(events[0].person_name, 'Fixture Person');
  assert.equal(events[0].recognition, 'known');
  const seen = d.exportSeen();
  d.close();
  d = new Detections(
    (id) => id === 'CAM',
    (e) => events.push(e),
    () => {},
    5,
  );
  d.restoreSeen(seen);
  d.push(message);
  await delay(15);
  assert.equal(events.length, 1);
  d.push({ ...message, unique_id: 'event-2' });
  await delay(15);
  assert.equal(events.length, 2);
  d.close();
});
test('doorbell events stay distinct and shutdown clears pending delivery', async () => {
  const events = [],
    d = new Detections(
      (id) => id === 'BELL',
      (e) => events.push(e),
      () => {},
      5,
    );
  for (const id of ['ring-1', 'ring-2'])
    d.push({ device_sn: 'BELL', event_type: 3103, event_time: Date.now(), unique_id: id, type: 1 });
  await delay(15);
  assert.equal(events.length, 2);
  assert.equal(events[0].event_type, 'ring');
  d.device('BELL', 'motion');
  d.close();
  await delay(15);
  assert.equal(events.length, 2);
});
test('a late copy of a delivered ring is suppressed, a second press is not (ha-eufy-cam#252)', (t) => {
  const start = 1789052400000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  const events = [],
    d = new Detections(
      (id) => id === 'BELL',
      (e) => events.push(e),
      () => {},
    );
  // HomeBase session copy: raw unique_id and no event time. Cloud copy: event
  // session and event time, 555 ms later, after the first copy was delivered.
  const local = (id) => ({ device_sn: 'BELL', event_type: 3103, unique_id: id, type: 18 });
  const cloud = (session, time) => ({
    device_sn: 'BELL',
    event_type: 3103,
    event_session: session,
    event_time: time,
    type: 97,
  });
  d.push(local('press-1'));
  t.mock.timers.tick(500);
  assert.equal(events.length, 1);
  assert.equal(events[0].occurred_at, null);
  t.mock.timers.tick(55);
  d.push(cloud('session-1', start - 27));
  t.mock.timers.tick(500);
  assert.equal(events.length, 1);
  // A second press 1.5 s after the first is its own ring, and so is its cloud copy's occurrence.
  t.mock.timers.tick(445);
  d.push(local('press-2'));
  t.mock.timers.tick(500);
  assert.equal(events.length, 2);
  t.mock.timers.tick(55);
  d.push(cloud('session-2', start + 1500));
  t.mock.timers.tick(500);
  assert.equal(events.length, 2);
  assert.equal(d.metrics.duplicates, 2);
  d.close();
});
test('two cloud copies of one press with the same session are one ring', (t) => {
  const start = 1789052400000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  const events = [],
    d = new Detections(
      () => true,
      (e) => events.push(e),
      () => {},
    );
  const copy = { device_sn: 'BELL', event_type: 3103, event_session: 'session-1', type: 97 };
  d.push(copy);
  t.mock.timers.tick(650);
  d.push({ ...copy, event_time: start });
  t.mock.timers.tick(500);
  assert.equal(events.length, 1);
  // Another session over the same transport stays a distinct ring.
  d.push({ ...copy, event_session: 'session-2', event_time: start + 1200 });
  t.mock.timers.tick(500);
  assert.equal(events.length, 2);
  d.close();
});
test('late copies are only matched within the companion window and with agreeing times', (t) => {
  const start = 1789052400000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  const events = [],
    d = new Detections(
      () => true,
      (e) => events.push(e),
      () => {},
    );
  d.push({ device_sn: 'CAM', event_type: 3101, event_time: start, unique_id: 'a', type: 18 });
  t.mock.timers.tick(600);
  // Another transport, but an event time 1.5 s later: a different motion.
  d.push({
    device_sn: 'CAM',
    event_type: 3101,
    event_time: start + 1500,
    event_session: 'b',
    type: 97,
  });
  t.mock.timers.tick(500);
  assert.equal(events.length, 2);
  // Another transport without event time, but after the 2 s window: delivered.
  t.mock.timers.tick(2000);
  d.push({ device_sn: 'CAM', event_type: 3101, event_session: 'c', type: 5 });
  t.mock.timers.tick(500);
  assert.equal(events.length, 3);
  d.close();
});
