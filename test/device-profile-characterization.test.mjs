import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discover,
  isSoloCamera,
  isIndoorCamera,
  isFloodlightCamera,
  isIntegratedCamera,
  isStation,
} from '../dist/discovery.js';
import { hasCameraMedia } from '../dist/camera-media.js';
import { profileBaseline } from './fixtures/device-profile-baseline.mjs';

const owner = {
  category: 'eufy_security',
  device_sn: 'T8030_SYNTHETIC',
  parent_sn: '',
  device_model: 'T8030',
  device_type: 18,
  main_sw_version: '2.0.9.7',
  params: [],
};
const wire = (model, type) => ({
  category: 'eufy_security',
  device_sn: 'CAMERA',
  device_model: model,
  device_type: type,
  parent_sn: owner.device_sn,
  params: [],
});
const selectors = {
  solo: isSoloCamera,
  indoor: isIndoorCamera,
  floodlight: isFloodlightCamera,
  integrated: isIntegratedCamera,
};

for (const [model, type, kind, family, standalone, h3, media] of profileBaseline) {
  test(`${model}: frozen discovery, family and topology behavior`, () => {
    const camera = wire(model, type);
    assert.equal(isStation(camera), kind === 'station');
    for (const [name, select] of Object.entries(selectors)) {
      assert.equal(select(camera), name === family);
      assert.equal(select({ ...camera, device_type: -1 }), false);
    }
    for (const parent of ['', 'CAMERA', owner.device_sn, 'MISSING']) {
      const result = discover([owner, { ...camera, parent_sn: parent }]);
      assert.equal(result.result.devices.length, 2);
      const self = parent === '' || parent === 'CAMERA';
      const expected =
        kind === 'station'
          ? self
            ? { kind: 'station', ownerId: 'CAMERA' }
            : { kind: 'unsupported', reason: 'invalid_device_relationship' }
          : self
            ? standalone
              ? { kind: 'standalone', ownerId: 'CAMERA', reason: 'standalone_transport_unverified' }
              : { kind: 'unsupported', reason: 'invalid_device_relationship' }
            : h3 && parent === owner.device_sn
              ? { kind: 'station', ownerId: owner.device_sn }
              : { kind: 'unsupported', reason: 'unsupported_station' };
      assert.deepEqual(result.relationships.get('CAMERA'), expected);
      assert.equal(result.result.devices[1].kind, kind);
    }
    // T8224 also admits its reported type 96 (ha-eufy-cam#40), so its wrong type skips it.
    for (const bad of [
      { ...camera, device_type: model === 'T8224' ? type + 2 : type + 1 },
      { ...camera, device_model: 'T9999' },
      { ...camera, device_model: model.toLowerCase() },
    ]) {
      const result = discover([owner, bad]).result;
      assert.equal(result.devices.length, 1);
      assert.equal(result.issues[0].code, 'unsupported_device');
    }
  });

  test(`${model}: frozen media admission and owner/firmware boundaries`, () => {
    const camera = wire(model, type);
    const established = media === 'established';
    assert.equal(hasCameraMedia(camera, owner), media !== 'blocked');
    for (const invalidOwner of [
      undefined,
      { ...owner, device_model: 'T8010' },
      { ...owner, device_type: 0 },
      { ...owner, device_sn: 'T8030_OTHER' },
      { ...owner, main_sw_version: undefined },
      ...[
        '',
        '2.0.9.6',
        '1.99.99.99',
        '2.0.8.999',
        '2.0.9',
        'v2.0.9.7',
        '2.0.9.7suffix',
        '2.0.9.7\n',
        '2.0.9.-7',
        '2.0.9.9007199254740992',
        null,
        2097,
        {},
      ].map((main_sw_version) => ({ ...owner, main_sw_version })),
    ])
      assert.equal(hasCameraMedia(camera, invalidOwner), established);
    for (const main_sw_version of [
      '2.0.9.7',
      '2.0.9.8',
      '2.0.10.0',
      '2.1.0.0',
      '3.0.0.0',
      '02.00.09.07',
    ])
      assert.equal(hasCameraMedia(camera, { ...owner, main_sw_version }), media !== 'blocked');
    assert.equal(hasCameraMedia({ ...camera, device_type: -1 }, owner), established);
    assert.equal(hasCameraMedia({ ...camera, parent_sn: 'OTHER' }, owner), established);
    assert.equal(
      hasCameraMedia({ ...camera, parent_sn: 'HB' }, { ...owner, device_sn: 'HB' }),
      established,
    );
    for (const main_sw_version of [undefined, '', '0.0.0.0', '1.2.3', 'malformed'])
      assert.equal(hasCameraMedia({ ...camera, main_sw_version }, owner), media !== 'blocked');
    assert.equal(hasCameraMedia({ ...camera, device_model: 'T9999' }, owner), false);
  });
}

test('absent camera has no media, original station helper remains model-only', () => {
  assert.equal(hasCameraMedia(undefined, owner), false);
  assert.equal(isStation({ ...owner, device_type: -1 }), true);
  assert.equal(discover([{ ...owner, device_type: -1 }]).result.devices.length, 0);
});
