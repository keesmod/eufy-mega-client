// DP 155 work parameters: the pure decoder, the unused one-field encoder and the module's cloud
// read. Every value is built from the documented tag and varint rules with invented numbers,
// never from a capture. See docs/MOWER_WORK_PARAMETERS.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import * as library from '../dist/index.js';
import { EufyClient, EufyError, decodeMowerWorkParameters } from '../dist/index.js';
import {
  MAX_WORK_PARAMETER_DEPTH,
  encodeMowerWorkParameter,
  readWorkParameterFields,
} from '../dist/mowers/work-parameters.js';
import { deviceId, localKey } from './fixtures/local-mower.mjs';
import { cloud, credentials, memory, mowerClient } from './fixtures/mower-cloud.mjs';

// A tiny wire writer: base-128 varints with negative integers sign-extended to 64 bits.
function varint(value) {
  let rest = BigInt.asUintN(64, BigInt(value));
  const out = [];
  while (rest >= 0x80n) {
    out.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  out.push(Number(rest));
  return out;
}
const tag = (number, wire) => varint((BigInt(number) << 3n) | BigInt(wire));
const int = (number, value) => [...tag(number, 0), ...varint(value)];
const msg = (number, ...parts) => {
  const content = parts.flat(Infinity);
  return [...tag(number, 2), ...varint(content.length), ...content];
};
const b64 = (...parts) => Buffer.from(parts.flat(Infinity)).toString('base64');
const hex = (text) => Buffer.from(text.replaceAll(' ', ''), 'hex').toString('base64');
const json = (data) => new Response(JSON.stringify(data));

/** Every field of the message in field order, as separate records. Invented values. */
function records() {
  return [
    msg(1, int(1, 55)),
    msg(2, int(1, 3)),
    msg(3, int(1, 120)),
    msg(
      4,
      int(1, 1),
      msg(2, int(1, 30)),
      msg(3, msg(1, varint(30), varint(0), varint(135))),
      msg(4, int(1, 15)),
      int(5, 30),
    ),
    msg(5, int(1, 70)),
    msg(6, int(1, 2)),
    int(7, 70),
  ];
}
const FULL = {
  mowHeight: 55,
  mowSpeed: 'auto',
  edgeDistance: 120,
  direction: {
    mode: 'multiple',
    singleAngle: 30,
    multipleAngles: [30, 0, 135],
    autoRotateInterval: 15,
    currentAngle: 30,
  },
  mowSpacing: 70,
  bladeSpeed: 'high',
  currentMowSpacing: 70,
};
function parameters(...parts) {
  const result = decodeMowerWorkParameters(b64(...parts));
  assert.equal(result.shape, 'decoded', JSON.stringify(result));
  return result.parameters;
}

test('a full message decodes every field with the numbering of the app serializers', () => {
  const text = b64(records());
  assert.deepEqual(decodeMowerWorkParameters(text), {
    shape: 'decoded',
    parameters: FULL,
    undecodedFields: [],
  });
  // Field order on the wire does not matter.
  assert.deepEqual(parameters(records().reverse()), FULL);
  const speeds = ['low', 'medium', 'adaptive_high', 'auto'];
  for (const [code, name] of speeds.entries())
    assert.equal(parameters(msg(2, int(1, code))).mowSpeed, name);
  for (const [code, name] of ['low', 'medium', 'high'].entries())
    assert.equal(parameters(msg(6, int(1, code))).bladeSpeed, name);
  for (const [code, name] of ['single', 'multiple', 'auto_rotate'].entries())
    assert.deepEqual(parameters(msg(4, int(1, code))).direction, { mode: name });
});

test('the empty message, the app single zero byte, decodes to empty parameters', () => {
  for (const text of ['AA==', ''])
    assert.deepEqual(decodeMowerWorkParameters(text), {
      shape: 'decoded',
      parameters: {},
      undecodedFields: [],
    });
  // Only the whole value is special. A zero byte anywhere else is field number zero.
  assert.equal(decodeMowerWorkParameters(b64([0, 0])).reason, 'field_number');
  assert.equal(decodeMowerWorkParameters(b64(msg(4, [0]))).reason, 'field_number');
});

test('a single field decodes alone and an empty wrapper is a present zero', () => {
  assert.deepEqual(decodeMowerWorkParameters(b64(msg(6, int(1, 1)))), {
    shape: 'decoded',
    parameters: { bladeSpeed: 'medium' },
    undecodedFields: [],
  });
  assert.deepEqual(parameters(msg(1), msg(2), msg(3), msg(4), msg(5), msg(6)), {
    mowHeight: 0,
    mowSpeed: 'low',
    edgeDistance: 0,
    direction: { mode: 'single' },
    mowSpacing: 0,
    bladeSpeed: 'low',
  });
  assert.deepEqual(parameters(msg(4, msg(2), msg(3), msg(4))).direction, {
    mode: 'single',
    singleAngle: 0,
    multipleAngles: [],
    autoRotateInterval: 0,
  });
  // Plain integer fields exist only when they are on the wire, an explicit zero included.
  const only = parameters(msg(1, int(1, 40)));
  assert.deepEqual(only, { mowHeight: 40 });
  assert.equal(Object.hasOwn(only, 'currentMowSpacing'), false);
  assert.deepEqual(parameters(int(7, 0)), { currentMowSpacing: 0 });
  assert.deepEqual(parameters(msg(4, int(5, 0))), {
    direction: { mode: 'single', currentAngle: 0 },
  });
});

test('negative int32 values are ten-byte sign-extended varints', () => {
  const edge = msg(3, int(1, -10));
  assert.equal(edge.length, 2 + 1 + 10);
  assert.deepEqual(parameters(edge), { edgeDistance: -10 });
  assert.deepEqual(parameters(int(7, -5)), { currentMowSpacing: -5 });
  assert.deepEqual(parameters(msg(5, int(1, -(2 ** 31))), msg(3, int(1, 2 ** 31 - 1))), {
    edgeDistance: 2 ** 31 - 1,
    mowSpacing: -(2 ** 31),
  });
  assert.deepEqual(parameters(msg(4, msg(3, msg(1, varint(-45), varint(45))))).direction, {
    mode: 'single',
    multipleAngles: [-45, 45],
  });
});

test('multiple angles decode from packed, unpacked and mixed records in wire order', () => {
  const direction = (...parts) => parameters(msg(4, int(1, 1), msg(3, ...parts))).direction;
  assert.deepEqual(direction(msg(1, varint(90), varint(0))).multipleAngles, [90, 0]);
  assert.deepEqual(direction(int(1, 90), int(1, 0)).multipleAngles, [90, 0]);
  assert.deepEqual(
    direction(int(1, 10), msg(1, varint(20), varint(30)), int(1, 40)).multipleAngles,
    [10, 20, 30, 40],
  );
  assert.deepEqual(direction(msg(1)).multipleAngles, []);
});

test('enumeration values the app does not name keep their number', () => {
  assert.deepEqual(parameters(msg(2, int(1, 4)), msg(6, int(1, 3)), msg(4, int(1, 3))), {
    mowSpeed: { unknown: 4 },
    bladeSpeed: { unknown: 3 },
    direction: { mode: { unknown: 3 } },
  });
  assert.deepEqual(parameters(msg(2, int(1, -1))), { mowSpeed: { unknown: -1 } });
});

test('unknown fields are skipped and listed once by their top-level field number', () => {
  const extra = [
    int(8, 1),
    msg(9, [1, 2, 3]),
    [...tag(10, 5), 1, 2, 3, 4],
    [...tag(11, 1), ...new Array(8).fill(0)],
  ];
  assert.deepEqual(decodeMowerWorkParameters(b64(records(), extra)), {
    shape: 'decoded',
    parameters: FULL,
    undecodedFields: [8, 9, 10, 11],
  });
  // An unknown field inside a known message is reported by the top-level field around it.
  assert.deepEqual(decodeMowerWorkParameters(b64(msg(1, int(1, 40), int(2, 1)))), {
    shape: 'decoded',
    parameters: { mowHeight: 40 },
    undecodedFields: [1],
  });
  assert.deepEqual(
    decodeMowerWorkParameters(b64(int(12, 1), msg(4, msg(2, int(1, 30), msg(2, [9]))), int(12, 2))),
    {
      shape: 'decoded',
      parameters: { direction: { mode: 'single', singleAngle: 30 } },
      undecodedFields: [4, 12],
    },
  );
  assert.deepEqual(decodeMowerWorkParameters(b64(msg(4, int(6, 1)))).undecodedFields, [4]);
});

test('repeated records follow the parser rules: the last scalar wins and messages merge', () => {
  assert.deepEqual(parameters(int(7, 5), int(7, 6)), { currentMowSpacing: 6 });
  assert.deepEqual(parameters(msg(1, int(1, 40)), msg(1, int(1, 45))), { mowHeight: 45 });
  assert.deepEqual(parameters(msg(4, int(1, 1)), msg(4, int(5, 7))).direction, {
    mode: 'multiple',
    currentAngle: 7,
  });
  assert.deepEqual(
    parameters(msg(4, msg(3, int(1, 1))), msg(4, msg(3, int(1, 2)))).direction.multipleAngles,
    [1, 2],
  );
});

test('malformed values report the first fault and never throw', () => {
  const cases = [
    [undefined, 'not_text'],
    [null, 'not_text'],
    [42, 'not_text'],
    [{}, 'not_text'],
    [['AA=='], 'not_text'],
    [Buffer.from('AA=='), 'not_text'],
    ['not base64!', 'not_base64'],
    ['AAA', 'not_base64'],
    ['AA=A', 'not_base64'],
    [' AA==', 'not_base64'],
    ['AA==\n', 'not_base64'],
    ['-_8=', 'not_base64'],
    ['A'.repeat(348), 'too_long'],
    [b64(msg(9, new Array(254).fill(0))), 'too_long'],
    [b64([0x0a]), 'truncated'],
    [b64([0x0a, 0x05, 0x08, 0x01]), 'truncated'],
    [b64([0x38]), 'truncated'],
    [b64([0x38, 0x80]), 'truncated'],
    [b64([...tag(7, 5), 1, 2, 3]), 'truncated'],
    [b64(msg(4, [0x12, 0x05, 0x08])), 'truncated'],
    [b64(msg(4, msg(3, msg(1, [0x80])))), 'truncated'],
    [b64(tag(1, 3)), 'wire_type'],
    [b64(tag(1, 4)), 'wire_type'],
    [b64(tag(1, 6)), 'wire_type'],
    [b64([...tag(9, 7), 0]), 'wire_type'],
    [b64(msg(4, tag(1, 7))), 'wire_type'],
    [b64(int(1, 40)), 'field_type'],
    [b64(msg(7, [1])), 'field_type'],
    [b64([...tag(2, 5), 1, 0, 0, 0]), 'field_type'],
    [b64(msg(1, msg(1))), 'field_type'],
    [b64(msg(4, msg(2, msg(1, int(1, 30))))), 'field_type'],
    [b64(msg(4, msg(3, [...tag(1, 5), 0, 0, 0, 0]))), 'field_type'],
    [b64([0, 0]), 'field_number'],
    [b64([...tag(2 ** 29, 0), 1]), 'field_number'],
    [b64([...new Array(11).fill(0x80), 1]), 'varint'],
    [b64([0x38, ...new Array(9).fill(0xff), 0x02]), 'varint'],
    // Bit 64 alone would wrap to a valid zero if the tenth byte were not checked.
    [b64([0x38, ...new Array(9).fill(0x80), 0x02]), 'varint'],
    [b64(int(7, 2 ** 31)), 'varint'],
    [b64(int(7, -(2 ** 31) - 1)), 'varint'],
    [b64([0x38, 0xff, 0xff, 0xff, 0xff, 0x0f]), 'varint'],
    [b64(msg(4, msg(3, msg(1, varint(2 ** 31))))), 'varint'],
    [b64(new Array(65).fill(0).map(() => int(8, 1))), 'too_many_fields'],
    [b64(msg(4, msg(3, msg(1, new Array(62).fill(0))))), 'too_many_fields'],
  ];
  for (const [value, reason] of cases) {
    let result;
    assert.doesNotThrow(() => {
      result = decodeMowerWorkParameters(value);
    }, inspect(value));
    assert.deepEqual(result, { shape: 'malformed', reason }, inspect(value));
  }
  // The exact bounds still decode: 256 bytes, 64 records and 61 packed angles under 3 records.
  assert.deepEqual(decodeMowerWorkParameters(b64(msg(9, new Array(253).fill(0)))), {
    shape: 'decoded',
    parameters: {},
    undecodedFields: [9],
  });
  assert.deepEqual(decodeMowerWorkParameters(b64(new Array(64).fill(0).map(() => int(8, 1)))), {
    shape: 'decoded',
    parameters: {},
    undecodedFields: [8],
  });
  assert.equal(
    parameters(msg(4, msg(3, msg(1, new Array(61).fill(0))))).direction.multipleAngles.length,
    61,
  );
});

test('the reader bounds nesting at three messages', () => {
  // The deepest known message, a mode configuration, is level 3, so the schema itself never
  // reaches the bound. The reader enforces it on its own and reports it without throwing.
  assert.equal(MAX_WORK_PARAMETER_DEPTH, 3);
  const bytes = new Uint8Array([...int(1, 1), ...msg(2)]);
  assert.deepEqual(readWorkParameterFields(bytes, 1), [1, 2]);
  assert.deepEqual(readWorkParameterFields(bytes, MAX_WORK_PARAMETER_DEPTH), [1, 2]);
  assert.equal(readWorkParameterFields(bytes, MAX_WORK_PARAMETER_DEPTH + 1), 'too_deep');
  assert.equal(readWorkParameterFields(new Uint8Array(tag(1, 7)), 1), 'wire_type');
  assert.deepEqual(
    parameters(msg(4, msg(2, int(1, 30)))).direction,
    { mode: 'single', singleAngle: 30 },
    'the level-3 configuration decodes',
  );
});

test('decoding results are fresh and share nothing with the input or each other', () => {
  const text = b64(records());
  const first = decodeMowerWorkParameters(text);
  const second = decodeMowerWorkParameters(text);
  assert.notEqual(first.parameters, second.parameters);
  assert.notEqual(first.parameters.direction, second.parameters.direction);
  first.parameters.direction.multipleAngles.push(1);
  first.parameters.mowSpeed = 'low';
  first.undecodedFields.push(99);
  assert.deepEqual(second, { shape: 'decoded', parameters: FULL, undecodedFields: [] });
  assert.deepEqual(decodeMowerWorkParameters(text), second);
  const unknown = parameters(msg(2, int(1, 9)));
  unknown.mowSpeed.unknown = 1;
  assert.deepEqual(parameters(msg(2, int(1, 9))), { mowSpeed: { unknown: 9 } });
});

test('the encoder writes one wrapped field like the app, a zero as an empty wrapper', () => {
  const cases = [
    [{ name: 'mowSpeed', value: 'low' }, '12 00'],
    [{ name: 'mowSpeed', value: 'medium' }, '12 02 08 01'],
    [{ name: 'mowSpeed', value: 'adaptive_high' }, '12 02 08 02'],
    [{ name: 'mowSpeed', value: 'auto' }, '12 02 08 03'],
    [{ name: 'bladeSpeed', value: 'low' }, '32 00'],
    [{ name: 'bladeSpeed', value: 'medium' }, '32 02 08 01'],
    [{ name: 'bladeSpeed', value: 'high' }, '32 02 08 02'],
    [{ name: 'edgeDistance', value: 0 }, '1a 00'],
    [{ name: 'edgeDistance', value: 150 }, '1a 03 08 96 01'],
    [{ name: 'edgeDistance', value: -10 }, '1a 0b 08 f6 ff ff ff ff ff ff ff ff 01'],
    [{ name: 'edgeDistance', value: 2 ** 31 - 1 }, '1a 06 08 ff ff ff ff 07'],
    [{ name: 'edgeDistance', value: -(2 ** 31) }, '1a 0b 08 80 80 80 80 f8 ff ff ff ff 01'],
    [{ name: 'mowSpacing', value: 0 }, '2a 00'],
    [{ name: 'mowSpacing', value: 80 }, '2a 02 08 50'],
    [{ name: 'mowSpacing', value: -1 }, '2a 0b 08 ff ff ff ff ff ff ff ff ff 01'],
  ];
  for (const [change, bytes] of cases) {
    const text = encodeMowerWorkParameter(change);
    assert.equal(text, hex(bytes), `${change.name} ${change.value}`);
    assert.deepEqual(decodeMowerWorkParameters(text), {
      shape: 'decoded',
      parameters: { [change.name]: change.value },
      undecodedFields: [],
    });
  }
  assert.equal(encodeMowerWorkParameter({ name: 'edgeDistance', value: -0 }), hex('1a 00'));
  // The encoder is not public API while the write design is open. The decoder is.
  assert.equal(typeof library.decodeMowerWorkParameters, 'function');
  assert.equal(Object.hasOwn(library, 'encodeMowerWorkParameter'), false);
  assert.equal(Object.hasOwn(library, 'readWorkParameterFields'), false);
});

test('the encoder refuses anything but one valid change with mower_setting_invalid', () => {
  const refused = [
    undefined,
    null,
    'mowSpeed',
    42,
    [],
    {},
    [{ name: 'mowSpeed', value: 'low' }],
    { value: 'low' },
    { name: 'mowHeight', value: 40 },
    { name: 'direction', value: { mode: 'single' } },
    { name: 'currentMowSpacing', value: 70 },
    { name: 'toString', value: 1 },
    { name: '__proto__', value: 1 },
    { name: 'mowSpeed' },
    { name: 'mowSpeed', value: 'fast' },
    { name: 'mowSpeed', value: 'LOW' },
    { name: 'mowSpeed', value: 1 },
    { name: 'bladeSpeed', value: 'auto' },
    { name: 'bladeSpeed', value: 'adaptive_high' },
    { name: 'edgeDistance', value: 1.5 },
    { name: 'edgeDistance', value: Number.NaN },
    { name: 'edgeDistance', value: Infinity },
    { name: 'edgeDistance', value: '150' },
    { name: 'edgeDistance', value: 150n },
    { name: 'edgeDistance', value: 2 ** 31 },
    { name: 'mowSpacing', value: -(2 ** 31) - 1 },
    { name: 'mowSpacing', value: null },
    { name: 'mowSpacing', value: true },
  ];
  for (const change of refused)
    assert.throws(
      () => encodeMowerWorkParameter(change),
      (error) => error instanceof EufyError && error.code === 'mower_setting_invalid',
      inspect(change),
    );
});

/**
 * A connected, discovered module over the synthetic cloud with every Tuya action recorded.
 * Discovery sees the fixture record. `later` answers each later `tuya.m.device.get` instead.
 */
async function connectedModule(t, options = {}, later) {
  const base = cloud(options);
  const calls = [];
  let discovered = false;
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    const action = parsed.searchParams.get('a') ?? parsed.pathname;
    calls.push({ action, postData: init.body?.get?.('postData') ?? null });
    if (discovered && later && action === 'tuya.m.device.get') return later(init);
    return base(url, init);
  };
  const client = new EufyClient({
    mowers: { credentials, sessionStore: memory(), home: { fetch } },
  });
  t.after(() => client.shutdown());
  await client.mowers.connect();
  const [device] = await client.mowers.discover();
  discovered = true;
  const reads = () => calls.filter((call) => call.action === 'tuya.m.device.get').length;
  return { client, mowers: client.mowers, id: device.id, calls, reads };
}
function noSecrets(text) {
  for (const secret of [deviceId, localKey, 'PRIVATE-']) assert.ok(!text.includes(secret), text);
}

test('the module reads DP 155 from the cloud record with the receipt time and nothing else', async (t) => {
  const { mowers, id, calls, reads } = await connectedModule(t, {
    dps: { 1: true, 8: 87, 155: b64(records()), 156: 'PRIVATE-OTHER-POINT' },
  });
  const before = Date.now();
  const reading = await mowers.queryWorkParameters(id);
  const after = Date.now();
  assert.deepEqual(Object.keys(reading).sort(), [
    'observedAt',
    'parameters',
    'source',
    'state',
    'undecodedFields',
  ]);
  assert.equal(reading.source, 'cloud');
  assert.equal(reading.state, 'reported');
  assert.deepEqual(reading.parameters, FULL);
  assert.deepEqual(reading.undecodedFields, []);
  const at = Date.parse(reading.observedAt);
  assert.equal(new Date(at).toISOString(), reading.observedAt);
  assert.ok(at >= before && at <= after);
  // One fresh request per read, for the bound device only.
  assert.equal(reads(), 2);
  assert.deepEqual(JSON.parse(calls.at(-1).postData), { devId: deviceId });
  noSecrets(JSON.stringify(reading) + inspect(reading, { depth: null }));
  const again = await mowers.queryWorkParameters(id);
  assert.equal(reads(), 3);
  assert.notEqual(again.parameters, reading.parameters);
  reading.parameters.direction.multipleAngles.push(1);
  assert.deepEqual(again.parameters, FULL);
  // The app's empty message is a reported value without fields.
  const empty = await mowerClient(t, { dps: { 155: 'AA==' } });
  const none = await empty.mowers.queryWorkParameters(empty.id);
  assert.equal(none.state, 'reported');
  assert.deepEqual([none.parameters, none.undecodedFields], [{}, []]);
});

test('a record without DP 155 reads missing and an undecodable value reads invalid', async (t) => {
  for (const [dps, state] of [
    [undefined, 'missing'],
    [{}, 'missing'],
    [{ 1: true, 154: 'AA==' }, 'missing'],
    ['PRIVATE-TEXT', 'missing'],
    [null, 'missing'],
    [{ 155: 'not base64!' }, 'invalid'],
    [{ 155: b64(tag(1, 7)) }, 'invalid'],
    [{ 155: 42 }, 'invalid'],
    [{ 155: null }, 'invalid'],
    [{ 155: { nested: 'PRIVATE-VALUE' } }, 'invalid'],
  ]) {
    const { mowers, id } = await mowerClient(t, { dps });
    const reading = await mowers.queryWorkParameters(id);
    assert.deepEqual(Object.keys(reading).sort(), ['observedAt', 'source', 'state'], inspect(dps));
    assert.equal(reading.source, 'cloud');
    assert.equal(reading.state, state, inspect(dps));
    assert.ok(!Number.isNaN(Date.parse(reading.observedAt)));
    noSecrets(JSON.stringify(reading));
  }
});

test('reads need a connected module, a current binding and the adapter capability', async (t) => {
  const fresh = new EufyClient({
    mowers: { credentials, sessionStore: memory(), home: { fetch: cloud() } },
  });
  t.after(() => fresh.shutdown());
  await assert.rejects(fresh.mowers.queryWorkParameters('f'.repeat(64)), {
    code: 'authentication_required',
  });
  await fresh.mowers.connect();
  await assert.rejects(fresh.mowers.queryWorkParameters('f'.repeat(64)), {
    code: 'mower_binding_unavailable',
  });
  const { mowers, reads } = await connectedModule(t, { dps: { 155: 'AA==' } });
  for (const id of ['f'.repeat(64), '', 42, undefined, {}])
    await assert.rejects(mowers.queryWorkParameters(id), { code: 'mower_binding_unavailable' });
  assert.equal(reads(), 1);
  let connected = false;
  const custom = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      adapter: () => ({
        get connected() {
          return connected;
        },
        connect: async () => {
          connected = true;
          return { state: 'connected' };
        },
        shutdown: async () => {
          connected = false;
        },
      }),
    },
  });
  t.after(() => custom.shutdown());
  await assert.rejects(custom.mowers.queryWorkParameters('f'.repeat(64)), {
    code: 'authentication_required',
  });
  await custom.mowers.connect();
  await assert.rejects(custom.mowers.queryWorkParameters('f'.repeat(64)), {
    code: 'mower_protocol_unavailable',
  });
  await fresh.shutdown();
  await assert.rejects(fresh.mowers.queryWorkParameters('f'.repeat(64)), {
    code: 'client_closed',
  });
});

test('an adapter answer is checked before it is decoded', async (t) => {
  let answer;
  let asked = 0;
  const client = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      adapter: () => ({
        connected: true,
        connect: async () => ({ state: 'connected' }),
        shutdown: async () => {},
        readCloudWorkParameters: async () => {
          asked += 1;
          return answer;
        },
      }),
    },
  });
  t.after(() => client.shutdown());
  await client.mowers.connect();
  const observedAt = '2026-01-01T00:00:00.000Z';
  answer = { observedAt, value: b64(msg(6, int(1, 2))) };
  // An id that is not text never reaches the adapter.
  for (const id of [42, undefined, { id: 'x' }])
    await assert.rejects(client.mowers.queryWorkParameters(id), {
      code: 'mower_binding_unavailable',
    });
  assert.equal(asked, 0);
  assert.deepEqual(await client.mowers.queryWorkParameters('x'), {
    source: 'cloud',
    observedAt,
    state: 'reported',
    parameters: { bladeSpeed: 'high' },
    undecodedFields: [],
  });
  answer = { observedAt, value: null };
  assert.deepEqual(await client.mowers.queryWorkParameters('x'), {
    source: 'cloud',
    observedAt,
    state: 'invalid',
  });
  for (answer of [undefined, {}, { observedAt: 'PRIVATE-NOT-A-TIME', value: 'AA==' }])
    await assert.rejects(client.mowers.queryWorkParameters('x'), {
      code: 'mower_invalid_response',
    });
});

test('cloud failures are sanitized and a foreign record is refused', async (t) => {
  for (const [answer, code] of [
    [
      () => json({ success: false, errorCode: 'PRIVATE-CODE', errorMsg: 'PRIVATE-MESSAGE' }),
      'mower_request_failed',
    ],
    [() => new Response('PRIVATE-BODY', { status: 500 }), 'mower_request_failed'],
    [
      () => {
        throw Error('PRIVATE-FETCH');
      },
      'mower_request_failed',
    ],
    [() => json({ result: 'PRIVATE-TEXT' }), 'mower_invalid_response'],
    [() => new Response('PRIVATE-NOT-JSON'), 'mower_request_failed'],
    [
      () => json({ result: { devId: 'SYNTHETIC-OTHER-DEVICE', localKey, dps: { 155: 'AA==' } } }),
      'mower_binding_unavailable',
    ],
  ]) {
    const { mowers, id } = await connectedModule(t, {}, answer);
    await assert.rejects(mowers.queryWorkParameters(id), (error) => {
      noSecrets(inspect(error, { depth: null }));
      return error instanceof EufyError && error.code === code;
    });
    assert.equal(mowers.connected, true);
  }
  const { mowers, id } = await connectedModule(t, {}, () =>
    json({ success: false, errorCode: 'USER_SESSION_INVALID' }),
  );
  await assert.rejects(mowers.queryWorkParameters(id), { code: 'authentication_required' });
  assert.equal(mowers.connected, false);
});

test('cancellation and shutdown end a read without a late result', async (t) => {
  const { mowers, id, reads } = await connectedModule(t, { dps: { 155: 'AA==' } });
  await assert.rejects(mowers.queryWorkParameters(id, AbortSignal.abort('PRIVATE-REASON')), {
    code: 'request_aborted',
  });
  assert.equal(reads(), 1);
  for (const mode of ['cancel', 'shutdown']) {
    let entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const held = await connectedModule(
      t,
      {},
      (init) =>
        new Promise((_, reject) => {
          entered();
          init.signal.addEventListener('abort', () => reject(Error('PRIVATE-ABORT')), {
            once: true,
          });
        }),
    );
    const controller = new AbortController();
    const pending = assert.rejects(
      held.mowers.queryWorkParameters(held.id, controller.signal),
      (error) => {
        noSecrets(inspect(error, { depth: null }));
        return error.code === 'request_aborted';
      },
    );
    await ready;
    if (mode === 'cancel') controller.abort('PRIVATE-REASON');
    else await held.client.shutdown();
    await pending;
    if (mode === 'shutdown')
      await assert.rejects(held.mowers.queryWorkParameters(held.id), { code: 'client_closed' });
    else assert.equal(held.mowers.connected, true);
  }
});
