import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { EufyClient } from '../dist/index.js';
import { EufyHomeAdapter } from '../dist/mowers/home.js';
import { derivePassword, encryptPassword, mobileOrigin, sign } from '../dist/mowers/protocol.js';

const credentials = {
  email: 'synthetic@example.invalid',
  password: 'PRIVATE-PASSWORD',
  country: 'NL',
};
const privateId = 'PRIVATE-DEVICE';
const key = 'PRIVATE-LOCAL-KEY';
const sid = 'PRIVATE-SID';
const modulus = ((1n << 1024n) - 109n).toString();
const response = (data) => new Response(JSON.stringify(data));
function fixture({
  selectedRegion = 'EU',
  nested = false,
  homeResult,
  deviceResult,
  reject = false,
  origin,
  hook,
  store,
} = {}) {
  let stored;
  const calls = [];
  const sessionStore = store ?? {
    load: async () => stored && structuredClone(stored),
    save: async (value) => {
      stored = structuredClone(value);
    },
  };
  const request = async (url, init) => {
    const parsed = new URL(url);
    const action = parsed.searchParams.get('a') ?? parsed.pathname;
    calls.push({ action, host: parsed.hostname, init });
    assert.equal(init.redirect, 'error');
    const override = await hook?.({ action, parsed, init });
    if (override) return override;
    if (action === '/v1/user/email/login') {
      if (reject) return response({ msg: credentials.password });
      const info = { timezone: 'Europe/Amsterdam', phone_code: '31' };
      return response(
        nested
          ? {
              access_token: 'PRIVATE-TOKEN',
              user_info: { ...info, id: '1234', request_host: 'https://api.eufylife.com' },
            }
          : { ...info, access_token: 'PRIVATE-TOKEN', user_id: '1234', region: selectedRegion },
      );
    }
    if (action === '/v1/user/setting')
      return response({
        setting: { home_setting: { tuya_home: { tuya_region_code: selectedRegion } } },
      });
    if (action === 'tuya.m.user.uid.token.create')
      return response({
        result: { exponent: '65537', publicKey: modulus, token: 'PRIVATE-RSA-TOKEN' },
      });
    if (action === 'tuya.m.user.uid.password.login.reg')
      return response({
        result: { sid, domain: { mobileApiUrl: origin ?? `https://${parsed.hostname}` } },
      });
    if (action === 'tuya.m.location.list') return response({ result: [] });
    if (action === '/v1/device/list/devices-and-groups')
      return response(
        homeResult ?? {
          items: [
            {
              device: {
                id: privateId,
                alias_name: 'PRIVATE-NAME',
                product: { product_code: 'T2880' },
              },
            },
            { device: { id: 'unknown', product: { product_code: 'T2801' } } },
          ],
        },
      );
    if (action === 'tuya.m.device.get')
      return response({
        result: deviceResult ?? {
          devId: privateId,
          localKey: key,
          name: 'PRIVATE-NAME',
          ip: 'PRIVATE-IP',
        },
      });
    throw Error('unexpected synthetic action');
  };
  const options = { credentials, sessionStore, home: { fetch: request, requestTimeoutMs: 50 } };
  return {
    options,
    calls,
    get stored() {
      return stored;
    },
    set stored(value) {
      stored = value;
    },
  };
}
function noSecrets(value) {
  for (const secret of ['PRIVATE-', credentials.email]) assert.ok(!value.includes(secret), value);
}

for (const [selectedRegion, host] of Object.entries({
  EU: 'a1.tuyaeu.com',
  AZ: 'a1.tuyaus.com',
  AY: 'a1.tuyacn.com',
  IN: 'a1.tuyain.com',
})) {
  test(`Home ${selectedRegion} uses its own regional Tuya endpoint`, async () => {
    const f = fixture({ selectedRegion, nested: true });
    const client = new EufyClient({ mowers: f.options });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await client.mowers.connect(), { state: 'connected' });
    assert.equal(f.calls.find((call) => call.action === 'tuya.m.user.uid.token.create').host, host);
    const result = await client.mowers.discover();
    assert.equal(result.length, 1);
    assert.equal(result[0].productCode, 'T2880');
    assert.match(result[0].id, /^[a-f0-9]{64}$/);
    noSecrets(
      JSON.stringify(result) +
        inspect(client, { showHidden: true }) +
        JSON.stringify(client.mowers.authState),
    );
    assert.equal(f.calls.filter((c) => c.action === 'tuya.m.device.get').length, 1);
    await client.close();
  });
}

test('same-account restart validates SID and preserves opaque identity without login', async () => {
  const f = fixture();
  const first = new EufyClient({ mowers: f.options });
  await first.mowers.connect();
  const initial = await first.mowers.discover();
  await first.close();
  const second = new EufyClient({ mowers: f.options });
  await second.mowers.connect();
  assert.deepEqual(await second.mowers.discover(), initial);
  assert.equal(f.calls.filter((c) => c.action === '/v1/user/email/login').length, 1);
  assert.equal(f.calls.filter((c) => c.action === 'tuya.m.location.list').length, 1);
  await second.close();
});

test('expired persisted session refreshes only on explicit connect and keeps identity', async () => {
  const f = fixture();
  const first = new EufyClient({ mowers: f.options });
  await first.mowers.connect();
  const initial = await first.mowers.discover();
  await first.close();
  const data = JSON.parse(f.stored.data);
  data.expiresAt = Date.now() - 1;
  f.stored = { version: 1, data: JSON.stringify(data) };
  const next = new EufyClient({ mowers: f.options });
  await assert.rejects(next.mowers.discover(), { code: 'authentication_required' });
  await next.mowers.connect();
  assert.deepEqual(await next.mowers.discover(), initial);
  assert.equal(f.calls.filter((c) => c.action === '/v1/user/email/login').length, 2);
  await next.close();
});

test('server-revoked persisted SID permits one explicit fresh authentication', async () => {
  const f = fixture({
    hook: ({ action }) =>
      action === 'tuya.m.location.list'
        ? response({ success: false, errorCode: 'USER_SESSION_INVALID', msg: key })
        : undefined,
  });
  const first = new EufyClient({ mowers: f.options });
  await first.mowers.connect();
  await first.close();
  const second = new EufyClient({ mowers: f.options });
  await second.mowers.connect();
  assert.equal(f.calls.filter((c) => c.action === '/v1/user/email/login').length, 2);
  await second.close();
});

test('discovery expiry invalidates bindings without login or request replay', async () => {
  const f = fixture({
    hook: ({ action }) =>
      action === 'tuya.m.device.get'
        ? response({ success: false, errorCode: 'USER_SESSION_EXPIRED', msg: sid })
        : undefined,
  });
  const client = new EufyClient({ mowers: f.options });
  await client.mowers.connect();
  await assert.rejects(client.mowers.discover(), { code: 'authentication_required' });
  assert.equal(client.mowers.connected, false);
  assert.equal(f.calls.filter((c) => c.action === 'tuya.m.device.get').length, 1);
  assert.equal(f.calls.filter((c) => c.action === '/v1/user/email/login').length, 1);
  await client.close();
});

test('different account or country never restores another mower session', async () => {
  for (const changed of [{ email: 'other@example.invalid' }, { country: 'US' }]) {
    const f = fixture();
    const first = new EufyClient({ mowers: f.options });
    await first.mowers.connect();
    const initial = await first.mowers.discover();
    await first.close();
    const second = new EufyClient({
      mowers: { ...f.options, credentials: { ...credentials, ...changed } },
    });
    await second.mowers.connect();
    assert.notEqual((await second.mowers.discover())[0].id, initial[0].id);
    assert.equal(f.calls.filter((c) => c.action === 'tuya.m.location.list').length, 0);
    await second.close();
  }
});

test('rejected credentials are sanitized without fallback attempts', async () => {
  const f = fixture({ reject: true });
  const client = new EufyClient({ mowers: f.options });
  await assert.rejects(client.mowers.connect(), (error) => {
    noSecrets(inspect(error));
    return error.code === 'authentication_failed';
  });
  assert.equal(f.calls.length, 1);
  assert.equal(client.mowers.connected, false);
  await client.close();
});

test('disabled module makes no store or HTTP calls', async () => {
  const f = fixture();
  const client = new EufyClient({ mowers: false });
  assert.equal(client.mowers, undefined);
  assert.equal(f.calls.length, 0);
  await client.close();
});

for (const value of [
  'https://attacker.invalid',
  'https://a1.tuyaeu.com@attacker.invalid',
  'http://a1.tuyaeu.com',
  'https://a1.tuyaeu.com:444',
  'https://a1.tuyaeu.com/path',
  'https://a1.tuyaeu.com/?secret=x',
]) {
  test(`regional session rejects untrusted endpoint ${value}`, async () => {
    const f = fixture({ origin: value });
    const client = new EufyClient({ mowers: f.options });
    await assert.rejects(client.mowers.connect(), { code: 'mower_region_unsupported' });
    assert.equal(f.stored, undefined);
    assert.ok(f.calls.every((c) => !c.host.includes('attacker')));
    await client.close();
  });
}

test('unknown Home region fails before Tuya credentials are sent', async () => {
  const f = fixture({ selectedRegion: 'UNKNOWN' });
  const client = new EufyClient({ mowers: f.options });
  await assert.rejects(client.mowers.connect(), { code: 'mower_region_unsupported' });
  assert.equal(f.calls.length, 1);
  await client.close();
});

for (const deviceResult of [{ devId: 'other', localKey: key }, { devId: privateId }]) {
  test('missing or mismatched private connection data fails closed', async () => {
    const f = fixture({ deviceResult });
    const client = new EufyClient({ mowers: f.options });
    await client.mowers.connect();
    await assert.rejects(client.mowers.discover(), (error) => {
      noSecrets(inspect(error));
      return ['mower_binding_unavailable', 'mower_invalid_response'].includes(error.code);
    });
    await client.close();
  });
}

test('private connection is only available after discovery and is revoked at shutdown', async () => {
  const f = fixture();
  const owner = new EufyHomeAdapter(f.options, f.options.home);
  await owner.connect(undefined, new AbortController().signal);
  await assert.rejects(
    owner.withConnection('unknown', new AbortController().signal, async () => {}),
    { code: 'mower_binding_unavailable' },
  );
  const [device] = await owner.discover(new AbortController().signal);
  let lease;
  await owner.withConnection(
    device.id,
    new AbortController().signal,
    async (connection, signal) => {
      assert.equal(connection.deviceId, privateId);
      assert.equal(connection.localKey, key);
      assert.equal(connection.accountUid, 'eh-1234');
      assert.equal(signal.aborted, false);
      lease = signal;
    },
  );
  noSecrets(inspect(owner, { showHidden: true }));
  await owner.shutdown();
  assert.equal(lease.aborted, true);
  await assert.rejects(
    owner.withConnection(device.id, new AbortController().signal, async () => {}),
    { code: 'request_aborted' },
  );
});

for (const mode of ['cancel', 'shutdown', 'timeout']) {
  test(`${mode} aborts pending HTTP with no secret error or late persistence`, async () => {
    let entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const f = fixture({
      hook: ({ init }) =>
        new Promise((_, reject) => {
          entered();
          init.signal.addEventListener('abort', () => reject(Error('PRIVATE-ABORT')), {
            once: true,
          });
        }),
    });
    const client = new EufyClient({ mowers: f.options });
    const controller = new AbortController();
    const pending = assert.rejects(client.mowers.connect(undefined, controller.signal), (error) => {
      noSecrets(inspect(error));
      return error.code === (mode === 'timeout' ? 'request_timeout' : 'request_aborted');
    });
    await ready;
    // Keep the test loop alive for AbortSignal.timeout's unreferenced timer.
    const keepAlive = setTimeout(() => {}, 200);
    if (mode === 'cancel') controller.abort('PRIVATE-REASON');
    if (mode === 'shutdown') await client.close();
    await pending;
    clearTimeout(keepAlive);
    assert.equal(f.stored, undefined);
    assert.equal(client.mowers.connected, false);
    await client.close();
  });
}

test('pre-cancelled request performs no login or persistence', async () => {
  const f = fixture();
  const client = new EufyClient({ mowers: f.options });
  await assert.rejects(client.mowers.connect(undefined, AbortSignal.abort(key)), {
    code: 'request_aborted',
  });
  assert.equal(f.calls.length, 0);
  await client.close();
});

test('transport payloads and persistence failures never become public diagnostics', async () => {
  for (const mode of ['fetch', 'load', 'save']) {
    const f = fixture({
      hook:
        mode === 'fetch'
          ? () => {
              throw Error(key);
            }
          : undefined,
      store: {
        load: async () => {
          if (mode === 'load') throw Error(key);
        },
        save: async () => {
          if (mode === 'save') throw Error(key);
        },
      },
    });
    const client = new EufyClient({ mowers: f.options });
    await assert.rejects(client.mowers.connect(), (error) => {
      noSecrets(inspect(error));
      return true;
    });
    assert.equal(client.mowers.connected, false);
    await client.close();
  }
});

test('crypto helpers reject malformed RSA and non-ASCII account inputs', () => {
  assert.throws(() => encryptPassword('99999999', modulus, 'x'));
  assert.throws(() => derivePassword('é'));
  assert.equal(mobileOrigin('https://a1.tuyaeu.com/'), 'https://a1.tuyaeu.com');
});

test('crypto matches independent Python/OpenSSL synthetic vectors', () => {
  assert.equal(derivePassword('eh-1234'), '72897d59d729d4e754916d683c217172');
  assert.equal(
    sign(
      { a: 'tuya.m.user.uid.token.create', time: '1700000000', v: '1.0', gid: 'unsigned' },
      '{"uid":"eh-1234","countryCode":"31"}',
    ),
    '64c2e49b6d97ab221036121c35b7c4500574c79e3bb3092441733d209cf8bcdc',
  );
  assert.equal(
    encryptPassword('65537', modulus, 'synthetic'),
    '91c709b9d7f8e3d19bec1a4d47eb499715d833f9313ab3d7cc9b48274ca2ee526fae61233b1c6c448f8317ec0480f611a2e2947426de59bb20f4db49769c16e8921616e7945813caff4ab373bb151d1ceca663989ae85ba33fbcefb96e44444b276cef575bb738a5e30bdd8a4d783a51c86f7e04341782f55ffb81bc389eab96',
  );
});

test('new discovery revokes a prior private lease and concurrent discovery is refused', async () => {
  let block = false,
    release,
    entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    hook: ({ action }) => {
      if (block && action === '/v1/device/list/devices-and-groups')
        return new Promise((resolve) => {
          entered();
          release = () => resolve(response({ items: [] }));
        });
    },
  });
  const owner = new EufyHomeAdapter(f.options, f.options.home);
  const signal = new AbortController().signal;
  await owner.connect(undefined, signal);
  const [device] = await owner.discover(signal);
  let finish, active;
  const lease = assert.rejects(
    owner.withConnection(device.id, signal, async (_connection, abort) => {
      active = abort;
      await new Promise((resolve) => {
        finish = resolve;
      });
    }),
    { code: 'request_aborted' },
  );
  await new Promise((resolve) => setImmediate(resolve));
  block = true;
  const discovery = owner.discover(signal);
  await ready;
  assert.equal(active.aborted, true);
  await assert.rejects(owner.discover(signal), { code: 'mower_discovery_busy' });
  finish();
  release();
  await lease;
  await discovery;
  await owner.shutdown();
});

test('HTTP authorization failure revokes the connected session', async () => {
  const f = fixture({
    hook: ({ action }) =>
      action === '/v1/device/list/devices-and-groups'
        ? new Response('PRIVATE-ERROR', { status: 401 })
        : undefined,
  });
  const client = new EufyClient({ mowers: f.options });
  await client.mowers.connect();
  await assert.rejects(client.mowers.discover(), { code: 'authentication_required' });
  assert.equal(client.mowers.connected, false);
  await client.close();
});
