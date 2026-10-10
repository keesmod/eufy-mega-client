import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EufyMegaClient } from '../dist/index.js';
import { discover } from '../dist/discovery.js';
import { DeviceTransport } from '../dist/device-transport.js';
import { hasCameraMedia } from '../dist/camera-media.js';
import { deviceProfiles } from '../dist/device-profiles.js';
import { Station, WallLightCam } from '../dist/vendor/http/index.js';
import { CommandName } from '../dist/vendor/http/types.js';
import { CommandType, P2PConnectionType } from '../dist/vendor/p2p/types.js';
import { PassThrough } from 'node:stream';
import { cloudFixture } from './fixtures/mega-cloud.mjs';

// keesmod/eufy-mega-client#142, ha-eufy-cam#66: a standalone T84A1 behind the
// experimentalStandalone opt-in. All rows and observations are synthetic.
const complete = { did: true, license: true, adminUser: true, lanAddress: true };
const wallLight = (extra = {}) => ({
  category: 'eufy_security',
  device_sn: 'T84A1_FIXTURE',
  parent_sn: '',
  device_model: 'T84A1',
  device_type: 151,
  device_channel: 0,
  device_name: 'Synthetic Wall Light',
  main_sw_version: '1.1.0.4',
  p2p_did: 'SYNTHETIC-000001-ABCDE',
  p2p_license: 'SYNTHETIC',
  member: { admin_user_id: 'synthetic-admin' },
  params: [{ param_type: 1176, param_value: '192.168.1.40' }],
  ...extra,
});
const homeBase = {
  category: 'eufy_security',
  device_sn: 'T8030_OWNER',
  parent_sn: '',
  device_model: 'T8030',
  device_type: 18,
  main_sw_version: '3.8.7.4',
  p2p_did: 'SYNTHETIC-000002-ABCDE',
  member: { admin_user_id: 'synthetic-admin' },
  params: [],
};
const eufyCam = {
  category: 'eufy_security',
  device_sn: 'T8161_FIXTURE',
  parent_sn: 'T8030_OWNER',
  device_model: 'T8161',
  device_type: 23,
  device_channel: 1,
  device_name: 'Synthetic eufyCam',
  params: [],
};
const fakeStation = (wire, address, created) => {
  const station = Object.assign(new EventEmitter(), {
    wire,
    address,
    connectionType: undefined,
    issued: [],
    getSerial: () => wire.station_sn,
    setConnectionType(type) {
      station.connectionType = type;
    },
    initialize() {},
    update(next) {
      station.wire = next;
    },
    dispose: async () => {},
    hasProperty: () => false,
    hasCommand: () => true,
    isConnected: () => false,
    getCameraInfo() {},
    processPushNotification() {},
    databaseQueryLatestInfo() {
      station.issued.push(['latest']);
    },
    downloadImage(path) {
      station.issued.push(['image', path]);
    },
    startLivestream(camera) {
      station.issued.push(['live', camera.getSerial(), camera.getChannel()]);
    },
    stopLivestream(camera) {
      station.issued.push(['stop', camera.getSerial(), camera.getChannel()]);
    },
    connect: async () => {
      station.emit('station found', station);
      station.emit('connect', station);
      station.emit('encryption ready', station, 'lan-derived');
    },
    close: async () => {},
  });
  created.push(station);
  return station;
};
async function fixture(t, rows, options, check, transportOptions) {
  const created = [];
  t.mock.method(Station, 'getInstance', async (_provider, wire, address) =>
    fakeStation(wire, address, created),
  );
  const transport = new DeviceTransport(transportOptions);
  try {
    const inventory = discover(rows, options);
    await transport.load(inventory.raw, inventory);
    await check(transport, inventory, created);
  } finally {
    await transport.close();
  }
}

test('only the T84A1 profile allows the experimental standalone route', () => {
  const allowed = Object.entries(deviceProfiles)
    .filter(([, profile]) => profile.experimentalStandalone)
    .map(([model]) => model);
  assert.deepEqual(allowed, ['T84A1']);
  assert.equal(Object.isFrozen(deviceProfiles.T84A1), true);
  assert.deepEqual(deviceProfiles.T84A1.features, {
    snapshot: 'blocked',
    live: 'blocked',
    recordings: 'blocked',
  });
});

for (const parent of ['', 'T84A1_FIXTURE'])
  test(`opted-in standalone T84A1 with ${parent ? 'a self' : 'an empty'} parent is its own experimental owner`, () => {
    const inventory = discover([wallLight({ parent_sn: parent })], {
      experimentalStandalone: true,
    });
    assert.deepEqual(inventory.result.relationships, [
      {
        deviceId: 'T84A1_FIXTURE',
        kind: 'standalone',
        ownerId: 'T84A1_FIXTURE',
        transport: 'experimental',
        descriptor: complete,
      },
    ]);
    assert.deepEqual(inventory.result.issues, []);
    assert.deepEqual(inventory.owners.get('T84A1_FIXTURE'), {
      id: 'T84A1_FIXTURE',
      kind: 'standalone',
      transport: 'lan-experimental',
    });
    assert.equal(inventory.result.devices[0].stationId, 'T84A1_FIXTURE');
    assert.equal(inventory.result.devices[0].kind, 'camera');
    // The public result carries presence booleans only, never connection values.
    const text = JSON.stringify(inventory.result);
    for (const secret of ['SYNTHETIC', 'synthetic-admin', '192.168.1.40', 'p2p'])
      assert.equal(text.includes(secret), false, secret);
  });

for (const options of [
  undefined,
  {},
  { experimentalStandalone: false },
  { experimentalStandalone: 'true' },
])
  test(`standalone T84A1 stays unverified with options ${JSON.stringify(options)}`, () => {
    const inventory = discover([wallLight()], options);
    assert.deepEqual(inventory.result.relationships, [
      {
        deviceId: 'T84A1_FIXTURE',
        kind: 'standalone',
        ownerId: 'T84A1_FIXTURE',
        reason: 'standalone_transport_unverified',
        descriptor: complete,
      },
    ]);
    assert.deepEqual(
      inventory.result.issues.map((issue) => issue.code),
      ['standalone_transport_unverified'],
    );
    assert.equal(inventory.owners.get('T84A1_FIXTURE').transport, 'unsupported');
  });

test('the opt-in admits no other standalone model, type or HomeBase topology', () => {
  const others = [
    ['T8134', 63],
    ['T8424', 39],
    ['T8200', 5],
    ['T81A0', 10005],
    ['T8452', 132],
  ];
  for (const [device_model, device_type] of others) {
    const inventory = discover([wallLight({ device_model, device_type })], {
      experimentalStandalone: true,
    });
    assert.equal(inventory.result.relationships[0].reason, 'standalone_transport_unverified');
    assert.equal(inventory.owners.get('T84A1_FIXTURE').transport, 'unsupported');
  }
  const wrongType = discover([wallLight({ device_type: 150 })], { experimentalStandalone: true });
  assert.deepEqual(
    wrongType.result.issues.map((issue) => issue.code),
    ['unsupported_device'],
  );
  // Under a HomeBase the T84A1 keeps its H3 relationship and blocked media.
  const underHomeBase = discover([homeBase, wallLight({ parent_sn: 'T8030_OWNER' })], {
    experimentalStandalone: true,
  });
  assert.deepEqual(underHomeBase.relationships.get('T84A1_FIXTURE'), {
    kind: 'station',
    ownerId: 'T8030_OWNER',
  });
  for (const feature of ['snapshot', 'live', 'recordings'])
    assert.equal(hasCameraMedia(wallLight({ parent_sn: 'T8030_OWNER' }), homeBase, feature), false);
});

test('the descriptor reports missing and malformed connection fields without failing', () => {
  const descriptor = (extra) =>
    discover([wallLight(extra)], { experimentalStandalone: true }).result.relationships[0]
      .descriptor;
  assert.deepEqual(
    descriptor({ p2p_did: undefined, p2p_license: '', member: undefined, params: [] }),
    { did: false, license: false, adminUser: false, lanAddress: false },
  );
  for (const member of [null, 'admin', {}, { admin_user_id: '' }])
    assert.equal(descriptor({ member }).adminUser, false);
  for (const params of [
    '192.168.1.40',
    [null],
    [{ param_type: '1176', param_value: '192.168.1.40' }],
    {},
  ])
    assert.equal(descriptor({ params }).lanAddress, false);
  assert.equal(descriptor({ params: [], ip_addr: '192.168.1.41' }).lanAddress, true);
  assert.equal(descriptor({ params: [], ip_addr: '8.8.8.8' }).lanAddress, false);
  assert.equal(descriptor({ p2p_did: 42 }).did, false);
});

test('the transport makes the opted-in T84A1 its own local station with all three media features', async (t) => {
  await fixture(
    t,
    [homeBase, eufyCam, wallLight()],
    { experimentalStandalone: true },
    async (transport, _inventory, created) => {
      const standalone = created.find((s) => s.wire.station_sn === 'T84A1_FIXTURE');
      assert.ok(standalone);
      assert.equal(standalone.wire.device_type, 151);
      assert.equal(standalone.wire.station_model, 'T84A1');
      assert.equal(standalone.address, '192.168.1.40');
      assert.equal(standalone.connectionType, P2PConnectionType.ONLY_LOCAL);
      assert.deepEqual(
        standalone.wire.devices.map((d) => [d.device_sn, d.station_sn]),
        [['T84A1_FIXTURE', 'T84A1_FIXTURE']],
      );
      const camera = transport.cameras.get('T84A1_FIXTURE');
      assert.equal(camera.constructor, WallLightCam);
      assert.equal(camera.getStationSerial(), 'T84A1_FIXTURE');
      assert.equal(camera.getChannel(), 0);
      for (const feature of ['snapshot', 'live', 'recordings'])
        assert.deepEqual(transport.cameraCapabilities('T84A1_FIXTURE')[feature], {
          available: true,
          status: 'experimental',
          reason: null,
        });
      // The HomeBase and its camera keep their own owner and session.
      const owner = created.find((s) => s.wire.station_sn === 'T8030_OWNER');
      assert.deepEqual(
        owner.wire.devices.map((d) => d.device_sn),
        ['T8161_FIXTURE'],
      );
      assert.equal(transport.cameras.get('T8161_FIXTURE').getStationSerial(), 'T8030_OWNER');
      assert.equal(
        transport.recordings.connection.knownCamera('T84A1_FIXTURE', 'T84A1_FIXTURE'),
        true,
      );
      assert.equal(
        transport.recordings.connection.knownCamera('T84A1_FIXTURE', 'T8030_OWNER'),
        false,
      );
      assert.equal(
        transport.recordings.connection.knownCamera('T8161_FIXTURE', 'T84A1_FIXTURE'),
        false,
      );
      assert.equal(transport.device('T84A1_FIXTURE').stationId, 'T84A1_FIXTURE');
      assert.equal(transport.device('T84A1_FIXTURE').kind, 'camera');
    },
  );
});

test('without the opt-in the transport creates no standalone station', async (t) => {
  await fixture(t, [homeBase, wallLight()], {}, async (transport, _inventory, created) => {
    assert.deepEqual(
      created.map((s) => s.wire.station_sn),
      ['T8030_OWNER'],
    );
    assert.equal(
      transport.cameraCapabilities('T84A1_FIXTURE').live.reason,
      'standalone_transport_unverified',
    );
    await assert.rejects(transport.startLive('T84A1_FIXTURE'), {
      code: 'standalone_transport_unverified',
    });
  });
});

for (const [name, extra] of [
  ['P2P device ID', { p2p_did: '' }],
  ['administrator user', { member: {} }],
])
  test(`an opted-in T84A1 without its ${name} reports invalid connection credentials`, async (t) => {
    await fixture(
      t,
      [wallLight(extra)],
      { experimentalStandalone: true },
      async (transport, _i, created) => {
        assert.equal(created.length, 0);
        assert.equal(
          transport.cameraCapabilities('T84A1_FIXTURE').live.reason,
          'invalid_connection_credentials',
        );
        await assert.rejects(transport.connect('T84A1_FIXTURE'), {
          code: 'invalid_connection_credentials',
        });
      },
    );
  });

test('the standalone owner connects with stages, then starts live on its own channel', async (t) => {
  await fixture(
    t,
    [wallLight()],
    { experimentalStandalone: true },
    async (transport, _i, created) => {
      const stages = [];
      await transport.connect('T84A1_FIXTURE', undefined, (progress) =>
        stages.push(progress.stage),
      );
      assert.deepEqual(stages, ['lookup', 'station_found', 'session_open', 'encryption_ready']);
      assert.equal(transport.state('T84A1_FIXTURE').commandEncryption, 'lan-derived');
      const [station] = created;
      station.isConnected = () => true;
      const starting = transport.startLive('T84A1_FIXTURE');
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(station.issued.at(-1), ['live', 'T84A1_FIXTURE', 0]);
      const video = new PassThrough();
      const audio = new PassThrough();
      station.emit(
        'livestream start',
        station,
        0,
        { videoCodec: 1, audioCodec: 1, videoFPS: 15, videoWidth: 0, videoHeight: 0 },
        video,
        audio,
      );
      const handle = await starting;
      assert.equal(handle.deviceId, 'T84A1_FIXTURE');
      const stopped = handle.stop();
      assert.deepEqual(station.issued.at(-1), ['stop', 'T84A1_FIXTURE', 0]);
      station.emit('command result', station, {
        channel: 0,
        command_type: CommandType.CMD_STOP_REALTIME_MEDIA,
        return_code: 0,
      });
      station.emit('livestream stop', station, 0);
      assert.deepEqual(await stopped, { confirmed: true, reason: 'device' });
    },
  );
});

test('a latest-record answer from the standalone owner becomes that camera snapshot', async (t) => {
  await fixture(
    t,
    [wallLight()],
    { experimentalStandalone: true },
    async (transport, _i, created) => {
      const [station] = created;
      const snapshots = [];
      transport.on('snapshot', (snapshot) => snapshots.push(snapshot));
      station.emit('database query latest', station, 0, [
        { device_sn: 'T84A1_FIXTURE', crop_local_path: '/media/latest.jpg' },
        { device_sn: 'OTHER', crop_local_path: '/media/other.jpg' },
      ]);
      assert.deepEqual(station.issued, [['image', '/media/latest.jpg']]);
      const jpeg = Buffer.from([255, 216, 255, 0]);
      station.emit('image download', station, '/media/latest.jpg', jpeg);
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].deviceId, 'T84A1_FIXTURE');
      assert.deepEqual(snapshots[0].data, jpeg);
    },
  );
});

test('the real vendor station accepts the T84A1 as its own owner without opening a socket', async () => {
  const transport = new DeviceTransport();
  try {
    const inventory = discover([wallLight()], { experimentalStandalone: true });
    await transport.load(inventory.raw, inventory);
    const station = transport.stations.get('T84A1_FIXTURE');
    assert.ok(station instanceof Station);
    assert.equal(station.getSerial(), 'T84A1_FIXTURE');
    assert.equal(station.isConnected(), false);
    for (const command of [
      CommandName.StationDatabaseQueryLatestInfo,
      CommandName.StationDownloadImage,
      CommandName.StationDatabaseQueryByDate,
      CommandName.StationDatabaseCountByDate,
    ])
      assert.equal(station.hasCommand(command), true, command);
    assert.equal(transport.cameras.get('T84A1_FIXTURE').getStationSerial(), 'T84A1_FIXTURE');
    const credentials = transport.provider.getCommandCredentials;
    assert.deepEqual(await credentials('T84A1_FIXTURE', 0, 'synthetic-admin'), {
      mode: 'lan-derived',
    });
    await assert.rejects(credentials('T84A1_FIXTURE', 0, 'another-admin'), {
      code: 'invalid_connection_credentials',
    });
  } finally {
    await transport.close();
  }
});

for (const enabled of [true, false])
  test(`the client ${enabled ? 'forwards' : 'omits'} the experimentalStandalone opt-in`, async (t) => {
    t.mock.method(Station, 'getInstance', async (_provider, wire, address) =>
      fakeStation(wire, address, []),
    );
    const fixture = cloudFixture({ inventory: [wallLight()] });
    const client = new EufyMegaClient({
      ...fixture.options,
      ...(enabled ? { experimentalStandalone: true } : {}),
    });
    try {
      await client.connect();
      const result = await client.discoverDevices();
      assert.equal(result.relationships[0].transport === 'experimental', enabled);
      const live = (await client.getCameraCapabilities('T84A1_FIXTURE')).live;
      assert.equal(live.available, enabled);
      assert.equal(live.reason, enabled ? null : 'standalone_transport_unverified');
    } finally {
      await client.close();
    }
  });

test('the standalone route never reads or writes guard mode', async (t) => {
  await fixture(
    t,
    [wallLight()],
    { experimentalStandalone: true },
    async (transport, _i, created) => {
      let connects = 0;
      created[0].connect = async () => {
        connects++;
      };
      await assert.rejects(transport.setGuardMode('T84A1_FIXTURE', 63), {
        code: 'operation_outside_hardware_scope',
      });
      await assert.rejects(transport.refreshStationState('T84A1_FIXTURE'), {
        code: 'operation_outside_hardware_scope',
      });
      assert.equal(connects, 0);
      // Observed arming and alarm properties of the camera never reach its state.
      const [station] = created;
      station.hasProperty = () => true;
      station.getPropertyValue = (name) => (name === 'alarm' ? true : 30);
      station.emit('parameter observed', station, CommandType.CMD_SET_ARMING, '1', 'p2p');
      station.emit('parameter observed', station, CommandType.CMD_GET_ALARM_MODE, '1', 'p2p');
      const state = transport.state('T84A1_FIXTURE');
      assert.deepEqual(
        [state.guardMode, state.currentMode, state.alarm, state.alarmDelay, state.armDelay],
        [null, null, false, 0, 0],
      );
    },
  );
});

test('with a higher live limit the standalone camera still uses its one primary session', async (t) => {
  await fixture(
    t,
    [wallLight()],
    { experimentalStandalone: true },
    async (transport, _i, created) => {
      const starting = transport.startLive('T84A1_FIXTURE');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(created.length, 1, 'no extra P2P session');
      const [station] = created;
      assert.deepEqual(station.issued.at(-1), ['live', 'T84A1_FIXTURE', 0]);
      station.emit(
        'livestream start',
        station,
        0,
        { videoCodec: 1, audioCodec: 1 },
        new PassThrough(),
        new PassThrough(),
      );
      const handle = await starting;
      await assert.rejects(transport.startLive('T84A1_FIXTURE'), { code: 'station_busy' });
      const stopped = handle.stop();
      station.emit('command result', station, {
        channel: 0,
        command_type: CommandType.CMD_STOP_REALTIME_MEDIA,
        return_code: 0,
      });
      station.emit('livestream stop', station, 0);
      assert.deepEqual(await stopped, { confirmed: true, reason: 'device' });
    },
    { maxLiveStreamsPerStation: 3 },
  );
});

test('pushes for the standalone camera are not admitted', async (t) => {
  await fixture(
    t,
    [homeBase, eufyCam, wallLight()],
    { experimentalStandalone: true },
    async (transport, _i, created) => {
      const standalone = created.find((s) => s.wire.station_sn === 'T84A1_FIXTURE');
      let processed = 0;
      standalone.processPushNotification = () => processed++;
      const message = { device_sn: 'T84A1_FIXTURE', station_sn: 'T84A1_FIXTURE', event_type: 3101 };
      assert.equal(transport.acceptPush(message), false);
      assert.equal(transport.acceptPush({ ...message, device_sn: '' }), false);
      transport.processPush(message);
      assert.equal(processed, 0);
      // The HomeBase keeps its own station pushes.
      assert.equal(
        transport.acceptPush({ device_sn: '', station_sn: 'T8030_OWNER', event_type: 3101 }),
        true,
      );
    },
  );
});

for (const cipher_id of [0, 7, null])
  test(`a standalone recording with cipher ID ${cipher_id} is refused before any device command`, async (t) => {
    await fixture(
      t,
      [wallLight()],
      { experimentalStandalone: true },
      async (transport, _i, created) => {
        let connects = 0;
        created[0].connect = async () => {
          connects++;
        };
        transport.recordings.references.set('REC', {
          stationId: 'T84A1_FIXTURE',
          row: { device_sn: 'T84A1_FIXTURE', storage_path: '/media/clip.mp4', cipher_id },
          expires: Date.now() + 60000,
        });
        await assert.rejects(transport.recordings.download('REC'), {
          code: 'recording_cipher_unavailable',
        });
        assert.equal(connects, 0);
        assert.equal(transport.recordings.busy('T84A1_FIXTURE'), false);
        assert.deepEqual(created[0].issued, []);
      },
    );
  });

test('reloads move the T84A1 between its own owner, a HomeBase and no transport', async (t) => {
  const created = [];
  t.mock.method(Station, 'getInstance', async (_provider, wire, address) =>
    fakeStation(wire, address, created),
  );
  const transport = new DeviceTransport();
  const load = async (rows, options) => {
    const inventory = discover(rows, options);
    await transport.load(inventory.raw, inventory);
  };
  try {
    await load([homeBase, wallLight()], { experimentalStandalone: true });
    assert.deepEqual([...transport.stations.keys()].sort(), ['T8030_OWNER', 'T84A1_FIXTURE']);
    assert.equal(transport.cameraCapabilities('T84A1_FIXTURE').live.available, true);
    await load([homeBase, wallLight({ parent_sn: 'T8030_OWNER' })], {
      experimentalStandalone: true,
    });
    assert.deepEqual([...transport.stations.keys()], ['T8030_OWNER']);
    assert.equal(transport.cameras.get('T84A1_FIXTURE').getStationSerial(), 'T8030_OWNER');
    assert.equal(
      transport.cameraCapabilities('T84A1_FIXTURE').live.reason,
      'camera_media_unverified',
    );
    await load([homeBase, wallLight({ parent_sn: 'T84A1_FIXTURE' })], {
      experimentalStandalone: true,
    });
    assert.equal(transport.cameras.get('T84A1_FIXTURE').getStationSerial(), 'T84A1_FIXTURE');
    assert.equal(transport.stations.has('T84A1_FIXTURE'), true);
    await load([homeBase, wallLight()], {});
    assert.deepEqual([...transport.stations.keys()], ['T8030_OWNER']);
    assert.equal(
      transport.cameraCapabilities('T84A1_FIXTURE').live.reason,
      'standalone_transport_unverified',
    );
  } finally {
    await transport.close();
  }
});
