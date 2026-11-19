import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessoryFieldDiagnostics,
  nameSource,
  schemaKey,
  stringFields,
  textParams,
} from '../dist/accessory-fields.js';
import { discover } from '../dist/discovery.js';
import { reportedInventory, SENSORS } from './fixtures/reported-275-inventory.mjs';

// ha-eufy-cam#275: the reported accessories had no eufy app name in the alias or
// device name. These diagnostics show where a name could be, never what it is.

const SECRET = 'Synthetic private value';

test('string fields list top-level keys of non-empty strings, sorted, and nested objects as parent.*', () => {
  const row = {
    device_sn: 'SYNTH_SN',
    device_name: SECRET,
    device_alias_name: '',
    device_type: 2,
    zeta: SECRET,
    alpha: SECRET,
    extra: { label: SECRET, empty: '', count: 3, deeper: { name: SECRET } },
    list: [SECRET],
    flag: true,
    nothing: null,
  };
  assert.deepEqual(stringFields(row), ['alpha', 'device_name', 'device_sn', 'extra.*', 'zeta']);
});

test('a string two levels deep is not inspected', () => {
  assert.deepEqual(stringFields({ outer: { inner: { name: SECRET } } }), []);
});

test('member and params are skipped, and keys outside the safe pattern are dropped', () => {
  const row = {
    member: { nick_name: SECRET, admin_user_id: 'SYNTH_ADMIN' },
    params: [{ param_type: 1, param_value: SECRET }],
    'bad key': SECRET,
    naïve: SECRET,
    [`k${'x'.repeat(64)}`]: SECRET,
    nested: { 'bad-child': SECRET, good_child: SECRET },
    ok_key: SECRET,
  };
  assert.deepEqual(stringFields(row), ['nested.*', 'ok_key']);
});

test('only schema-like keys appear, and a nested object never shows its own keys', () => {
  const serial = 'T8030P23ABCDEF12';
  const hexId = '3f9a2b7c4d5e6f708192a3b4';
  const row = {
    [serial]: SECRET,
    [serial.toLowerCase()]: SECRET,
    [hexId]: SECRET,
    Frontdoor: SECRET,
    relate_devices: { [serial]: 'T8900' },
    permission: { [hexId]: 'owner' },
    rooms: { Frontdoor: SECRET },
    room: { title: SECRET, floor: SECRET },
    lowercase_names: { frontdoor: SECRET },
    numbers: { [`id_${'1'.repeat(4)}`]: SECRET },
    nothing_text: { [serial]: 5 },
    device_name: SECRET,
  };
  const fields = stringFields(row);
  assert.deepEqual(fields, [
    'device_name',
    'lowercase_names.*',
    'numbers.*',
    'permission.*',
    'relate_devices.*',
    'room.*',
    'rooms.*',
  ]);
  const text = JSON.stringify(fields);
  for (const value of [serial, serial.toLowerCase(), hexId, 'Frontdoor', 'frontdoor', 'title'])
    assert.ok(!text.includes(value));
});

test('a key segment passes only when it looks like a schema name', () => {
  for (const key of ['device_name', 'p2p_did', 'a', 'room_title2', 'frontdoor'])
    assert.equal(schemaKey(key), true, key);
  for (const key of [
    'Device_name',
    'T8030P23ABCDEF12',
    't8030p23abcdef12',
    '3f9a2b7c4d5e',
    'abcdefabcdef',
    'id_1234',
    'name__x',
    '_name',
    'name_',
    'x'.repeat(33),
    '',
    'bad-key',
    'a.b',
  ])
    assert.equal(schemaKey(key), false, key);
});

test('string fields stop at 48 entries after sorting', () => {
  const row = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [`key_${String(i).padStart(2, '0')}`, SECRET]),
  );
  const fields = stringFields(row);
  assert.equal(fields.length, 48);
  assert.equal(fields[0], 'key_00');
  assert.equal(fields[47], 'key_47');
});

test('text params list types whose value is text and not a plain number', () => {
  const params = [
    { param_type: 1550, param_value: '1' },
    { param_type: 1552, param_value: '-2.5' },
    { param_type: 1131, param_value: '' },
    { param_type: 1104, param_value: SECRET },
    { param_type: 1104, param_value: 'again' },
    { param_type: '1200', param_value: '{"a":1}' },
    { param_type: 99, param_value: '1.2.3' },
    { param_type: 100001, param_value: SECRET },
    { param_type: -1, param_value: SECRET },
    { param_type: 1.5, param_value: SECRET },
    { param_type: 'x', param_value: SECRET },
    { param_type: 7, param_value: 7 },
    null,
    [7, SECRET],
  ];
  assert.deepEqual(textParams(params), [99, 1104, 1200]);
  assert.deepEqual(textParams(null), []);
  assert.deepEqual(textParams({ param_type: 1, param_value: SECRET }), []);
});

test('text params stop at 32 entries', () => {
  const params = Array.from({ length: 40 }, (_, i) => ({
    param_type: 40 - i,
    param_value: SECRET,
  }));
  const types = textParams(params);
  assert.equal(types.length, 32);
  assert.deepEqual(types.slice(0, 3), [1, 2, 3]);
  assert.equal(types.at(-1), 32);
});

test('the name source follows the order in which the name is chosen', () => {
  assert.equal(nameSource({ device_alias_name: 'A', device_name: 'B' }), 'alias');
  assert.equal(nameSource({ device_alias_name: '', device_name: 'B' }), 'device_name');
  assert.equal(nameSource({ device_name: 'B' }), 'device_name');
  assert.equal(nameSource({ device_alias_name: '', device_name: '' }), null);
  assert.equal(nameSource({ device_alias_name: 5 }), null);
});

test('no value ever appears in the diagnostics', () => {
  const row = {
    device_sn: SECRET,
    device_name: SECRET,
    device_alias_name: SECRET,
    nested: { value: SECRET },
    params: [{ param_type: 1, param_value: SECRET }],
  };
  const text = JSON.stringify(accessoryFieldDiagnostics(row));
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes('Synthetic'));
});

test('discovery puts the diagnostics on every accessory and leaves devices unchanged', () => {
  const rows = reportedInventory();
  const sensor = rows.findIndex((row) => row.device_sn === SENSORS[0]);
  rows[sensor] = {
    ...rows[sensor],
    device_alias_name: '',
    room: { title: SECRET },
    params: [...(rows[sensor].params ?? []), { param_type: 1234, param_value: SECRET }],
  };
  const { result } = discover(rows);
  for (const accessory of result.accessories) {
    assert.ok(Array.isArray(accessory.stringFields));
    assert.ok(Array.isArray(accessory.textParams));
    assert.ok(['alias', 'device_name', null].includes(accessory.nameSource));
  }
  const first = result.accessories.find((a) => a.id === SENSORS[0]);
  assert.equal(first.nameSource, 'device_name');
  assert.ok(first.stringFields.includes('device_name'));
  assert.ok(first.stringFields.includes('room.*'));
  assert.ok(!first.stringFields.includes('room.title'));
  assert.ok(!first.stringFields.includes('device_alias_name'));
  assert.ok(first.textParams.includes(1234));
  assert.ok(!JSON.stringify(result.accessories).includes(SECRET));
  for (const device of result.devices) {
    assert.equal(device.stringFields, undefined);
    assert.equal(device.textParams, undefined);
    assert.equal(device.nameSource, undefined);
  }
});
