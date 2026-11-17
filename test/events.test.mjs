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
const harness = (t, settle) => {
  const start = 1789052400000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start });
  const events = [];
  const d = new Detections(
    () => true,
    (e) => events.push(e),
    () => {},
    settle,
  );
  const at = (ms) => t.mock.timers.tick(ms - (Date.now() - start));
  return { start, events, d, at };
};
test('a copy with the same session inside the settling window is one ring', (t) => {
  const { start, events, d, at } = harness(t);
  const copy = { device_sn: 'BELL', event_type: 3103, event_session: 's1', type: 97 };
  d.push(copy);
  at(300);
  d.push({ ...copy, event_time: start });
  at(1000);
  assert.equal(events.length, 1);
  assert.equal(events[0].occurred_at, new Date(start).toISOString());
  d.close();
});
test('a late copy that adds a recognised name or recognition is delivered, not dropped', (t) => {
  const { start, events, d, at } = harness(t);
  d.push({ device_sn: 'CAM', event_type: 3102, unique_id: 'u1', type: 18 }, 'local');
  d.push({ device_sn: 'CAM2', event_type: 3102, unique_id: 'u2', type: 18 }, 'local');
  at(800);
  d.push({ device_sn: 'CAM2', event_type: 3112, event_session: 's2', type: 97 }, 'cloud');
  d.push(
    {
      device_sn: 'CAM',
      event_type: 3111,
      event_session: 's1',
      event_time: start + 300,
      person_name: 'Fixture Person',
      type: 97,
    },
    'cloud',
  );
  at(1500);
  assert.deepEqual(
    events.map((e) => [e.serial, e.recognition, e.person_name]),
    [
      ['CAM', 'unidentified', null],
      ['CAM2', 'unidentified', null],
      ['CAM2', 'unknown', null],
      ['CAM', 'known', 'Fixture Person'],
    ],
  );
  d.close();
});
test('a second press that only arrives by cloud is not taken for a lost copy', (t) => {
  const { start, events, d, at } = harness(t);
  d.push({ device_sn: 'BELL', event_type: 3103, unique_id: 'u1', type: 18 }, 'local');
  at(1200);
  // Occurred 1.2 s after the first copy arrived: a copy of that press cannot.
  d.push(
    {
      device_sn: 'BELL',
      event_type: 3103,
      event_session: 's2',
      event_time: start + 1200,
      type: 97,
    },
    'cloud',
  );
  at(2000);
  assert.equal(events.length, 2);
  d.close();
});
test('the transport is the push source with the payload type, an absent type included', (t) => {
  const { start, events, d, at } = harness(t);
  // Two local presses without msg_type are one transport: distinct rings.
  d.push({ device_sn: 'A', event_type: 3103, unique_id: 'u1' }, 'local');
  at(1000);
  d.push({ device_sn: 'A', event_type: 3103, unique_id: 'u2' }, 'local');
  // A cloud copy typed 18 like the local copy is still another transport.
  at(2000);
  d.push({ device_sn: 'B', event_type: 3103, unique_id: 'u3', type: 18 }, 'local');
  at(2555);
  d.push(
    { device_sn: 'B', event_type: 3103, event_session: 's3', event_time: start + 1973, type: 18 },
    'cloud',
  );
  // Distinct unmapped codes are distinct notifications.
  at(3000);
  d.push({ device_sn: 'C', event_type: 1, type: 18 }, 'local');
  at(4000);
  d.push({ device_sn: 'C', event_type: 2, type: 5 }, 'cloud');
  at(5000);
  assert.deepEqual(
    events.map((e) => e.serial),
    ['A', 'A', 'B', 'C', 'C'],
  );
  d.close();
});
test('the companion window ends 2 s after the first copy', (t) => {
  const { events, d, at } = harness(t);
  d.push({ device_sn: 'A', event_type: 3103, unique_id: 'a', type: 18 }, 'local');
  d.push({ device_sn: 'B', event_type: 3103, unique_id: 'b', type: 18 }, 'local');
  at(2000);
  d.push({ device_sn: 'A', event_type: 3103, event_session: 'sa', type: 97 }, 'cloud');
  at(2001);
  d.push({ device_sn: 'B', event_type: 3103, event_session: 'sb', type: 97 }, 'cloud');
  at(3000);
  assert.deepEqual(
    events.map((e) => e.serial),
    ['A', 'B', 'B'],
  );
  d.close();
});
test('late copies add their transport, identity and event time, and are remembered', (t) => {
  const { start, events, d, at } = harness(t);
  const local = { device_sn: 'BELL', event_type: 3103, unique_id: 'u1', type: 18 };
  const cloud = { device_sn: 'BELL', event_type: 3103, event_session: 's1', type: 97 };
  d.push(local, 'local');
  at(600);
  d.push(cloud, 'cloud');
  // The same session again, now with a time: matched by its identity.
  at(1000);
  d.push({ ...cloud, event_time: start - 27 }, 'cloud');
  // Another session over a transport this ring already used: a new ring.
  at(1200);
  d.push({ ...cloud, event_session: 's2', event_time: start - 27 }, 'cloud');
  // A copy over a third transport whose time disagrees with the learned time.
  at(1300);
  d.push(
    { device_sn: 'BELL', event_type: 3103, event_session: 's4', event_time: start - 1100, type: 5 },
    'cloud',
  );
  // A replay of a suppressed copy after the window stays suppressed.
  at(3000);
  d.push({ ...cloud, event_time: start - 27 }, 'cloud');
  at(4000);
  const iso = (ms) => new Date(ms).toISOString();
  assert.deepEqual(
    events.map((e) => e.occurred_at),
    [null, iso(start - 27), iso(start - 1100)],
  );
  assert.equal(d.metrics.duplicates, 3);
  d.close();
});
test('a repeated named copy follows the delivered named event, not the first match', (t) => {
  const { start, events, d, at } = harness(t);
  const named = {
    device_sn: 'CAM',
    event_type: 3111,
    event_session: 's1',
    person_name: 'Fixture Person',
    type: 97,
  };
  d.push({ device_sn: 'CAM', event_type: 3102, unique_id: 'u1', type: 18 }, 'local');
  at(600);
  d.push(named, 'cloud');
  at(1200);
  d.push({ ...named, event_time: start }, 'cloud');
  at(2000);
  assert.deepEqual(
    events.map((e) => [e.recognition, e.person_name]),
    [
      ['unidentified', null],
      ['known', 'Fixture Person'],
    ],
  );
  d.close();
});
test('device clock skew does not split copies that carry event times or share a session', (t) => {
  const { start, events, d, at } = harness(t);
  // Both copies carry the device time, 1.5 s ahead of the host.
  d.push(
    { device_sn: 'A', event_type: 3103, unique_id: 'u1', event_time: start + 1500, type: 18 },
    'local',
  );
  // Two cloud copies of one session, the second with a time 2 s ahead.
  d.push({ device_sn: 'B', event_type: 3103, event_session: 's2', type: 97 }, 'cloud');
  at(600);
  d.push(
    { device_sn: 'A', event_type: 3103, event_session: 's1', event_time: start + 1500, type: 97 },
    'cloud',
  );
  at(650);
  d.push(
    { device_sn: 'B', event_type: 3103, event_session: 's2', event_time: start + 2650, type: 97 },
    'cloud',
  );
  at(1500);
  assert.deepEqual(
    events.map((e) => e.serial),
    ['A', 'B'],
  );
  d.close();
});
test('an old delayed push is not taken for the late copy of a new ring', (t) => {
  const { start, events, d, at } = harness(t);
  d.push({ device_sn: 'BELL', event_type: 3103, unique_id: 'u1', type: 18 }, 'local');
  at(600);
  d.push(
    {
      device_sn: 'BELL',
      event_type: 3103,
      event_session: 's0',
      event_time: start - 30000,
      type: 97,
    },
    'cloud',
  );
  at(700);
  d.push(
    { device_sn: 'BELL', event_type: 3103, event_session: 's1', event_time: start - 27, type: 97 },
    'cloud',
  );
  at(1500);
  assert.deepEqual(
    events.map((e) => e.occurred_at),
    [null, new Date(start - 30000).toISOString()],
  );
  d.close();
});
test('codes, recognition and identity decide merges inside the settling window', (t) => {
  const { start, events, d, at } = harness(t);
  // A stranger copy and a later plain copy of one session keep the stranger.
  d.push({ device_sn: 'P', event_type: 3112, event_session: 's1', type: 97 }, 'cloud');
  // Distinct unmapped codes stay distinct.
  d.push({ device_sn: 'U', event_type: 1, type: 18 }, 'local');
  // A name goes to the pending event with the same session.
  d.push(
    { device_sn: 'G', event_type: 3102, unique_id: 'u1', event_time: start, type: 18 },
    'local',
  );
  at(100);
  d.push(
    { device_sn: 'G', event_type: 3102, event_session: 's2', event_time: start + 1500, type: 97 },
    'cloud',
  );
  at(200);
  d.push(
    { device_sn: 'P', event_type: 3102, event_session: 's1', event_time: start, type: 97 },
    'cloud',
  );
  d.push({ device_sn: 'U', event_type: 2, type: 5 }, 'cloud');
  d.push(
    {
      device_sn: 'G',
      event_type: 3111,
      event_session: 's2',
      person_name: 'Fixture Person',
      type: 97,
    },
    'cloud',
  );
  at(1000);
  assert.deepEqual(
    events.map((e) => [e.serial, e.eufy_event_type, e.recognition, e.person_name]),
    [
      ['P', 3102, 'unknown', null],
      ['U', 1, 'not_applicable', null],
      ['G', 3102, 'unidentified', null],
      ['G', 3111, 'known', 'Fixture Person'],
      ['U', 2, 'not_applicable', null],
    ],
  );
  d.close();
});
test('a late copy without an event code, and standalone copies typed 151, are one event', (t) => {
  const { start, events, d, at } = harness(t);
  d.push({ device_sn: 'N', event_type: 1, type: 18 }, 'local');
  d.push({ device_sn: 'S', event_type: 3101, unique_id: 'x', type: 151 }, 'local');
  at(600);
  d.push({ device_sn: 'N', type: 97 }, 'cloud');
  d.push(
    { device_sn: 'S', event_type: 3101, event_session: 'y', event_time: start, type: 151 },
    'cloud',
  );
  at(1500);
  assert.deepEqual(
    events.map((e) => e.serial),
    ['N', 'S'],
  );
  d.close();
});
test('a late copy with another name is delivered, and a late copy updates its own occurrence', (t) => {
  const { start, events, d, at } = harness(t);
  d.push(
    { device_sn: 'CAM', event_type: 3111, event_session: 's1', person_name: 'Alpha', type: 97 },
    'cloud',
  );
  d.push({ device_sn: 'BELL', event_type: 3103, unique_id: 'u1', type: 18 }, 'local');
  at(300);
  d.push({ device_sn: 'BELL', event_type: 3103, unique_id: 'u2', type: 18 }, 'local');
  at(600);
  d.push(
    { device_sn: 'CAM', event_type: 3111, unique_id: 'u9', person_name: 'Beta', type: 18 },
    'local',
  );
  // A cloud copy that names press 2 belongs to press 2, not to press 1.
  at(900);
  d.push(
    { device_sn: 'BELL', event_type: 3103, unique_id: 'u2', event_time: start + 300, type: 97 },
    'cloud',
  );
  // So press 1 has no event time yet, and its own copy still matches it.
  at(1000);
  d.push(
    { device_sn: 'BELL', event_type: 3103, unique_id: 'u1', event_time: start - 1900, type: 97 },
    'cloud',
  );
  at(1800);
  assert.deepEqual(
    events.map((e) => [e.serial, e.person_name]),
    [
      ['CAM', 'Alpha'],
      ['BELL', null],
      ['BELL', null],
      ['CAM', 'Beta'],
    ],
  );
  d.close();
});
test('a copy with the code of a notification that a device event relabelled merges into it', (t) => {
  const { events, d, at } = harness(t);
  d.push({ device_sn: 'X', event_type: 9999, type: 18 }, 'local');
  d.device('X', 'ring');
  at(200);
  d.push({ device_sn: 'X', event_type: 9999, type: 97 }, 'cloud');
  at(1000);
  assert.deepEqual(
    events.map((e) => [e.event_type, e.eufy_event_type]),
    [['ring', 9999]],
  );
  d.close();
});
test('a copy with the identity of a delivered ring is not merged into a pending second press', (t) => {
  const { start, events, d, at } = harness(t);
  const local = (id) => ({ device_sn: 'BELL', event_type: 3103, unique_id: id, type: 18 });
  const cloud = (session, time) => ({
    device_sn: 'BELL',
    event_type: 3103,
    event_session: session,
    ...(time === undefined ? {} : { event_time: start + time }),
    type: 97,
  });
  d.push(local('u1'), 'local');
  at(555);
  d.push(cloud('s1'), 'cloud');
  at(900);
  d.push(local('u2'), 'local');
  at(1205);
  d.push(cloud('s1', -27), 'cloud');
  at(1455);
  d.push(cloud('s2'), 'cloud');
  at(2105);
  d.push(cloud('s2', 873), 'cloud');
  at(3000);
  assert.equal(events.length, 2);
  assert.equal(d.metrics.duplicates, 4);
  d.close();
});
test('person copies find their own delivered event, and a stronger match is searched in every candidate', (t) => {
  const { events, d, at } = harness(t);
  for (const serial of ['F2', 'R']) {
    d.push({ device_sn: serial, event_type: 3102, unique_id: 'u1', type: 18 }, 'local');
  }
  at(300);
  for (const serial of ['F2', 'R']) {
    d.push(
      { device_sn: serial, event_type: 3111, unique_id: 'u2', person_name: 'Alpha', type: 18 },
      'local',
    );
  }
  at(600);
  d.push({ device_sn: 'F2', event_type: 3102, event_session: 's1', type: 97 }, 'cloud');
  at(900);
  for (const serial of ['F2', 'R']) {
    d.push(
      { device_sn: serial, event_type: 3111, event_session: 's2', person_name: 'Alpha', type: 97 },
      'cloud',
    );
  }
  at(2000);
  assert.deepEqual(
    events.map((e) => [e.serial, e.recognition, e.person_name]),
    [
      ['F2', 'unidentified', null],
      ['R', 'unidentified', null],
      ['F2', 'known', 'Alpha'],
      ['R', 'known', 'Alpha'],
    ],
  );
  d.close();
});
test('a merge keeps the event code, and an old push does not merge into a pending ring', (t) => {
  const { start, events, d, at } = harness(t);
  d.push({ device_sn: 'N', event_type: 1, type: 18 }, 'local');
  d.push({ device_sn: 'BELL', event_type: 3103, unique_id: 'u1', type: 18 }, 'local');
  at(100);
  d.push({ device_sn: 'N', type: 97 }, 'cloud');
  at(200);
  d.push({ device_sn: 'N', event_type: 2, type: 5 }, 'cloud');
  at(300);
  d.push(
    {
      device_sn: 'BELL',
      event_type: 3103,
      event_session: 's0',
      event_time: start - 30000,
      type: 97,
    },
    'cloud',
  );
  at(400);
  d.push(
    { device_sn: 'BELL', event_type: 3103, event_session: 's1', event_time: start - 27, type: 97 },
    'cloud',
  );
  at(1500);
  const iso = (ms) => new Date(ms).toISOString();
  assert.deepEqual(
    events.map((e) => [e.serial, e.eufy_event_type, e.occurred_at]),
    [
      ['N', 1, null],
      ['BELL', 3103, iso(start - 27)],
      ['N', 2, null],
      ['BELL', 3103, iso(start - 30000)],
    ],
  );
  d.close();
});
test('copies inside the time tolerances are one detection', (t) => {
  const { start, events, d, at } = harness(t);
  // A and B: local copies without time. C: a local copy with time.
  d.push({ device_sn: 'A', event_type: 3103, unique_id: 'a', type: 18 }, 'local');
  d.push({ device_sn: 'B', event_type: 3103, unique_id: 'b', type: 18 }, 'local');
  d.push(
    { device_sn: 'C', event_type: 3103, unique_id: 'c', event_time: start, type: 18 },
    'local',
  );
  // D and E: the same, still pending when the cloud copy arrives.
  d.push({ device_sn: 'D', event_type: 3103, unique_id: 'd', type: 18 }, 'local');
  d.push({ device_sn: 'E', event_type: 3103, unique_id: 'e', type: 18 }, 'local');
  at(300);
  d.push(
    { device_sn: 'D', event_type: 3103, event_session: 'sd', event_time: start + 900, type: 97 },
    'cloud',
  );
  d.push(
    { device_sn: 'E', event_type: 3103, event_session: 'se', event_time: start - 1900, type: 97 },
    'cloud',
  );
  at(555);
  // Occurred 0.9 s after and 1.9 s before the first copy arrived.
  d.push(
    { device_sn: 'A', event_type: 3103, event_session: 'sa', event_time: start + 900, type: 97 },
    'cloud',
  );
  d.push(
    { device_sn: 'B', event_type: 3103, event_session: 'sb', event_time: start - 1900, type: 97 },
    'cloud',
  );
  // Event times 0.9 s apart.
  d.push(
    { device_sn: 'C', event_type: 3103, event_session: 'sc', event_time: start + 900, type: 97 },
    'cloud',
  );
  at(1500);
  assert.deepEqual(
    events.map((e) => e.serial),
    ['A', 'B', 'C', 'D', 'E'],
  );
  d.close();
});
test('EventTransport passes the push source, so standalone copies typed 151 are one event', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1789052400000 });
  const transport = new EventTransport(
    { getEventSession: () => undefined },
    () => true,
    () => {},
  );
  const events = [];
  transport.on('event', (event) => events.push(event));
  transport.push(
    { device_sn: 'T84A1_FIXTURE', event_type: 3101, unique_id: 'u1', type: 151 },
    'local',
  );
  t.mock.timers.tick(600);
  transport.push(
    {
      device_sn: 'T84A1_FIXTURE',
      event_type: 3101,
      event_session: 's1',
      event_time: Date.now() - 580,
      type: 151,
    },
    'cloud',
  );
  t.mock.timers.tick(1000);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'motion');
  return transport.close();
});
