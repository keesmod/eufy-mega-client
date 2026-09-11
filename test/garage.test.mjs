import test from 'node:test';
import assert from 'node:assert/strict';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { CommandType } from '../dist/vendor/p2p/types.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
const profiles = [
  ['T8452', 132],
  ['T8453', 133],
];
const camera = (model, type, extra = {}) => ({
  category: 'eufy_security',
  device_sn: model + '_FIXTURE',
  parent_sn: '',
  device_model: model,
  device_type: type,
  device_channel: 2,
  device_name: 'Synthetic garage camera',
  main_sw_version: '1.2.3',
  params: [],
  ...extra,
});
const owner = {
  category: 'eufy_security',
  device_sn: 'T8030_OWNER',
  parent_sn: '',
  device_model: 'T8030',
  device_type: 18,
  main_sw_version: '3.8.6.0',
  params: [],
};
for (const [model, type] of profiles) {
  test(`${model}/${type} recognizes standalone ownership without granting a transport`, async () => {
    for (const parent_sn of ['', model + '_FIXTURE']) {
      const raw = camera(model, type, { parent_sn });
      const f = cloudFixture({ inventory: [raw] });
      const client = new EufyMegaClient(f.options);
      try {
        await client.connect();
        const inventory = await client.discoverDevices();
        assert.equal(inventory.devices[0].model, model);
        assert.equal(inventory.devices[0].kind, 'camera');
        assert.equal(inventory.devices[0].stationId, raw.device_sn);
        assert.equal(inventory.devices[0].battery, null);
        assert.equal(inventory.devices[0].availability, null);
        assert.deepEqual(inventory.relationships[0], {
          deviceId: raw.device_sn,
          kind: 'standalone',
          ownerId: raw.device_sn,
          reason: 'standalone_transport_unverified',
        });
        for (const operation of [
          () => client.snapshot(raw.device_sn),
          () => client.startLive(raw.device_sn),
        ])
          await assert.rejects(operation(), { code: 'standalone_transport_unverified' });
        await assert.rejects(client.getDeviceState(raw.device_sn), {
          code: 'standalone_transport_unverified',
        });
        const capabilities = await client.getCameraCapabilities(raw.device_sn);
        for (const capability of Object.values(capabilities)) {
          assert.equal(capability.available, false);
          assert.equal(capability.reason, 'standalone_transport_unverified');
        }
        assert.equal(client.transport.stations.size, 0);
        assert.equal(client.transport.cameras.size, 0);
        assert.equal(client.transport.supportsEvent(raw.device_sn, 'motion'), false);
        assert.equal(
          client.transport.acceptPush({
            device_sn: raw.device_sn,
            station_sn: raw.device_sn,
            event_type: 3102,
          }),
          false,
        );
        assert.ok(f.calls.every((c) => !c.path.includes('command')));
        for (const name of ['openGarageDoor', 'closeGarageDoor', 'calibrateGarageDoor'])
          assert.equal(client[name], undefined);
      } finally {
        await client.close();
      }
    }
  });
  test(`${model}/${type} rejects H3 and unknown parents, keeps unrelated cameras`, async () => {
    for (const parent_sn of ['T8030_OWNER', 'UNKNOWN_OWNER']) {
      const raw = camera(model, type, { parent_sn });
      const inventory = discover([owner, raw, camera('T8160', 19, { parent_sn: 'T8030_OWNER' })]);
      assert.equal(inventory.result.devices.length, 3);
      assert.deepEqual(inventory.result.relationships[1], {
        deviceId: raw.device_sn,
        kind: 'unsupported',
        reason: 'unsupported_station',
      });
      assert.deepEqual(inventory.result.relationships[2], {
        deviceId: 'T8160_FIXTURE',
        kind: 'station',
        ownerId: 'T8030_OWNER',
      });
      const transport = new DeviceTransport();
      try {
        await transport.load(inventory.raw, inventory);
        assert.equal(transport.cameras.has(raw.device_sn), false);
        assert.ok(transport.cameras.has('T8160_FIXTURE'));
        assert.equal(
          transport.cameraCapabilities(raw.device_sn).live.reason,
          'unsupported_station',
        );
      } finally {
        await transport.close();
      }
    }
  });
}

test('garage model aliases and common type remain unresolved', () => {
  const rows = [
    camera('T8453', 131),
    camera('T8452', 133, { device_sn: 'MISMATCH' }),
    camera('T8452X', 132),
  ];
  assert.equal(discover(rows).result.devices.length, 0);
});
test('garage discovery never manufactures battery or availability from unrelated properties', () => {
  for (const value of [undefined, '', '12bad', '0', '72', true, 101]) {
    const raw = camera('T8452', 132, {
      main_sw_version: '',
      params: [
        { param_type: CommandType.CMD_GET_BATTERY, param_value: value },
        { param_type: CommandType.CMD_GET_DEV_STATUS, param_value: value },
      ],
    });
    const state = discover([raw]).result.devices[0];
    assert.equal(state.battery, null);
    assert.equal(state.firmware, null);
    // Use only the pinned model's state mapping, never generic numeric defaults.
    assert.equal(state.availability, value === '0' ? 'offline' : null);
  }
});
