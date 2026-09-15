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
