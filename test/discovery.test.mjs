import test from 'node:test';
import assert from 'node:assert/strict';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { Station } from '../dist/vendor/http/index.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
import { EventEmitter } from 'node:events';

const base = (id = 'HB') => ({
  category: 'eufy_security',
  device_sn: id,
  parent_sn: '',
  device_model: 'T8030',
  device_type: 18,
  device_name: 'Base',
  params: [],
});
const camera = (id = 'CAM', parent = 'HB') => ({
  category: 'eufy_security',
  device_sn: id,
  parent_sn: parent,
  device_model: 'T8134',
  device_type: 63,
  device_name: 'Camera',
  device_channel: 2,
  params: [],
});

test('mixed inventory retains usable identities and ordered, sanitized per-row reasons', async () => {
  const rows = [
    base(),
    camera(),
    { ...camera('UNKNOWN'), device_model: 'T9999' },
    camera('ORPHAN', 'OTHER'),
    { ...camera('BAD'), parent_sn: null },
    { ...camera('WRONGTYPE'), device_type: 19 },
  ];
  const fixture = cloudFixture({ inventory: rows });
  const client = new EufyMegaClient(fixture.options);
  try {
    await client.connect();
    const result = await client.discoverDevices();
    assert.deepEqual(
      result.devices.map((d) => [d.id, d.stationId, d.kind]),
      [
        ['HB', 'HB', 'station'],
        ['CAM', 'HB', 'camera'],
        ['ORPHAN', 'OTHER', 'camera'],
      ],
    );
    assert.deepEqual(result.relationships[1], { deviceId: 'CAM', kind: 'station', ownerId: 'HB' });
    assert.deepEqual(
      new Map(result.issues.map((i) => [i.deviceId, i.code])),
      new Map([
        ['UNKNOWN', 'unsupported_device'],
        ['BAD', 'invalid_device_relationship'],
        ['WRONGTYPE', 'unsupported_device'],
        ['ORPHAN', 'unsupported_station'],
      ]),
    );
    result.relationships[1].ownerId = 'MUTATED';
    result.devices[1].id = 'MUTATED';
    assert.equal(client.inventory.relationships.get('CAM').ownerId, 'HB');
    assert.equal(client.devices.has('CAM'), true);
    assert.equal(JSON.stringify(result).includes('p2p'), false);
    assert.equal(fixture.calls.at(-1).path, '/app/house/get_devs_list');
  } finally {
    await client.close();
  }
});

for (const parent of ['', 'SOLO'])
  test(`standalone ${parent || 'empty'} relationship owns no alarm entity or transport`, async () => {
    const fixture = cloudFixture({ inventory: [camera('SOLO', parent)] });
    const client = new EufyMegaClient(fixture.options);
    try {
      await client.connect();
      const result = await client.discoverDevices();
      assert.deepEqual(result.relationships, [
        {
          deviceId: 'SOLO',
          kind: 'standalone',
          ownerId: 'SOLO',
          reason: 'standalone_transport_unverified',
        },
      ]);
      assert.equal(result.devices[0].stationId, 'SOLO');
      assert.equal(result.devices[0].kind, 'camera');
      assert.deepEqual(client.inventory.owners.get('SOLO'), {
        id: 'SOLO',
        kind: 'standalone',
        transport: 'unsupported',
      });
      for (const operation of [
        () => client.startLive('SOLO'),
        () => client.snapshot('SOLO'),
        () => client.setGuardMode('SOLO', 1),
        () => client.connectStation('SOLO'),
      ])
        await assert.rejects(operation(), { code: 'standalone_transport_unverified' });
      assert.equal(client.transport.stations.size, 0);
      assert.equal(client.transport.cameras.size, 0);
      assert.equal(fixture.calls.filter((c) => c.path.includes('get_devs_list')).length, 1);
    } finally {
      await client.close();
    }
  });

test('duplicate identities cannot shadow owners even across unsupported models or categories', () => {
  for (const duplicate of [
    { ...base(), device_model: 'UNKNOWN' },
    { ...base(), category: 'other' },
    base(),
  ]) {
    const result = discover([
      base(),
      duplicate,
      camera(),
      base('GOOD'),
      camera('GOODCAM', 'GOOD'),
    ]).result;
    assert.equal(
      result.devices.some((d) => d.id === 'HB'),
      false,
    );
    assert.equal(
      result.relationships.find((r) => r.deviceId === 'CAM').reason,
      'unsupported_station',
    );
    assert.equal(result.relationships.find((r) => r.deviceId === 'GOODCAM').ownerId, 'GOOD');
    assert.ok(
      result.issues.some((i) => i.deviceId === 'HB' && i.code === 'invalid_device_identity'),
    );
  }
});

test('malformed owners, chains and cycles cannot inherit station command ownership', () => {
  const result = discover([
    { ...base(), parent_sn: 'CAM' },
    camera(),
    camera('CHAIN', 'CAM'),
    camera('CYCLE1', 'CYCLE2'),
    camera('CYCLE2', 'CYCLE1'),
    { ...camera('BAD'), parent_sn: '../secret' },
    null,
  ]).result;
  assert.equal(
    result.relationships.every((r) => r.kind === 'unsupported'),
    true,
  );
  assert.equal(result.issues.find((i) => i.deviceId === 'HB').code, 'invalid_device_relationship');
  assert.equal(result.issues.find((i) => i.index === 6).deviceId, null);
});

test('inventory envelopes and completeness remain explicit whole-response errors', () => {
  for (const value of [null, {}, 'bad'])
    assert.throws(() => discover(value), { code: 'invalid_inventory' });
  for (const count of [100, 101])
    assert.throws(() => discover(Array(count).fill(base())), {
      code: 'inventory_completeness_unconfirmed',
    });
  assert.equal(
    discover(Array.from({ length: 99 }, (_, i) => camera(`UNKNOWN${i}`, 'NO'))).result.devices
      .length,
    99,
  );
});

test('one owner with missing credentials does not block another owner or valid camera initialization', async () => {
  const original = Station.getInstance;
  const created = [];
  Station.getInstance = async (_provider, wire) => {
    created.push(wire.station_sn);
    return Object.assign(new EventEmitter(), {
      setConnectionType() {},
      initialize() {},
      getSerial: () => wire.station_sn,
      hasProperty: () => false,
      isConnected: () => false,
      dispose: async () => {},
      update() {},
    });
  };
  const t = new DeviceTransport();
  try {
    const inventory = discover([
      base('BAD'),
      { ...base('GOOD'), p2p_did: 'synthetic', member: { admin_user_id: 'synthetic' } },
      camera('GOODCAM', 'GOOD'),
      camera('BADCAM', 'BAD'),
    ]);
    await t.load(inventory.raw, inventory);
    assert.deepEqual(created, ['GOOD']);
    assert.equal(t.state('GOOD').id, 'GOOD');
    assert.ok(t.cameras.has('GOODCAM'));
    assert.equal(t.device('GOODCAM').stationId, 'GOOD');
    await assert.rejects(t.connect('BAD'), { code: 'invalid_connection_credentials' });
    await assert.rejects(t.snapshot('BADCAM'), { code: 'invalid_connection_credentials' });
  } finally {
    Station.getInstance = original;
    await t.close();
  }
});

test('relationship refresh discards stale cameras and blocks their former route', async () => {
  const t = new DeviceTransport();
  try {
    const first = discover([base(), camera()]);
    await t.load(first.raw, first);
    const previous = t.cameras.get('CAM');
    assert.ok(previous);
    const second = discover([base(), camera('CAM', '')]);
    await t.load(second.raw, second);
    assert.equal(t.cameras.has('CAM'), false);
    await assert.rejects(t.startLive('CAM'), { code: 'standalone_transport_unverified' });
  } finally {
    await t.close();
  }
});

test('bad camera initialization is isolated and never leaks protocol errors', async () => {
  const t = new DeviceTransport();
  try {
    const inventory = discover([
      base(),
      camera('GOOD'),
      { ...camera('BAD'), params: { secret: 'private-marker' } },
    ]);
    await t.load(inventory.raw, inventory);
    assert.ok(t.cameras.has('GOOD'));
    assert.equal(t.cameras.has('BAD'), false);
    await assert.rejects(t.startLive('BAD'), {
      code: 'device_initialization_failed',
      message: 'device_initialization_failed',
    });
  } finally {
    await t.close();
  }
});
