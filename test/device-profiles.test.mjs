import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import {
  deviceProfiles,
  exactDeviceProfile,
  modelProfile,
  profileEvidence,
} from '../dist/device-profiles.js';
import { discover } from '../dist/discovery.js';
import { hasCameraMedia } from '../dist/camera-media.js';
import { EufyError } from '../dist/index.js';
import { CommandName } from '../dist/vendor/http/index.js';
import { renderDeviceProfiles } from '../scripts/device-profiles.mjs';
import { profileBaseline } from './fixtures/device-profile-baseline.mjs';
import { mediaFixture } from './fixtures/media.mjs';
import { indoorMedia } from './fixtures/indoor-media.mjs';

test('registry contains exactly the characterized profiles with explicit immutable feature policy', async () => {
  assert.deepEqual(
    Object.keys(deviceProfiles).sort(),
    profileBaseline.map(([model]) => model).sort(),
  );
  assert.equal(Object.isFrozen(deviceProfiles), true);
  for (const [model, type, kind, , , , policy] of profileBaseline) {
    const profile = deviceProfiles[model];
    assert.equal(profile.type, type);
    assert.equal(profile.kind, kind);
    assert.deepEqual(profile.features, { snapshot: policy, live: policy, recordings: policy });
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.features), true);
    await access(new URL(`../docs/${profileEvidence[profile.family]}`, import.meta.url));
    assert.equal(exactDeviceProfile({ device_model: model, device_type: type }), profile);
    assert.equal(exactDeviceProfile({ device_model: model, device_type: -1 }), undefined);
  }
});

test('ha-eufy-cam#229: only T8170 offers preset moves', () => {
  for (const [model, profile] of Object.entries(deviceProfiles))
    assert.equal(profile.presets, model === 'T8170' ? true : undefined, model);
  assert.equal(Object.isFrozen(deviceProfiles.T8170), true);
});

test('only T8224 admits a reported type, and only for that exact pair', () => {
  for (const [model, profile] of Object.entries(deviceProfiles))
    if (model !== 'T8224') assert.equal(profile.reportedTypes, undefined, model);
  const c30 = deviceProfiles.T8224;
  assert.deepEqual(c30.reportedTypes, [96]);
  assert.equal(Object.isFrozen(c30.reportedTypes), true);
  assert.equal(exactDeviceProfile({ device_model: 'T8224', device_type: 96 }), c30);
  for (const [device_model, device_type] of [
    ['T8224', 97],
    ['T8224', '96'],
    ['T8223', 95],
    ['T8214', 96],
  ])
    assert.equal(exactDeviceProfile({ device_model, device_type }), undefined);
  const owner = {
    device_model: 'T8030',
    device_type: 18,
    device_sn: 'T8030_SYNTHETIC',
    main_sw_version: '2.0.9.7',
  };
  const camera = { device_model: 'T8224', device_type: 96, parent_sn: owner.device_sn };
  for (const feature of ['snapshot', 'live', 'recordings']) {
    assert.equal(hasCameraMedia(camera, owner, feature), true);
    assert.equal(hasCameraMedia(camera, { ...owner, main_sw_version: '2.0.9.6' }, feature), false);
    assert.equal(hasCameraMedia({ ...camera, device_type: 97 }, owner, feature), false);
  }
});

for (const model of ['T8113-Z', 'T8113-V']) {
  test(`${model} carries the exact T8113 policy and actual H3 owner`, () => {
    const suffixed = deviceProfiles[model];
    assert.deepEqual({ ...suffixed }, { ...deviceProfiles.T8113 });
    assert.equal(exactDeviceProfile({ device_model: model, device_type: 8 }), suffixed);
    for (const [device_model, device_type] of [
      [model, 9],
      [model, '8'],
      ['T8113-X', 8],
      [model.replace('-', ''), 8],
      [model.toLowerCase(), 8],
      [model + ' ', 8],
    ])
      assert.equal(exactDeviceProfile({ device_model, device_type }), undefined, device_model);
    const owner = {
      category: 'eufy_security',
      device_model: 'T8030',
      device_type: 18,
      device_sn: 'T8030_SYNTHETIC',
      parent_sn: '',
      main_sw_version: '3.8.7.4',
    };
    const camera = {
      category: 'eufy_security',
      device_sn: 'CAM',
      device_model: model,
      device_type: 8,
      parent_sn: owner.device_sn,
      main_sw_version: '3.0.7.8',
    };
    const result = discover([owner, camera]);
    assert.deepEqual(result.relationships.get('CAM'), {
      kind: 'station',
      ownerId: owner.device_sn,
    });
    assert.equal(result.result.devices[1].model, model);
    for (const feature of ['snapshot', 'live', 'recordings']) {
      assert.equal(hasCameraMedia(camera, owner, feature), true);
      assert.equal(hasCameraMedia(camera, { ...owner, device_model: 'T8002' }, feature), false);
      assert.equal(
        hasCameraMedia(camera, { ...owner, main_sw_version: '2.0.9.6' }, feature),
        false,
      );
      assert.equal(hasCameraMedia({ ...camera, parent_sn: 'OTHER' }, owner, feature), false);
    }
    assert.equal(
      discover([owner, { ...camera, parent_sn: 'CAM' }]).result.issues[0].code,
      'invalid_device_relationship',
    );
  });
}

// ha-eufy-cam#149: the reported owner and camera firmware. Synthetic identities only.
const reportedOwner = {
  category: 'eufy_security',
  device_model: 'T8030',
  device_type: 18,
  device_sn: 'T8030_SYNTHETIC',
  parent_sn: '',
  main_sw_version: '3.8.7.4',
};
const h3Policy = { snapshot: 'h3', live: 'h3', recordings: 'h3' };
// The additional-H3 owner gates every admitted feature, unlike the established route.
function assertH3OwnerGates(camera, owner) {
  for (const feature of ['snapshot', 'live', 'recordings']) {
    assert.equal(hasCameraMedia(camera, owner, feature), true, feature);
    for (const other of [
      undefined,
      { ...owner, device_model: 'T8002' },
      { ...owner, main_sw_version: '2.0.9.6' },
      { ...owner, main_sw_version: undefined },
    ])
      assert.equal(hasCameraMedia(camera, other, feature), false, feature);
    assert.equal(hasCameraMedia({ ...camera, parent_sn: 'OTHER' }, owner, feature), false);
    assert.equal(
      hasCameraMedia({ ...camera, parent_sn: 'HB' }, { ...owner, device_sn: 'HB' }, feature),
      false,
    );
    assert.equal(hasCameraMedia({ ...camera, parent_sn: '' }, owner, feature), false);
  }
}

test('T8160-C has the T8160 type and adapter with the additional-H3 media policy', () => {
  const profile = deviceProfiles['T8160-C'];
  // Not a copy of the T8160 row: established media stays with the original four models.
  assert.deepEqual(
    { ...profile, features: { ...profile?.features } },
    { type: 19, kind: 'camera', family: 'eufycam', topology: 'h3', features: h3Policy },
  );
  assert.equal(deviceProfiles.T8160.features.live, 'established');
  assert.equal(exactDeviceProfile({ device_model: 'T8160-C', device_type: 19 }), profile);
  for (const [device_model, device_type] of [
    ['T8160-C', 23],
    ['T8160-C', 31],
    ['T8160-C', '19'],
    ['T8160-X', 19],
    ['T8160-Z', 19],
    ['T8160-CC', 19],
    ['T8160C', 19],
    ['t8160-c', 19],
    ['T8160-c', 19],
    ['T8160-C ', 19],
    [' T8160-C', 19],
  ])
    assert.equal(exactDeviceProfile({ device_model, device_type }), undefined, device_model);
  const camera = {
    category: 'eufy_security',
    device_sn: 'CAM',
    device_model: 'T8160-C',
    device_type: 19,
    parent_sn: reportedOwner.device_sn,
    main_sw_version: '1.5.8.6',
    main_hw_version: '0.0.3.7',
  };
  const result = discover([reportedOwner, camera]);
  assert.deepEqual(result.relationships.get('CAM'), {
    kind: 'station',
    ownerId: reportedOwner.device_sn,
  });
  assert.equal(result.result.devices[1].model, 'T8160-C');
  assert.equal(result.result.devices[1].firmware, '1.5.8.6');
  assert.deepEqual(result.result.issues, []);
  assertH3OwnerGates(camera, reportedOwner);
  // The original T8160 keeps its model-only check, so only T8160-C needs the owner.
  for (const feature of ['snapshot', 'live', 'recordings']) {
    assert.equal(hasCameraMedia({ ...camera, device_model: 'T8160' }, undefined, feature), true);
    assert.equal(hasCameraMedia(camera, undefined, feature), false);
  }
  for (const parent_sn of ['', 'CAM'])
    assert.deepEqual(discover([reportedOwner, { ...camera, parent_sn }]).relationships.get('CAM'), {
      kind: 'unsupported',
      reason: 'invalid_device_relationship',
    });
  assert.equal(
    discover([reportedOwner, { ...camera, parent_sn: 'HB\n' }]).result.issues[0].code,
    'invalid_device_relationship',
  );
});

// ha-eufy-cam#198: T8210/7 and T8210C/7 rest on public evidence, not on the reporter's row.
test('T8210 and T8210C are admitted only as type 7 with the additional-H3 doorbell policy', () => {
  // Separate profiles with the same policy, not a prefix match.
  assert.notEqual(deviceProfiles.T8210, deviceProfiles.T8210C);
  // T8212 stays a type 7 candidate. No other suffix or type-only admission.
  for (const [device_model, device_type] of [
    ['T8210', 16],
    ['T8210', 91],
    ['T8210', '7'],
    ['T8210C', 16],
    ['T8210C', '7'],
    ['T8212', 7],
    ['T8210P', 7],
    ['T8210-C', 7],
    ['T8210CC', 7],
    ['t8210', 7],
    ['T8210c', 7],
    ['T8210 ', 7],
    [' T8210C', 7],
  ])
    assert.equal(exactDeviceProfile({ device_model, device_type }), undefined, device_model);
  for (const model of ['T8210', 'T8210C']) {
    const profile = deviceProfiles[model];
    assert.deepEqual(
      { ...profile, features: { ...profile?.features } },
      { type: 7, kind: 'camera', family: 'battery-doorbell', topology: 'h3', features: h3Policy },
    );
    assert.equal(exactDeviceProfile({ device_model: model, device_type: 7 }), profile);
    const camera = {
      category: 'eufy_security',
      device_sn: 'CAM',
      device_model: model,
      device_type: 7,
      parent_sn: reportedOwner.device_sn,
      main_sw_version: '1.2.3',
    };
    const result = discover([reportedOwner, camera]);
    assert.deepEqual(result.relationships.get('CAM'), {
      kind: 'station',
      ownerId: reportedOwner.device_sn,
    });
    assert.equal(result.result.devices[1].model, model);
    assert.deepEqual(result.result.issues, []);
    assertH3OwnerGates(camera, reportedOwner);
    for (const feature of ['snapshot', 'live', 'recordings'])
      assert.equal(hasCameraMedia(camera, undefined, feature), false);
    for (const parent_sn of ['', 'CAM'])
      assert.deepEqual(
        discover([reportedOwner, { ...camera, parent_sn }]).relationships.get('CAM'),
        { kind: 'unsupported', reason: 'invalid_device_relationship' },
      );
  }
});

test('T8410C has the T8410 H3 policy and its experimental standalone flag', () => {
  const profile = deviceProfiles.T8410C;
  const indoor = { type: 31, kind: 'camera', family: 'indoor', topology: 'h3-or-standalone' };
  // T8410 carries the experimentalStandalone flag since 0.29.1 (ha-eufy-cam#152), T8410C since
  // 0.30.0 (ha-eufy-cam#168). The rest of both profiles is the same H3 policy.
  for (const model of ['T8410', 'T8410C']) {
    const { experimentalStandalone, ...h3 } = deviceProfiles[model];
    assert.equal(experimentalStandalone, true, model);
    assert.equal(Object.isFrozen(deviceProfiles[model]), true, model);
    assert.deepEqual({ ...h3, features: { ...h3.features } }, { ...indoor, features: h3Policy });
  }
  assert.equal(exactDeviceProfile({ device_model: 'T8410C', device_type: 31 }), profile);
  assert.equal(
    exactDeviceProfile({ device_model: 'T8410', device_type: 31 }),
    deviceProfiles.T8410,
  );
  for (const [device_model, device_type] of [
    ['T8410C', 30],
    ['T8410C', 19],
    ['T8410C', '31'],
    ['T8410-C', 31],
    ['T8410P', 31],
    ['T8410N', 31],
    ['T8410CC', 31],
    ['T8410C21', 31],
    ['t8410c', 31],
    ['T8410c', 31],
    ['T8410C ', 31],
    [' T8410C', 31],
  ])
    assert.equal(exactDeviceProfile({ device_model, device_type }), undefined, device_model);
  const camera = {
    category: 'eufy_security',
    device_sn: 'CAM',
    device_model: 'T8410C',
    device_type: 31,
    parent_sn: reportedOwner.device_sn,
    main_sw_version: '3.3.4.4',
  };
  const result = discover([reportedOwner, camera]);
  assert.deepEqual(result.relationships.get('CAM'), {
    kind: 'station',
    ownerId: reportedOwner.device_sn,
  });
  assert.equal(result.result.devices[1].model, 'T8410C');
  assert.deepEqual(result.result.issues, []);
  assertH3OwnerGates(camera, reportedOwner);
  // An empty or self parent keeps the unverified descriptor without the opt-in and becomes
  // its own experimental owner with it. Missing connection fields stay in the descriptor.
  const descriptor = { did: false, license: false, adminUser: false, lanAddress: false };
  for (const parent_sn of ['', 'CAM']) {
    const standalone = discover([reportedOwner, { ...camera, parent_sn }]);
    assert.deepEqual(standalone.relationships.get('CAM'), {
      kind: 'standalone',
      ownerId: 'CAM',
      reason: 'standalone_transport_unverified',
      descriptor,
    });
    assert.deepEqual(standalone.owners.get('CAM'), {
      id: 'CAM',
      kind: 'standalone',
      transport: 'unsupported',
    });
    const optedIn = discover([reportedOwner, { ...camera, parent_sn }], {
      experimentalStandalone: true,
    });
    assert.deepEqual(optedIn.relationships.get('CAM'), {
      kind: 'standalone',
      ownerId: 'CAM',
      transport: 'experimental',
      descriptor,
    });
    assert.deepEqual(optedIn.owners.get('CAM'), {
      id: 'CAM',
      kind: 'standalone',
      transport: 'lan-experimental',
    });
  }
  assert.equal(
    discover([reportedOwner, { ...camera, parent_sn: 'HB\n' }]).result.issues[0].code,
    'invalid_device_relationship',
  );
});

test('T8424 is recognized as its own station and never as an H3 camera', () => {
  const owner = {
    category: 'eufy_security',
    device_model: 'T8030',
    device_type: 18,
    device_sn: 'T8030_SYNTHETIC',
    parent_sn: '',
    main_sw_version: '3.8.7.4',
  };
  const floodlight = (parent_sn) => ({
    category: 'eufy_security',
    device_sn: 'FLOOD',
    device_model: 'T8424',
    device_type: 39,
    parent_sn,
    main_sw_version: '2.1.1.5',
  });
  for (const parent of ['', 'FLOOD'])
    assert.deepEqual(discover([owner, floodlight(parent)]).relationships.get('FLOOD'), {
      kind: 'standalone',
      ownerId: 'FLOOD',
      reason: 'standalone_transport_unverified',
      descriptor: { did: false, license: false, adminUser: false, lanAddress: false },
    });
  const underHomeBase = discover([owner, floodlight(owner.device_sn)]);
  assert.deepEqual(underHomeBase.relationships.get('FLOOD'), {
    kind: 'unsupported',
    reason: 'unsupported_station',
  });
  for (const feature of ['snapshot', 'live', 'recordings'])
    assert.equal(hasCameraMedia(floodlight(owner.device_sn), owner, feature), false);
  assert.equal(exactDeviceProfile({ device_model: 'T8424', device_type: 37 }), undefined);
});

test('T817L admits only the reported Wired Cam C31 pair, with media commands only', async () => {
  const { T817L } = deviceProfiles;
  assert.equal(exactDeviceProfile({ device_model: 'T817L', device_type: 10031 }), T817L);
  for (const [device_model, device_type] of [
    ['T817L', 10035],
    ['T817L', 96],
    ['T817L121', 10031],
    ['T817', 10031],
    ['t817l', 10031],
    ['T817L ', 10031],
  ])
    assert.equal(exactDeviceProfile({ device_model, device_type }), undefined, device_model);
  // The reported owner and camera firmware from ha-eufy-cam#136.
  const owner = {
    category: 'eufy_security',
    device_model: 'T8030',
    device_type: 18,
    device_sn: 'T8030_SYNTHETIC',
    parent_sn: '',
    main_sw_version: '3.8.5.2',
  };
  const camera = (parent_sn) => ({
    category: 'eufy_security',
    device_sn: 'C31',
    device_model: 'T817L',
    device_type: 10031,
    parent_sn,
    main_sw_version: '2.1.0.3',
  });
  assert.deepEqual(discover([owner, camera(owner.device_sn)]).relationships.get('C31'), {
    kind: 'station',
    ownerId: owner.device_sn,
  });
  for (const parent of ['', 'C31'])
    assert.deepEqual(discover([owner, camera(parent)]).relationships.get('C31'), {
      kind: 'standalone',
      ownerId: 'C31',
      reason: 'standalone_transport_unverified',
      descriptor: { did: false, license: false, adminUser: false, lanAddress: false },
    });
  for (const feature of ['snapshot', 'live', 'recordings']) {
    assert.equal(hasCameraMedia(camera(owner.device_sn), owner, feature), true);
    assert.equal(hasCameraMedia(camera(''), owner, feature), false);
  }
  const f = await mediaFixture(indoorMedia.find((p) => p.model === 'T817L'));
  try {
    const sdk = f.transport.cameras.get(f.camera.device_sn);
    assert.equal(sdk.isWiredCamC31(), true);
    assert.deepEqual(sdk.getCommands(), [
      CommandName.DeviceStartLivestream,
      CommandName.DeviceStopLivestream,
      CommandName.DeviceStartDownload,
      CommandName.DeviceCancelDownload,
    ]);
  } finally {
    await f.close();
  }
});

test('object keys, coercible objects and malformed identities never become profiles', () => {
  for (const device_model of [
    undefined,
    null,
    '',
    'constructor',
    '__proto__',
    'toString',
    { toString: () => 'T8134' },
    ['T8134'],
    'T8134\n',
    'T8134suffix',
  ]) {
    assert.equal(modelProfile(device_model), undefined);
    const raw = {
      category: 'eufy_security',
      device_sn: 'CAM',
      parent_sn: '',
      device_model,
      device_type: 63,
    };
    assert.equal(discover([raw]).result.issues[0].code, 'unsupported_device');
    for (const feature of ['snapshot', 'live', 'recordings'])
      assert.equal(hasCameraMedia(raw, undefined, feature), false);
  }
});

test('every feature retains admission and rejection for every existing profile', () => {
  const owner = {
    device_model: 'T8030',
    device_type: 18,
    device_sn: 'T8030_SYNTHETIC',
    main_sw_version: '2.0.9.7',
  };
  for (const [model, type, , , , , policy] of profileBaseline) {
    const camera = { device_model: model, device_type: type, parent_sn: owner.device_sn };
    for (const feature of ['snapshot', 'live', 'recordings']) {
      assert.equal(hasCameraMedia(camera, owner, feature), policy !== 'blocked');
      assert.equal(
        hasCameraMedia(camera, { ...owner, main_sw_version: '2.0.9.6' }, feature),
        policy === 'established',
      );
      assert.equal(hasCameraMedia(camera, undefined, feature), policy === 'established');
    }
  }
});

test('capabilities preserve individual feature failures and operation policy selection', async (t) => {
  const f = await mediaFixture(indoorMedia[0]);
  try {
    const original = f.transport.camera.bind(f.transport);
    let blocked = 'live';
    t.mock.method(f.transport, 'camera', (id, feature) => {
      if (feature === blocked) throw new EufyError('camera_media_unverified');
      return original(id, feature);
    });
    assert.deepEqual(f.transport.cameraCapabilities(f.camera.device_sn), {
      snapshot: { available: true, status: 'experimental', reason: null },
      live: { available: false, status: 'unsupported', reason: 'camera_media_unverified' },
      recordings: { available: true, status: 'experimental', reason: null },
      presets: {
        available: false,
        status: 'unsupported',
        reason: 'operation_outside_hardware_scope',
      },
    });
    await assert.rejects(f.transport.startLive(f.camera.device_sn), {
      code: 'camera_media_unverified',
    });
    blocked = 'snapshot';
    await assert.rejects(f.transport.snapshot(f.camera.device_sn), {
      code: 'camera_media_unverified',
    });
    blocked = 'recordings';
    f.transport.recordings.references.set('SYNTHETIC', {
      stationId: f.camera.parent_sn,
      row: { device_sn: f.camera.device_sn, thumb_path: 'synthetic.jpg' },
      expires: Date.now() + 1000,
    });
    await assert.rejects(f.transport.recordings.download('SYNTHETIC'), {
      code: 'camera_media_unverified',
    });
    await assert.rejects(f.transport.recordings.thumbnail('SYNTHETIC'), {
      code: 'camera_media_unverified',
    });
    f.transport.failures.set(f.camera.parent_sn, 'invalid_connection_credentials');
    assert.deepEqual(
      Object.values(f.transport.cameraCapabilities(f.camera.device_sn)).map(
        (value) => value.reason,
      ),
      [
        'invalid_connection_credentials',
        'invalid_connection_credentials',
        'camera_media_unverified',
        'operation_outside_hardware_scope',
      ],
    );
    assert.equal(f.counts.starts, 0);
    assert.equal(f.counts.stops, 0);
  } finally {
    f.transport.failures.clear();
    await f.close();
  }
});

test('profile documentation is generated from the current source', async () => {
  const document = await readFile(new URL('../docs/DEVICE_PROFILES.md', import.meta.url), 'utf8');
  assert.equal(await renderDeviceProfiles(document), document);
  const stale = document.replace('| T8400', '| T9999');
  assert.notEqual(await renderDeviceProfiles(stale), stale);
});
