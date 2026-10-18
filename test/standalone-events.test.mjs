import test from 'node:test';
import assert from 'node:assert/strict';
import { decideStandalonePush, StandalonePushCounter } from '../dist/standalone-events.js';

// ha-eufy-cam#185: the admission rule and the numbers-only counter for pushes that
// name an experimental standalone owner. All inputs are synthetic.
const ID = 'T84A1_FIXTURE';
const owner = (extra = {}) =>
  Object.freeze({
    id: ID,
    type: 151,
    events: true,
    available: true,
    detects: () => true,
    ...extra,
  });
const push = (extra = {}) =>
  Object.freeze({ device_sn: ID, station_sn: ID, type: 151, event_type: 3101, ...extra });
const refused = (reason) => ({ admitted: false, reason });

test('the rule admits only numeric 3101 and 3102 as motion and person', () => {
  assert.deepEqual(decideStandalonePush(owner(), push()), { admitted: true, detection: 'motion' });
  assert.deepEqual(decideStandalonePush(owner(), push({ event_type: 3102 })), {
    admitted: true,
    detection: 'person',
  });
});

test('the rule checks its five rules in a fixed order', () => {
  // Events off wins over everything, also an unavailable camera and a wrong serial.
  assert.deepEqual(
    decideStandalonePush(
      owner({ events: false, available: false }),
      push({ device_sn: 'OTHER', type: 18, event_type: 9 }),
    ),
    refused('events_not_enabled'),
  );
  assert.deepEqual(
    decideStandalonePush(
      owner({ available: false }),
      push({ device_sn: 'OTHER', type: 18, event_type: 9 }),
    ),
    refused('owner_unavailable'),
  );
  assert.deepEqual(
    decideStandalonePush(owner(), push({ device_sn: 'OTHER', type: 18, event_type: 9 })),
    refused('serial_mismatch'),
  );
  assert.deepEqual(
    decideStandalonePush(owner(), push({ type: 18, event_type: 9 })),
    refused('type_mismatch'),
  );
  assert.deepEqual(
    decideStandalonePush(owner(), push({ event_type: 9 })),
    refused('unsupported_event'),
  );
});

test('the rule refuses another or an empty serial on either side', () => {
  for (const extra of [
    { device_sn: 'T8161_FIXTURE' },
    { device_sn: '' },
    { device_sn: undefined },
    { station_sn: 'T8030_OWNER' },
    { station_sn: '' },
  ])
    assert.deepEqual(decideStandalonePush(owner(), push(extra)), refused('serial_mismatch'));
});

test('the rule refuses a push type other than the numeric device type', () => {
  for (const type of [18, 31, 10900, undefined, '151'])
    assert.deepEqual(decideStandalonePush(owner(), push({ type })), refused('type_mismatch'));
});

test('the rule refuses every other event code and a missing detection', () => {
  for (const event_type of [
    '3101',
    3101.5,
    NaN,
    3103,
    3104,
    3105,
    3106,
    3107,
    3111,
    3112,
    3303,
    1,
    9,
    10,
    10900,
    null,
    undefined,
  ])
    assert.deepEqual(
      decideStandalonePush(owner(), push({ event_type })),
      refused('unsupported_event'),
      String(event_type),
    );
  const asked = [];
  const detects = (type) => {
    asked.push(type);
    return type === 'person';
  };
  assert.deepEqual(decideStandalonePush(owner({ detects }), push()), refused('unsupported_event'));
  assert.deepEqual(decideStandalonePush(owner({ detects }), push({ event_type: 3102 })), {
    admitted: true,
    detection: 'person',
  });
  assert.deepEqual(asked, ['motion', 'person']);
});

const sum = (record) => Object.values(record).reduce((a, b) => a + b, 0);
const invariants = (o) => {
  assert.equal(o.arrived, o.admitted + sum(o.refused));
  assert.equal(o.arrived, sum(o.sources));
  assert.equal(o.arrived, sum(o.eventCodes));
  assert.equal(o.arrived, sum(o.pushTypes));
  const leaves = (value) =>
    typeof value === 'object' ? Object.values(value).flatMap(leaves) : [value];
  for (const leaf of leaves(o)) assert.ok(Number.isSafeInteger(leaf) && leaf >= 0, String(leaf));
};

test('the counter starts at zero with every refusal key', () => {
  const o = new StandalonePushCounter().snapshot();
  assert.deepEqual(o, {
    arrived: 0,
    admitted: 0,
    refused: {
      events_not_enabled: 0,
      owner_unavailable: 0,
      serial_mismatch: 0,
      type_mismatch: 0,
      unsupported_event: 0,
    },
    sources: { cloud: 0, local: 0 },
    eventCodes: {},
    pushTypes: {},
  });
  invariants(o);
});

test('the counter records each delivery once and keeps its invariants', () => {
  const counter = new StandalonePushCounter();
  const record = (message, source, o = owner()) =>
    counter.record(decideStandalonePush(o, message), message, source);
  record(push(), 'cloud');
  record(push({ event_type: 3102 }), 'local');
  record(push({ event_type: 9 }), 'cloud');
  record(push({ type: 18 }), 'local');
  record(push({ event_type: undefined, type: undefined }), 'cloud');
  record(push(), 'cloud', owner({ events: false }));
  const o = counter.snapshot();
  assert.deepEqual(o, {
    arrived: 6,
    admitted: 2,
    refused: {
      events_not_enabled: 1,
      owner_unavailable: 0,
      serial_mismatch: 0,
      type_mismatch: 2,
      unsupported_event: 1,
    },
    sources: { cloud: 4, local: 2 },
    eventCodes: { 3101: 3, 3102: 1, 9: 1, none: 1 },
    pushTypes: { 151: 4, 18: 1, none: 1 },
  });
  invariants(o);
});

test('the counter bounds its histograms and copies its snapshots', () => {
  const counter = new StandalonePushCounter();
  for (let i = 0; i < 40; i++) {
    const message = push({ event_type: 4000 + i, type: 200 + i });
    counter.record(decideStandalonePush(owner(), message), message, 'cloud');
  }
  for (const value of [-1, 100000, 1.5, '12', null]) {
    const message = push({ event_type: value, type: value });
    counter.record(decideStandalonePush(owner(), message), message, 'cloud');
  }
  const o = counter.snapshot();
  for (const histogram of [o.eventCodes, o.pushTypes]) {
    const numeric = Object.keys(histogram).filter((k) => /^\d+$/.test(k));
    assert.equal(numeric.length, 16);
    assert.equal(histogram.other, 24 + 4);
    assert.equal(histogram.none, 1);
  }
  invariants(o);
  o.arrived = 99;
  o.refused.serial_mismatch = 99;
  o.eventCodes.other = 99;
  const again = counter.snapshot();
  assert.equal(again.arrived, 45);
  assert.equal(again.refused.serial_mismatch, 0);
  assert.equal(again.eventCodes.other, 28);
});

test('the observation carries no serial, address, name, URL or path', () => {
  const counter = new StandalonePushCounter();
  for (const extra of [
    {},
    { event_type: 3102, person_name: 'Synthetic Person' },
    { device_sn: 'T8161_FIXTURE', event_type: 10 },
    { station_sn: 'T8030_OWNER' },
  ]) {
    const message = push({
      pic_url: 'https://example.invalid/image.jpg',
      file_path: '/media/mmcblk0p1/Camera00/clip.dat',
      name: 'Synthetic Wall Light',
      title: '192.168.1.5',
      event_session: 'session-1',
      unique_id: 'unique-1',
      ...extra,
    });
    counter.record(decideStandalonePush(owner(), message), message, 'cloud');
  }
  const text = JSON.stringify(counter.snapshot());
  for (const secret of [
    'T84A1',
    'T8161',
    'T8030',
    'FIXTURE',
    'example',
    'image',
    'mmcblk',
    'Synthetic',
    '192.168',
    'session',
    'unique',
  ])
    assert.equal(text.includes(secret), false, secret);
  invariants(counter.snapshot());
});
