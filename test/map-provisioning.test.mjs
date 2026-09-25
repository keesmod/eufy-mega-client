import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { PortableMapAcquisition } from '../dist/index.js';
import { mapMqttFromLogin, mapProvisioningFromRtc } from '../dist/mowers/maps/provisioning.js';
import { mapSignalHeader } from '../dist/mowers/maps/session.js';
import { mapLogin, mapRtc } from './fixtures/map-provisioning.mjs';
import { fakePeer } from './fixtures/map-peer.mjs';

const binding = () => ({
  accountUid: 'PRIVATE-TUYA-UID',
  deviceId: 'PRIVATE-DEVICE',
  localKey: 'PRIVATE-LOCALKEY',
  region: 'EU',
  expiresAt: Date.now() + 120_000,
  mqtt: mapMqttFromLogin(mapLogin(), 'EU'),
});

test('fresh RTC provisioning binds identities, caps expiry and drops cached session secrets', () => {
  const input = binding();
  const rtc = mapRtc();
  const result = mapProvisioningFromRtc(input, rtc);
  assert.equal(result.expiresAt, input.expiresAt);
  rtc.p2pConfig.expire = Math.floor((Date.now() + 90_000) / 1000);
  assert.equal(mapProvisioningFromRtc(input, rtc).expiresAt, rtc.p2pConfig.expire * 1000);
  assert.equal(result.accountUid, input.accountUid);
  assert.equal(result.peer, input.deviceId);
  assert.equal(result.localKey, input.localKey);
  assert.deepEqual(result.subscribeTopics, [
    'smart/mb/in/PRIVATE-DEVICE',
    'smart/mb/PRIVATE-TUYA-UID',
    'synthetic_partner/mb/PRIVATE-TUYA-UID',
  ]);
  assert.equal(result.publishTopic, 'smart/mb/out/PRIVATE-DEVICE');
  assert.equal(result.mqttHeader, undefined);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-CACHED'));
  result.tcpToken.urls[0] = 'tcp4:changed.invalid:443';
  result.mqtt.password = 'changed';
  assert.equal(rtc.p2pConfig.tcpRelay.urls[0], 'tcp4:relay.invalid:443');
  assert.notEqual(input.mqtt.password, 'changed');
});

for (const [name, change] of Object.entries({
  'other device': (r) => {
    r.id = 'other';
  },
  'other cached device': (r) => {
    r.p2pConfig.session.devId = 'other';
  },
  'other cached account': (r) => {
    r.p2pConfig.session.uid = 'other';
  },
  'near expiry': (r) => {
    r.p2pConfig.expire = Math.floor(Date.now() / 1000) + 64;
  },
  'noninteger expiry': (r) => {
    r.p2pConfig.expire = 'PRIVATE-EXPIRY';
  },
  'too many relays': (r) => {
    r.p2pConfig.tcpRelay.urls.push('tcp4:other.invalid:443');
  },
  'invalid relay': (r) => {
    r.p2pConfig.tcpRelay.urls = ['http://PRIVATE-TOKEN@relay.invalid'];
  },
  'missing ICE': (r) => {
    delete r.p2pConfig.ices;
  },
})) {
  test(`RTC rejects ${name} without private errors`, () => {
    const rtc = mapRtc();
    change(rtc);
    assert.throws(
      () => mapProvisioningFromRtc(binding(), rtc),
      (error) => {
        assert.equal(error.code, 'mower_map_invalid_provisioning');
        assert.ok(!inspect(error, { showHidden: true }).includes('PRIVATE-'));
        return true;
      },
    );
  });
}

test('MQTT uses the login account and regional TLS broker, rejects redirects and foreign regions', () => {
  const login = mapLogin();
  const result = mapMqttFromLogin(login, 'EU');
  assert.equal(result.clientId, 'synthetic_partner/mb/PRIVATE-TUYA-UID');
  assert.match(
    result.username,
    /^synthetic_partner_v1_yx5v9uc3ef9wg3v9atje_29e5ad57_mb_PRIVATE-SID[0-9a-f]{16}$/,
  );
  assert.match(result.password, /^[0-9a-f]{16}$/);
  for (const host of [
    'm1.tuyaus.com',
    'm1.tuyaeu.com.attacker.invalid',
    'https://m1.tuyaeu.com',
    '127.0.0.1',
  ]) {
    login.domain.mobileMqttsUrl = host;
    assert.throws(() => mapMqttFromLogin(login, 'EU'), { code: 'mower_map_invalid_provisioning' });
  }
});

test('fresh 2.3 header follows original SDK S/O contract and retains explicit legacy headers', () => {
  const first = mapSignalHeader();
  assert.equal(first.length, 12);
  assert.equal(first.subarray(0, 3).toString(), '2.3');
  assert.equal(first.readUInt32BE(3), 3);
  assert.ok(first.readUInt32BE(7) >= 1000 && first.readUInt32BE(7) < 1_001_000);
  assert.equal(first[11], 0);
  assert.equal(
    mapSignalHeader('322e33010203040000000900').toString('hex'),
    '322e33010203040000000a00',
  );
  assert.equal(mapSignalHeader('322e3301020304ffffffff00').readUInt32BE(7), 0);
});

test('acquisition with a generated header completes and cancels through the synthetic peer', async (t) => {
  const peer = fakePeer(t);
  delete peer.inputs.mqttHeader;
  const adapter = new PortableMapAcquisition(peer.inputs);
  const result = await adapter.acquire({ demandMs: 60 });
  assert.equal(result.reason, 'demand_expired');
  assert.equal(result.cancellationConfirmed, true);
  assert.equal(result.cleanupConfirmed, true);
  assert.ok(result.lastComplete);
  assert.equal(peer.live, 0);
  await adapter.shutdown();
});
