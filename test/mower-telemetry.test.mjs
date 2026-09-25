import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMowerTelemetry } from '../dist/index.js';
import { parseSchema } from '../dist/mowers/telemetry/schema.js';
import { fakeMower } from './fixtures/local-mower.mjs';
import { mowerClient } from './fixtures/mower-cloud.mjs';

// Synthetic product definition in the documented cloud schema shape. Invented codes and ids.
const schemaText = JSON.stringify([
  { id: 1, code: 'power_switch', mode: 'rw', type: 'obj', property: { type: 'bool' } },
  {
    id: 3,
    code: 'work_state',
    mode: 'ro',
    type: 'obj',
    property: {
      type: 'enum',
      range: ['standby', 'mowing', 'charging', 'returning', 'paused', 'fault'],
    },
  },
  {
    id: 6,
    code: 'battery_level',
    mode: 'ro',
    type: 'obj',
    property: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' },
  },
  {
    id: 7,
    code: 'temperature',
    mode: 'ro',
    type: 'obj',
    property: { type: 'value', min: -200, max: 800, scale: 1, step: 1, unit: 'C' },
  },
  { id: 8, code: 'net_kind', mode: 'ro', property: { type: 'enum', range: ['wifi', '4g'] } },
  {
    id: 9,
    code: 'rssi',
    mode: 'ro',
    type: 'obj',
    property: { type: 'value', min: -120, max: 0, scale: 0, step: 1, unit: 'dBm' },
  },
  { id: 101, code: 'session_blob', mode: 'ro', type: 'raw' },
  { id: 102, code: 'name_tag', mode: 'rw', type: 'obj', property: { type: 'string', maxlen: 8 } },
  { id: 103, code: 'faults', mode: 'ro', type: 'obj', property: { type: 'bitmap', maxlen: 4 } },
  {
    id: '104',
    code: 'progress_pct',
    mode: 'ro',
    type: 'obj',
    property: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' },
  },
  { id: 105, code: 'bad code!', mode: 'wr', type: 'obj', property: { type: 'bool' } },
  { id: 106, mode: 'ro', type: 'obj', property: { type: 'value', scale: 9 } },
  { id: 107, mode: 'ro', type: 'obj', property: { type: 'enum' } },
  { id: 0, code: 'zero', property: { type: 'bool' } },
  { id: 108, mode: 'xx', property: { type: 'bool' } },
  'junk',
  { id: 3, code: 'duplicate', property: { type: 'bool' } },
]);
const dps = {
  1: true,
  3: 'mowing',
  6: 87,
  7: 215,
  8: 'wifi',
  9: -61,
  101: 'AAECAw==',
  102: 'north',
  103: 5,
  104: 42,
  200: 'undeclared',
};
const snapshot = (values = dps) => ({
  source: 'local-tuya-3.5',
  observedAt: '2026-09-16T12:00:00.000Z',
  dps: structuredClone(values),
});
const definitions = [
  {
    field: 'status',
    dp: '3',
    level: 'confirmed',
    source: 'synthetic',
    decode: {
      kind: 'enum',
      values: {
        standby: 'idle',
        mowing: 'mowing',
        charging: 'charging',
        returning: 'returning',
        paused: 'paused',
        fault: 'error',
        flying: 'unknown',
      },
    },
  },
  {
    field: 'battery',
    dp: '6',
    level: 'confirmed',
    source: 'synthetic',
    decode: { kind: 'percent' },
  },
  {
    field: 'progress',
    dp: '104',
    level: 'confirmed',
    source: 'synthetic',
    decode: { kind: 'percent' },
  },
  {
    field: 'network',
    dp: '8',
    level: 'confirmed',
    source: 'synthetic',
    decode: { kind: 'enum', values: { wifi: 'wifi', '4g': 'cellular' } },
  },
  {
    field: 'network',
    dp: '9',
    level: 'confirmed',
    source: 'synthetic',
    decode: { kind: 'signal_dbm' },
  },
];
const reported = (value, dp) => ({
  state: 'reported',
  value,
  dp,
  source: 'local-tuya-3.5',
  observedAt: '2026-09-16T12:00:00.000Z',
});

test('the schema parser accepts the documented entry shapes and skips invalid, duplicate and oversized input', () => {
  const schema = parseSchema(schemaText);
  assert.deepEqual(
    schema.map((entry) => entry.id),
    ['1', '3', '6', '7', '8', '9', '101', '102', '103', '104', '105'],
  );
  assert.deepEqual(schema[0], { id: '1', code: 'power_switch', mode: 'rw', type: 'bool' });
  assert.deepEqual(schema[1], {
    id: '3',
    code: 'work_state',
    mode: 'ro',
    type: 'enum',
    range: ['standby', 'mowing', 'charging', 'returning', 'paused', 'fault'],
  });
  assert.deepEqual(schema[3], {
    id: '7',
    code: 'temperature',
    mode: 'ro',
    type: 'value',
    min: -200,
    max: 800,
    scale: 1,
    step: 1,
    unit: 'C',
  });
  assert.deepEqual(schema[4], {
    id: '8',
    code: 'net_kind',
    mode: 'ro',
    type: 'enum',
    range: ['wifi', '4g'],
  });
  assert.deepEqual(schema[6], { id: '101', code: 'session_blob', mode: 'ro', type: 'raw' });
  assert.deepEqual(schema[7], {
    id: '102',
    code: 'name_tag',
    mode: 'rw',
    type: 'string',
    maxlen: 8,
  });
  assert.deepEqual(schema[8], { id: '103', code: 'faults', mode: 'ro', type: 'bitmap', maxlen: 4 });
  assert.equal(schema[9].id, '104');
  assert.deepEqual(schema[10], { id: '105', mode: 'wr', type: 'bool' });
  assert.deepEqual(parseSchema(JSON.parse(schemaText)), schema);
  for (const bad of [undefined, null, 'not json', '{}', '[]', 'x'.repeat(70000), [{ id: 5 }]])
    assert.equal(parseSchema(bad), undefined);
  assert.equal(
    parseSchema(Array.from({ length: 513 }, (_, i) => ({ id: i + 1, property: { type: 'bool' } }))),
    undefined,
  );
  assert.equal(parseSchema([{ id: 1, property: { type: 'bool' } }])[0].mode, 'rw');
});

test('the decoder types every reported data point by the device declaration and passes raw values through', () => {
  const schema = parseSchema(schemaText);
  const input = snapshot();
  const telemetry = decodeMowerTelemetry(input, { schema, definitions: [] });
  assert.equal(telemetry.source, 'local-tuya-3.5');
  assert.equal(telemetry.observedAt, input.observedAt);
  assert.deepEqual(telemetry.fields['1'], {
    id: '1',
    value: true,
    declared: true,
    type: 'bool',
    code: 'power_switch',
    valid: true,
  });
  assert.deepEqual(telemetry.fields['3'], {
    id: '3',
    value: 'mowing',
    declared: true,
    type: 'enum',
    code: 'work_state',
    valid: true,
  });
  assert.deepEqual(telemetry.fields['6'], {
    id: '6',
    value: 87,
    declared: true,
    type: 'value',
    code: 'battery_level',
    valid: true,
    unit: '%',
  });
  assert.deepEqual(telemetry.fields['7'], {
    id: '7',
    value: 215,
    declared: true,
    type: 'value',
    code: 'temperature',
    valid: true,
    unit: 'C',
    scaled: 21.5,
  });
  assert.deepEqual(telemetry.fields['101'], {
    id: '101',
    value: 'AAECAw==',
    declared: true,
    type: 'raw',
    code: 'session_blob',
    valid: true,
  });
  assert.deepEqual(telemetry.fields['102'], {
    id: '102',
    value: 'north',
    declared: true,
    type: 'string',
    code: 'name_tag',
    valid: true,
  });
  assert.deepEqual(telemetry.fields['103'], {
    id: '103',
    value: 5,
    declared: true,
    type: 'bitmap',
    code: 'faults',
    valid: true,
  });
  assert.deepEqual(telemetry.fields['200'], { id: '200', value: 'undeclared', declared: false });
  const wrong = decodeMowerTelemetry(
    snapshot({ 1: 'x', 3: 'flying', 6: 150, 7: 2.5, 101: 5, 102: 'toolongname', 103: 16, 9: -130 }),
    { schema },
  );
  for (const id of ['1', '3', '6', '7', '101', '102', '103', '9'])
    assert.equal(wrong.fields[id].valid, false, id);
  assert.equal(wrong.fields['7'].scaled, undefined);
  assert.deepEqual(telemetry.dps, dps);
  telemetry.dps[6] = 0;
  telemetry.fields['3'].value = 'changed';
  assert.equal(input.dps[6], 87);
  assert.equal(decodeMowerTelemetry(input, { schema }).fields['3'].value, 'mowing');
  for (const name of ['status', 'battery', 'progress', 'network'])
    assert.deepEqual(telemetry[name], { state: 'unconfirmed' });
  assert.deepEqual(decodeMowerTelemetry(input).fields['6'], {
    id: '6',
    value: 87,
    declared: false,
  });
  for (const bad of [
    undefined,
    {},
    { source: 'cloud', observedAt: 'x', dps: {} },
    { source: 'local-tuya-3.5', dps: {} },
  ])
    assert.throws(() => decodeMowerTelemetry(bad), TypeError);
});

test('confirmed definitions produce typed values with source and observation time, others report unconfirmed with their best level', () => {
  const schema = parseSchema(schemaText);
  const telemetry = decodeMowerTelemetry(snapshot(), { schema, definitions });
  assert.deepEqual(telemetry.status, reported('mowing', ['3']));
  assert.deepEqual(telemetry.battery, reported({ percent: 87 }, ['6']));
  assert.deepEqual(telemetry.progress, reported({ percent: 42 }, ['104']));
  assert.deepEqual(telemetry.network, reported({ kind: 'wifi', signalDbm: -61 }, ['8', '9']));
  const lower = definitions.map((definition, index) => ({
    ...definition,
    level: index % 2 ? 'hypothesis' : 'observed',
  }));
  const withheld = decodeMowerTelemetry(snapshot(), { schema, definitions: lower });
  assert.deepEqual(withheld.status, { state: 'unconfirmed', level: 'observed' });
  assert.deepEqual(withheld.battery, { state: 'unconfirmed', level: 'hypothesis' });
  assert.deepEqual(withheld.network, { state: 'unconfirmed', level: 'observed' });
  const mixed = decodeMowerTelemetry(snapshot(), {
    schema,
    definitions: [{ ...definitions[1], dp: '7', level: 'hypothesis' }, definitions[1]],
  });
  assert.deepEqual(mixed.battery, reported({ percent: 87 }, ['6']));
  const boolean = decodeMowerTelemetry(snapshot(), {
    definitions: [
      {
        field: 'status',
        dp: '1',
        level: 'confirmed',
        source: 'synthetic',
        decode: { kind: 'boolean', on: 'mowing', off: 'idle' },
      },
    ],
  });
  assert.deepEqual(boolean.status, reported('mowing', ['1']));
  assert.equal(
    decodeMowerTelemetry(snapshot({ 1: false }), {
      definitions: boolean.status && [
        {
          field: 'status',
          dp: '1',
          level: 'confirmed',
          source: 'synthetic',
          decode: { kind: 'boolean', on: 'mowing', off: 'idle' },
        },
      ],
    }).status.value,
    'idle',
  );
  const partial = decodeMowerTelemetry(snapshot({ 9: -70 }), { schema, definitions });
  assert.deepEqual(partial.network, reported({ signalDbm: -70 }, ['8', '9']));
});

test('missing, wrong-typed, out-of-range and unknown values never become typed values', () => {
  const schema = parseSchema(schemaText);
  const decode = (values, options = {}) =>
    decodeMowerTelemetry(snapshot(values), { schema, definitions, ...options });
  assert.deepEqual(decode({ 3: 'mowing' }).battery, { state: 'missing', dp: ['6'] });
  assert.deepEqual(decode({ 3: 'mowing' }).network, { state: 'missing', dp: ['8', '9'] });
  for (const value of ['eighty', 150, 50.5, -1, true, null, [87], { percent: 87 }])
    assert.deepEqual(decode({ 6: value }).battery, { state: 'invalid', dp: ['6'] }, String(value));
  assert.deepEqual(decode({ 104: 101 }).progress, { state: 'invalid', dp: ['104'] });
  assert.deepEqual(decode({ 3: 'sleeping' }).status, { state: 'invalid', dp: ['3'] });
  // The definition maps the value, but the device declaration does not list it.
  assert.deepEqual(decode({ 3: 'flying' }).status, { state: 'invalid', dp: ['3'] });
  assert.deepEqual(
    decode({ 3: 'flying' }, { schema: undefined }).status,
    reported('unknown', ['3']),
  );
  assert.deepEqual(
    decode(
      { 3: 'mowing' },
      {
        definitions: [{ ...definitions[0], decode: { kind: 'enum', values: { mowing: 'bogus' } } }],
      },
    ).status,
    { state: 'invalid', dp: ['3'] },
  );
  assert.deepEqual(decode({ 8: 'wifi', 9: 5 }).network, { state: 'invalid', dp: ['8', '9'] });
  assert.deepEqual(decode({ 8: 'lte' }).network, { state: 'invalid', dp: ['8', '9'] });
  assert.deepEqual(
    decode(
      { 1: 'true' },
      {
        definitions: [
          {
            field: 'status',
            dp: '1',
            level: 'confirmed',
            source: 'synthetic',
            decode: { kind: 'boolean', on: 'mowing', off: 'idle' },
          },
        ],
      },
    ).status,
    { state: 'invalid', dp: ['1'] },
  );
  const empty = decode({});
  assert.deepEqual(Object.keys(empty.fields), []);
  assert.deepEqual(empty.status, { state: 'missing', dp: ['3'] });
});

test('a session exposes the device schema and decodes telemetry through the mower module', async (t) => {
  const peer = await fakeMower(t, {
    respond: () => JSON.stringify({ dps, devId: 'SYNTHETIC-DEVICE-ID' }),
  });
  const { mowers, id } = await mowerClient(t, { schema: schemaText });
  const session = await mowers.openLocalSession(id, { host: peer.host, port: peer.port });
  const schema = session.schema;
  assert.equal(schema.length, 11);
  schema.length = 0;
  assert.equal(session.schema.length, 11);
  const telemetry = await session.queryTelemetry();
  assert.equal(telemetry.source, 'local-tuya-3.5');
  assert.ok(!Number.isNaN(Date.parse(telemetry.observedAt)));
  assert.deepEqual(telemetry.fields['6'], {
    id: '6',
    value: 87,
    declared: true,
    type: 'value',
    code: 'battery_level',
    valid: true,
    unit: '%',
  });
  assert.deepEqual(telemetry.fields['200'], { id: '200', value: 'undeclared', declared: false });
  // The shipped registry carries confirmed DP 107 candidates, so an absent point is missing.
  assert.deepEqual(telemetry.status, { state: 'missing', dp: ['107', '107', '107', '107'] });
  assert.deepEqual(telemetry.progress, { state: 'unconfirmed' });
  // This invented product schema does not supply valid E15 battery/network data points.
  assert.deepEqual(telemetry.battery, { state: 'invalid', dp: ['8'] });
  assert.deepEqual(telemetry.network, { state: 'missing', dp: ['134', '109'] });
  assert.deepEqual(telemetry.dps, dps);
  const custom = decodeMowerTelemetry(await session.queryStatus(), {
    schema: session.schema,
    definitions,
  });
  assert.equal(custom.status.value, 'mowing');
  assert.deepEqual(custom.battery.value, { percent: 87 });
  assert.deepEqual(custom.network.value, { kind: 'wifi', signalDbm: -61 });
  await session.disconnect();
  await assert.rejects(session.queryTelemetry(), { code: 'mower_local_disconnected' });
  const plain = await mowerClient(t, { schema: 'not json' });
  const bare = await plain.mowers.openLocalSession(plain.id, { host: peer.host, port: peer.port });
  assert.equal(bare.schema, undefined);
  assert.deepEqual((await bare.queryTelemetry()).fields['6'], {
    id: '6',
    value: 87,
    declared: false,
  });
  await bare.disconnect();
});
