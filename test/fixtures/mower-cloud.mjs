// Synthetic Eufy Home and Tuya cloud responses for mower module tests. Invented values only.
import assert from 'node:assert/strict';
import { EufyClient } from '../../dist/index.js';
import { localKey, deviceId } from './local-mower.mjs';

export const credentials = {
  email: 'synthetic@example.invalid',
  password: 'PRIVATE-PASSWORD',
  country: 'NL',
};
const modulus = ((1n << 1024n) - 109n).toString();
const json = (data) => new Response(JSON.stringify(data));

export function memory() {
  let stored;
  return {
    load: async () => stored,
    save: async (value) => {
      stored = value;
    },
  };
}

/**
 * Minimal flat Home login, Tuya login, one T2880 device and its private record. `dps` is the
 * record's cached data points, omitted unless given.
 */
export function cloud({ id = deviceId, key = localKey, schema, dps } = {}) {
  return async (url) => {
    const parsed = new URL(url);
    const action = parsed.searchParams.get('a') ?? parsed.pathname;
    switch (action) {
      case '/v1/user/email/login':
        return json({
          timezone: 'Europe/Amsterdam',
          phone_code: '31',
          access_token: 'PRIVATE-TOKEN',
          user_id: '1234',
          region: 'EU',
        });
      case 'tuya.m.user.uid.token.create':
        return json({
          result: { exponent: '65537', publicKey: modulus, token: 'PRIVATE-RSA-TOKEN' },
        });
      case 'tuya.m.user.uid.password.login.reg':
        return json({
          result: {
            sid: 'PRIVATE-SID',
            uid: 'PRIVATE-TUYA-UID',
            domain: { mobileApiUrl: 'https://a1.tuyaeu.com' },
          },
        });
      case '/v1/device/list/devices-and-groups':
        return json({ items: [{ device: { id, product: { product_code: 'T2880' } } }] });
      case 'tuya.m.device.get':
        return json({
          result: {
            devId: id,
            localKey: key,
            ...(schema === undefined ? {} : { schema }),
            ...(dps === undefined ? {} : { dps }),
          },
        });
      default:
        throw new Error('unexpected request');
    }
  };
}

export async function mowerClient(t, overrides) {
  const client = new EufyClient({
    mowers: { credentials, sessionStore: memory(), home: { fetch: cloud(overrides) } },
  });
  t.after(() => client.shutdown());
  assert.deepEqual(await client.mowers.connect(), { state: 'connected' });
  const [device] = await client.mowers.discover();
  return { client, mowers: client.mowers, id: device.id };
}
