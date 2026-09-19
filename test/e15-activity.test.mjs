import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeMowerTelemetry,
  E15_TELEMETRY_DEFINITIONS,
  parseMowerWirePayload,
} from '../dist/index.js';
import { parseSchema } from '../dist/mowers/telemetry/schema.js';
import { e15Schema, e15Dps } from './fixtures/e15-telemetry.mjs';

// Synthetic payload builder. It reproduces only the established envelope: base64 text of
// wire records whose tag is (field number << 3) | wire type, with base-128 varints.
// No device capture, identifier or mower-fork constant is included.
const varint = (value) => {
  const out = [];
  let rest = BigInt(value);
  while (rest > 0x7fn) {
    out.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  out.push(Number(rest));
  return out;
};
const record = (number, type, body) => [...varint(BigInt(number) * 8n + BigInt(type)), ...body];
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
/** Varint-only message in ascending field order, e.g. status({ 1: 2, 3: 1 }). */
const status = (fields) =>
  b64(
    Object.entries(fields)
      .sort(([a], [b]) => Number(a) - Number(b))
      .flatMap(([number, value]) => record(Number(number), 0, varint(value))),
  );
const bytesOf = (bytes) => Array.from(bytes);

const schema = parseSchema(e15Schema);
const observedAt = '2026-09-16T17:00:00.000Z';
const snapshot = (dps) => ({ source: 'local-tuya-3.5', observedAt, dps });
const decode = (dps, options = {}) => decodeMowerTelemetry(snapshot(dps), { schema, ...options });
const candidates = E15_TELEMETRY_DEFINITIONS.filter((entry) => entry.dp === '107');
const confirmed = candidates.map((entry) => ({ ...entry, level: 'confirmed' }));
const observed = candidates.map((entry) => ({ ...entry, level: 'observed' }));
const shipped = (value) => ({
  state: 'reported',
  value,
  dp: ['107', '107', '107'],
  source: 'local-tuya-3.5',
  observedAt,
});

test('the parser exposes the established DP 107 envelope: ascending varint records with omitted zero fields', () => {
  assert.deepEqual(parseMowerWirePayload(status({ 1: 2, 3: 1 })), {
    shape: 'fields',
    byteLength: 4,
    fields: [
      { number: 1, wire: 'varint', value: 2 },
      { number: 3, wire: 'varint', value: 1 },
    ],
  });
  const full = parseMowerWirePayload(status({ 1: 2, 2: 9, 3: 1 }));
  assert.equal(full.byteLength, 6);
  assert.deepEqual(
    full.fields.map((field) => [field.number, field.value]),
    [
      [1, 2],
      [2, 9],
      [3, 1],
    ],
  );
  // Omitted field 1 and a lone field 6 were also observed. Field order is not required.
  assert.deepEqual(
    parseMowerWirePayload(status({ 2: 5, 3: 1 })).fields.map((f) => f.number),
    [2, 3],
  );
  assert.deepEqual(parseMowerWirePayload(status({ 6: 1 })).fields, [
    { number: 6, wire: 'varint', value: 1 },
  ]);
  assert.deepEqual(
    parseMowerWirePayload(b64([...record(3, 0, varint(1)), ...record(1, 0, varint(2))])).fields.map(
      (f) => f.number,
    ),
    [3, 1],
  );
  // Multi-byte varints and large field numbers stay structural values.
  const big = parseMowerWirePayload(status({ 1: 300, 536870911: Number.MAX_SAFE_INTEGER }));
  assert.deepEqual(big.fields, [
    { number: 1, wire: 'varint', value: 300 },
    { number: 536870911, wire: 'varint', value: Number.MAX_SAFE_INTEGER },
  ]);
});

test('the parser reports the observed default payload and copies other wire types without decoding them', () => {
  assert.deepEqual(parseMowerWirePayload('AA=='), { shape: 'default', byteLength: 1, fields: [] });
  assert.deepEqual(parseMowerWirePayload(''), { shape: 'default', byteLength: 0, fields: [] });
  const mixed = parseMowerWirePayload(
    b64([
      ...record(1, 0, varint(2)),
      ...record(2, 2, [3, 7, 8, 9]),
      ...record(4, 2, [0]),
      ...record(5, 1, [1, 2, 3, 4, 5, 6, 7, 8]),
      ...record(7, 5, [9, 9, 9, 9]),
    ]),
  );
  assert.equal(mixed.shape, 'fields');
  assert.deepEqual(
    mixed.fields.map((field) => [field.number, field.wire]),
    [
      [1, 'varint'],
      [2, 'bytes'],
      [4, 'bytes'],
      [5, 'fixed64'],
      [7, 'fixed32'],
    ],
  );
  assert.deepEqual(bytesOf(mixed.fields[1].value), [7, 8, 9]);
  assert.deepEqual(bytesOf(mixed.fields[2].value), []);
  assert.deepEqual(bytesOf(mixed.fields[3].value), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(bytesOf(mixed.fields[4].value), [9, 9, 9, 9]);
  // A nested message is bytes, not fields. Nothing is recursed into.
  const nested = parseMowerWirePayload(
    b64(record(2, 2, [...varint(2), ...record(1, 0, varint(7))])),
  );
  assert.equal(nested.fields[0].wire, 'bytes');
  assert.deepEqual(bytesOf(nested.fields[0].value), [8, 7]);
});

test('the parser names the first fault of malformed and truncated input and never throws', () => {
  const reason = (value) => parseMowerWirePayload(value).reason;
  for (const value of [undefined, null, 7, true, {}, [], Buffer.from([8, 2])])
    assert.equal(reason(value), 'not_text');
  for (const value of ['CAI', 'CA=', '@@@@', 'CAI=\n', 'CAI==', ' CAI=', 'CAI=CAI='])
    assert.equal(reason(value), 'not_base64');
  assert.equal(reason(b64([8])), 'truncated');
  assert.equal(reason(b64([8, 2, 0x18])), 'truncated');
  assert.equal(reason(b64([8, 0x82])), 'truncated');
  assert.equal(reason(b64([0x0a, 5, 1, 2])), 'truncated');
  assert.equal(reason(b64([0x0d, 1, 2, 3])), 'truncated');
  assert.equal(reason(b64([0x09, 1, 2, 3, 4, 5, 6, 7])), 'truncated');
  assert.equal(reason(b64([0x0a, 0x81, 0x02, ...new Array(200).fill(1)])), 'truncated');
  assert.equal(reason(b64([0, 1])), 'field_number');
  assert.equal(reason(b64([0x08, 2, 0x00, 1])), 'field_number');
  assert.equal(reason(b64([...varint(536870912n * 8n), 1])), 'field_number');
  assert.equal(reason(b64([...varint(4294967296n * 8n), 1])), 'field_number');
  for (const type of [3, 4, 6, 7]) assert.equal(reason(b64(record(1, type, []))), 'wire_type');
  assert.equal(reason(b64([8, ...new Array(11).fill(0x80)])), 'varint');
  assert.equal(reason(b64([8, ...new Array(10).fill(0x80), 1, 0])), 'varint');
  assert.equal(reason(b64([8, ...varint(2n ** 53n)])), 'varint');
  assert.equal(
    parseMowerWirePayload(b64([8, ...varint(2n ** 53n - 1n)])).fields[0].value,
    2 ** 53 - 1,
  );
  assert.equal(reason(b64([...new Array(11).fill(0x80), 1])), 'varint');
  assert.equal(parseMowerWirePayload(b64([0])).shape, 'default');
  assert.equal(reason(b64([0, 0])), 'field_number');
});

test('the parser bounds payload size and record count', () => {
  const limit = b64(record(1, 2, [...varint(253), ...new Array(253).fill(0)]));
  assert.equal(parseMowerWirePayload(limit).byteLength, 256);
  assert.equal(parseMowerWirePayload(limit).fields[0].value.length, 253);
  const over = b64(record(1, 2, [...varint(254), ...new Array(254).fill(0)]));
  assert.deepEqual(parseMowerWirePayload(over), {
    shape: 'malformed',
    byteLength: 257,
    reason: 'too_long',
  });
  assert.deepEqual(parseMowerWirePayload('A'.repeat(348)), {
    shape: 'malformed',
    byteLength: 0,
    reason: 'too_long',
  });
  const records = (count) => b64(new Array(count).fill(0).flatMap(() => record(1, 0, varint(1))));
  assert.equal(parseMowerWirePayload(records(32)).fields.length, 32);
  assert.equal(parseMowerWirePayload(records(33)).reason, 'too_many_fields');
});

test('parser results are fresh copies that consumers can mutate safely', () => {
  const text = status({ 1: 2, 3: 1 });
  const first = parseMowerWirePayload(text);
  const second = parseMowerWirePayload(text);
  assert.notEqual(first, second);
  assert.notEqual(first.fields, second.fields);
  first.fields[0].value = 99;
  first.fields.push({ number: 9, wire: 'varint', value: 9 });
  assert.deepEqual(second.fields, [
    { number: 1, wire: 'varint', value: 2 },
    { number: 3, wire: 'varint', value: 1 },
  ]);
  const bytes = b64(record(2, 2, [3, 1, 2, 3]));
  const a = parseMowerWirePayload(bytes);
  const b = parseMowerWirePayload(bytes);
  a.fields[0].value[0] = 200;
  assert.deepEqual(bytesOf(b.fields[0].value), [1, 2, 3]);
  assert.equal(a.fields[0].value.buffer.byteLength, 3);
});

test('the E15 registry reports the confirmed DP 107 candidates and withholds every other payload', () => {
  assert.deepEqual(
    candidates.map((entry) => [entry.level, entry.decode.kind, entry.decode.activity]),
    [
      ['confirmed', 'wire', 'mowing'],
      ['confirmed', 'wire', 'paused'],
      ['confirmed', 'wire', 'returning'],
    ],
  );
  assert.ok(
    candidates.every(
      (entry) => entry.source === 'docs/research/E15_ROBOT_STATUS_REPRODUCTION_2026-09-19.md',
    ),
  );
  // The shapes reproduced in the 2026-09-19 window, including the transient field 2 values
  // that arrive during defogging, at the change to mowing and while positioning.
  for (const [payload, activity] of [
    [status({ 1: 2, 3: 1 }), 'mowing'],
    [status({ 1: 2, 2: 9, 3: 1 }), 'mowing'],
    [status({ 1: 2, 2: 3, 3: 1 }), 'mowing'],
    [status({ 1: 2, 3: 2 }), 'paused'],
    [status({ 1: 1, 3: 1 }), 'returning'],
    [status({ 1: 1, 2: 1, 3: 1 }), 'returning'],
  ]) {
    const telemetry = decode({ ...e15Dps, 107: payload });
    assert.deepEqual(telemetry.status, shipped(activity), payload);
    assert.equal(telemetry.fields['107'].valid, true);
    assert.equal(telemetry.fields['107'].type, 'raw');
    assert.equal(telemetry.fields['107'].code, 'robot_status');
    assert.equal(telemetry.fields['107'].wire.shape, 'fields');
    assert.deepEqual(telemetry.battery.value, { percent: 73 });
    assert.deepEqual(telemetry.network.value, { kind: 'wifi', signalPercent: 54 });
    assert.equal(telemetry.dps['107'], payload);
  }
  // Transitional first frames, the map-saving phase, field 6, the default payload and
  // unknown combinations are withheld as invalid rather than guessed.
  for (const payload of [
    status({ 1: 2 }),
    status({ 1: 1 }),
    status({ 2: 5, 3: 1 }),
    status({ 6: 1 }),
    status({ 1: 2, 3: 3 }),
    status({ 1: 3, 3: 1 }),
    'AA==',
  ]) {
    const telemetry = decode({ ...e15Dps, 107: payload });
    assert.deepEqual(telemetry.status, { state: 'invalid', dp: ['107', '107', '107'] }, payload);
    assert.equal(telemetry.fields['107'].valid, true);
    assert.ok(['fields', 'default'].includes(telemetry.fields['107'].wire.shape));
    assert.deepEqual(telemetry.battery.value, { percent: 73 });
  }
  const malformed = decode({ ...e15Dps, 107: b64([8]) });
  assert.deepEqual(malformed.status, { state: 'invalid', dp: ['107', '107', '107'] });
  assert.deepEqual(malformed.fields['107'].wire, {
    shape: 'malformed',
    byteLength: 1,
    reason: 'truncated',
  });
  assert.equal(decode(e15Dps).fields['107'], undefined);
  assert.deepEqual(decode(e15Dps).status, { state: 'missing', dp: ['107', '107', '107'] });
  // Without the registry there is no structural parse either, and other raw points are untouched.
  const bare = decode({ ...e15Dps, 107: status({ 1: 2, 3: 1 }), 108: status({ 2: 1, 3: 1 }) });
  assert.equal(bare.fields['108'].wire, undefined);
  assert.equal(bare.fields['108'].declared, false);
  const optOut = decode({ ...e15Dps, 107: status({ 1: 2, 3: 1 }) }, { definitions: [] });
  assert.deepEqual(optOut.status, { state: 'unconfirmed' });
  assert.equal(optOut.fields['107'].wire, undefined);
  // The same candidates at a lower level are withheld again and expose only structure.
  const withheld = decode({ ...e15Dps, 107: status({ 1: 2, 3: 1 }) }, { definitions: observed });
  assert.deepEqual(withheld.status, { state: 'unconfirmed', level: 'observed' });
  assert.equal(withheld.fields['107'].wire.shape, 'fields');
  // A wrong-typed value or a non-raw declaration gets no structural parse.
  assert.equal(decode({ ...e15Dps, 107: 5 }).fields['107'].wire, undefined);
  assert.equal(decode({ ...e15Dps, 107: 5 }).fields['107'].valid, false);
  const declaredValue = schema.map((entry) =>
    entry.id === '107' ? { ...entry, type: 'value', min: 0, max: 10 } : entry,
  );
  assert.equal(
    decodeMowerTelemetry(snapshot({ 107: status({ 1: 2 }) }), { schema: declaredValue }).fields[
      '107'
    ].wire,
    undefined,
  );
});

test('a consumer with its own confirmed evidence receives typed activity only for matching candidates', () => {
  const typed = (dps, definitions = confirmed) => decode(dps, { definitions }).status;
  const reported = (value) => ({
    state: 'reported',
    value,
    dp: ['107', '107', '107'],
    source: 'local-tuya-3.5',
    observedAt,
  });
  assert.deepEqual(typed({ 107: status({ 1: 2, 3: 1 }) }), reported('mowing'));
  assert.deepEqual(typed({ 107: status({ 1: 2, 2: 6, 3: 1 }) }), reported('mowing'));
  assert.deepEqual(typed({ 107: status({ 1: 2, 3: 2 }) }), reported('paused'));
  assert.deepEqual(typed({ 107: status({ 1: 1, 3: 1 }) }), reported('returning'));
  assert.deepEqual(typed({ 107: status({ 1: 1, 2: 1, 3: 1 }) }), reported('returning'));
  // Unknown combinations, the default payload, an omitted matched field, unknown wire types,
  // repeated fields and malformed input are withheld as invalid, never guessed.
  for (const payload of [
    status({ 1: 2 }),
    status({ 1: 1 }),
    status({ 1: 7, 3: 1 }),
    status({ 1: 2, 3: 3 }),
    status({ 2: 5, 3: 1 }),
    status({ 3: 1 }),
    status({ 6: 1 }),
    'AA==',
    '',
    b64([...record(1, 0, varint(2)), ...record(3, 2, [1])]),
    b64([...record(1, 0, varint(2)), ...record(1, 0, varint(2)), ...record(3, 0, varint(1))]),
    b64([8]),
    'not base64',
  ])
    assert.deepEqual(
      typed({ 107: payload }),
      { state: 'invalid', dp: ['107', '107', '107'] },
      payload,
    );
  assert.deepEqual(typed({}), { state: 'missing', dp: ['107', '107', '107'] });
  assert.deepEqual(typed({ 107: 2 }), { state: 'invalid', dp: ['107', '107', '107'] });
  assert.deepEqual(typed({ 107: null }), { state: 'invalid', dp: ['107', '107', '107'] });
  // A single confirmed candidate reports only itself.
  assert.deepEqual(typed({ 107: status({ 1: 2, 3: 2 }) }, [confirmed[0]]), {
    state: 'invalid',
    dp: ['107'],
  });
  assert.equal(typed({ 107: status({ 1: 2, 3: 1 }) }, [confirmed[0]]).value, 'mowing');
  // Mixed levels: only the confirmed candidate can report, the observed ones stay withheld.
  const mixed = [confirmed[0], observed[1], observed[2]];
  assert.equal(typed({ 107: status({ 1: 2, 3: 1 }) }, mixed).value, 'mowing');
  assert.deepEqual(typed({ 107: status({ 1: 2, 3: 2 }) }, mixed), {
    state: 'invalid',
    dp: ['107'],
  });
  // Definition errors and the declaration veto are invalid, not reported.
  const bad = (decode) => [{ ...confirmed[0], decode }];
  assert.equal(
    typed({ 107: status({ 1: 2 }) }, bad({ kind: 'wire', match: {}, activity: 'mowing' })).state,
    'invalid',
  );
  assert.equal(
    typed({ 107: status({ 1: 2 }) }, bad({ kind: 'wire', match: { 1: 2 }, activity: 'flying' }))
      .state,
    'invalid',
  );
  const declaredValue = schema.map((entry) =>
    entry.id === '107' ? { ...entry, type: 'string', maxlen: 64 } : entry,
  );
  assert.equal(
    decodeMowerTelemetry(snapshot({ 107: status({ 1: 2, 3: 1 }) }), {
      schema: declaredValue,
      definitions: confirmed,
    }).status.state,
    'invalid',
  );
  // Undeclared raw points still decode for a consumer that supplies no schema.
  assert.equal(
    decodeMowerTelemetry(snapshot({ 107: status({ 1: 2, 3: 1 }) }), { definitions: confirmed })
      .status.value,
    'mowing',
  );
});

test('the shipped DP 107 candidates are frozen and telemetry copies are isolated from them', () => {
  const candidate = candidates[0];
  assert.throws(() => {
    candidate.level = 'confirmed';
  }, TypeError);
  assert.throws(() => {
    candidate.decode.match[1] = 1;
  }, TypeError);
  assert.throws(() => {
    candidate.decode.match[4] = 1;
  }, TypeError);
  assert.throws(() => {
    candidate.decode.activity = 'docked';
  }, TypeError);
  const dps = { ...e15Dps, 107: status({ 1: 2, 3: 1 }) };
  const telemetry = decode(dps);
  telemetry.fields['107'].wire.fields[0].value = 5;
  telemetry.fields['107'].wire.fields.length = 0;
  telemetry.dps['107'] = 'AA==';
  assert.equal(dps['107'], status({ 1: 2, 3: 1 }));
  assert.deepEqual(decode(dps).fields['107'].wire.fields, [
    { number: 1, wire: 'varint', value: 2 },
    { number: 3, wire: 'varint', value: 1 },
  ]);
  assert.deepEqual(decode(dps).status, shipped('mowing'));
});
