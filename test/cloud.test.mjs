import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createHmac, createHash } from 'node:crypto';
import { mkdtemp, stat, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EufyMegaClient, FileSessionStore } from '../dist/index.js';
import { MegaCloud } from '../dist/cloud.js';
import { presetDecrypt, presetEncrypt, megaDecryptBody, megaEncryptBody } from '../dist/crypto.js';

function fixture({ verify = false, lock = false, inventory, malformed = false } = {}) {
  const credentials = { email: 'test@example.invalid', password: 'fixture-secret', country: 'NL' };
  const calls = [],
    diagnostics = [];
  let stored,
    identity,
    verified = false;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const fetch = async (url, init) => {
    const u = new URL(url),
      h = init.headers;
    calls.push({ host: u.hostname, path: u.pathname, headers: h, body: init.body });
    assert.equal(u.protocol, 'https:');
    assert.match(u.hostname, /\.eufy\.com$/);
    assert.equal(init.redirect, 'error');
    if (u.pathname === '/passport/estimate_domain')
      return response({ code: 0, data: { domain: 'mega-eu-pr.eufy.com' } });
    const bootstrap = u.pathname === '/openapi/oauth/key/exchange';
    const signedValue = bootstrap ? JSON.parse(init.body).client_public_key : init.body;
    const signingKey = bootstrap
      ? '2500a7d5617812f9d52515b2c8f20a3d'
      : identity.shared.slice(0, 32);
    const signature = createHmac('sha256', Buffer.from(signingKey))
      .update([h['x-request-ts'], h['x-request-once'], signedValue].join('+'))
      .digest('hex');
    assert.equal(h['x-signature'], signature);
    if (bootstrap) {
      const server = createECDH('prime256v1');
      server.generateKeys();
      const pub = presetDecrypt(signedValue);
      identity = { shared: server.computeSecret(Buffer.from(pub, 'hex')).toString('hex') };
      return response({
        code: 0,
        data: { server_public_key: presetEncrypt(server.getPublicKey('hex')) },
      });
    }
    const key = Buffer.from(identity.shared.slice(0, 32), 'hex');
    const payload = JSON.parse(megaDecryptBody(init.body, key));
    const encrypted = (data) =>
      response({ code: 0, data: megaEncryptBody(JSON.stringify(data), key) });
    if (u.pathname === '/passport/login') {
      if (lock) return response({ code: 100028 });
      if (payload.verify_code === '123456') verified = true;
      return encrypted({
        auth_token: 'secret-auth-token',
        user_id: 'fixture-user',
        token_expires_at: Math.floor(Date.now() / 1000) + 3600,
        fa_info: { step: verify && !verified ? 26052 : 0 },
      });
    }
    if (u.pathname === '/app/sendmsg/verify_code') {
      assert.equal(payload.biz_type, 1004);
      return encrypted({});
    }
    assert.equal(h.authorization, 'secret-auth-token');
    if (u.pathname === '/app/house/get_devs_list')
      return encrypted(
        malformed
          ? {}
          : {
              devices: inventory ?? [
                {
                  category: 'eufy_security',
                  device_sn: 'HBTEST',
                  parent_sn: '',
                  device_model: 'T8030',
                  device_name: 'Base',
                  device_type: 18,
                  main_sw_version: '3.8.6.0',
                },
                {
                  category: 'eufy_security',
                  device_sn: 'CAMTEST',
                  parent_sn: 'HBTEST',
                  device_model: 'T8160',
                  device_name: 'Camera',
                  device_type: 19,
                  main_sw_version: '3.4.3.0',
                },
              ],
            },
      );
    throw new Error('unexpected route');
  };
  const store = {
    load: async () => stored,
    save: async (s) => {
      stored = structuredClone(s);
    },
  };
  const options = {
    credentials,
    sessionStore: store,
    fetch,
    minRequestIntervalMs: 0,
    diagnostics: (e) => diagnostics.push(e),
  };
  return { options, calls, diagnostics, session: () => stored };
}

test('fresh encrypted Mega login and station/camera discovery, no legacy requests', async () => {
  const f = fixture(),
    c = new EufyMegaClient(f.options);
  try {
    assert.equal((await c.connect()).state, 'connected');
    const devices = await c.listDevices();
    assert.deepEqual(
      devices.map((d) => d.model),
      ['T8030', 'T8160'],
    );
    assert.equal(devices[1].stationId, 'HBTEST');
    assert.equal(devices[0].firmware, '3.8.6.0');
    assert.equal(f.session().phase, 'authenticated');
    assert.deepEqual(
      f.calls.map((x) => x.path),
      [
        '/passport/estimate_domain',
        '/openapi/oauth/key/exchange',
        '/passport/login',
        '/app/house/get_devs_list',
      ],
    );
    assert.equal(JSON.stringify(f.diagnostics).includes('secret'), false);
    for (const x of f.diagnostics)
      assert.deepEqual(Object.keys(x).sort(), [
        'code',
        'elapsedMs',
        'host',
        'operation',
        'path',
        'status',
      ]);
  } finally {
    c.close();
  }
});
test('resume does not repeat login or discard station inventory access', async () => {
  const f = fixture();
  let c = new EufyMegaClient(f.options);
  await c.connect();
  c.close();
  const n = f.calls.length;
  c = new EufyMegaClient(f.options);
  try {
    await c.connect();
    await c.listDevices();
    assert.equal(f.calls.length, n + 1);
  } finally {
    c.close();
  }
});
test('provisional 2FA session is never considered authenticated or repeatedly emailed', async () => {
  const f = fixture({ verify: true }),
    c = new EufyMegaClient(f.options);
  try {
    assert.equal((await c.connect()).state, 'verification_required');
    assert.equal(c.connected, false);
    await assert.rejects(c.listDevices(), { code: 'authentication_required' });
    const n = f.calls.length;
    assert.equal((await c.connect()).state, 'verification_required');
    assert.equal(f.calls.length, n);
    assert.equal((await c.connect({ verifyCode: '123456' })).state, 'connected');
    assert.equal(f.calls.filter((x) => x.path === '/app/sendmsg/verify_code').length, 1);
  } finally {
    c.close();
  }
});
test('lockout persists and prevents further automatic login requests', async () => {
  const f = fixture({ lock: true });
  let c = new EufyMegaClient(f.options);
  assert.equal((await c.connect()).state, 'locked');
  c.close();
  const n = f.calls.length;
  c = new EufyMegaClient(f.options);
  assert.equal((await c.connect()).state, 'locked');
  assert.equal(f.calls.length, n);
  c.close();
});
test('inventory fails on missing data, repeated identities, or an unknown parent', async () => {
  for (const options of [
    { malformed: true },
    {
      inventory: [
        {
          category: 'eufy_security',
          device_sn: 'CAM',
          parent_sn: 'MISSING',
          device_model: 'T8160',
          device_type: 19,
        },
      ],
    },
    { inventory: Array(100).fill({}) },
  ]) {
    const f = fixture(options),
      c = new EufyMegaClient(f.options);
    try {
      await c.connect();
      await assert.rejects(c.listDevices());
    } finally {
      c.close();
    }
  }
});
test('changed account cannot restore an authenticated session belonging to another account', async () => {
  const f = fixture();
  const c = new EufyMegaClient(f.options);
  await c.connect();
  c.close();
  const oldId = f.session().deviceId;
  const next = new EufyMegaClient({
    ...f.options,
    credentials: { ...f.options.credentials, email: 'second@example.invalid' },
  });
  try {
    await next.connect();
    assert.notEqual(f.session().deviceId, oldId);
  } finally {
    next.close();
  }
});
test('untrusted saved domain cannot receive authentication secrets', async () => {
  const f = fixture();
  const id = '1'.repeat(32);
  let requested = false;
  const c = new EufyMegaClient({
    ...f.options,
    fetch: async () => {
      requested = true;
      throw Error();
    },
    sessionStore: {
      load: async () => ({
        version: 1,
        deviceId: id,
        country: 'nl',
        accountHash: createHash('sha256')
          .update(`${id}:${f.options.credentials.email}:${f.options.credentials.password}`)
          .digest('hex'),
        domain: 'attacker.invalid',
        phase: 'new',
        identities: {},
      }),
      save: async () => {},
    },
  });
  await assert.rejects(c.connect(), { code: 'invalid_session_domain' });
  assert.equal(requested, false);
  c.close();
});
test('timeouts and close abort the owning request and sanitize its error', async () => {
  for (const close of [false, true]) {
    const f = fixture();
    const cloud = new MegaCloud({
      ...f.options,
      requestTimeoutMs: 30,
      fetch: async (_url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Error('secret request dump')), {
            once: true,
          });
        }),
    });
    const p = cloud.connect();
    if (close) setTimeout(() => cloud.close(), 5);
    await assert.rejects(p, { code: close ? 'cancelled' : 'request_timeout' });
    cloud.close();
  }
});
test('file session writes are atomic and private', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mega-session-test-'));
  try {
    const store = new FileSessionStore(join(dir, 'auth.session.json'));
    assert.equal(await store.load(), undefined);
    const value = {
      version: 1,
      country: 'nl',
      deviceId: 'a'.repeat(32),
      phase: 'new',
      identities: {},
      accountHash: 'fixture',
    };
    await store.save(value);
    assert.deepEqual(await store.load(), value);
    assert.equal((await stat(join(dir, 'auth.session.json'))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expired Mega session recovers through a fresh Mega login', async () => {
  const f = fixture();
  let c = new EufyMegaClient(f.options);
  await c.connect();
  c.close();
  f.session().expiresAt = Math.floor(Date.now() / 1000) - 1;
  c = new EufyMegaClient(f.options);
  try {
    assert.equal((await c.connect()).state, 'connected');
    await c.listDevices();
    assert.equal(f.calls.filter((x) => x.path === '/passport/login').length, 2);
  } finally {
    c.close();
  }
});
test('already cancelled requests are rejected with a sanitized library error', async () => {
  const f = fixture(),
    c = new EufyMegaClient(f.options);
  try {
    await assert.rejects(c.connect(undefined, AbortSignal.abort('sensitive reason')), {
      code: 'cancelled',
    });
    assert.equal(f.calls.length, 0);
  } finally {
    c.close();
  }
});
test('a failing diagnostic consumer cannot break login', async () => {
  const f = fixture(),
    c = new EufyMegaClient({
      ...f.options,
      diagnostics: () => {
        throw Error('consumer bug');
      },
    });
  try {
    assert.equal((await c.connect()).state, 'connected');
  } finally {
    c.close();
  }
});

for (const [model, type] of [
  ['T8142', 15],
  ['T8134', 63],
]) {
  test(`${model} S220 is discovered beside existing cameras, with its HomeBase relationship`, async () => {
    const base = {
      category: 'eufy_security',
      device_sn: 'HBTEST',
      parent_sn: '',
      device_model: 'T8030',
      device_type: 18,
    };
    const camera = {
      category: 'eufy_security',
      device_sn: 'S220TEST',
      parent_sn: 'HBTEST',
      device_model: model,
      device_type: type,
      device_name: 'S220',
      main_sw_version: 'fixture',
    };
    const f = fixture({
      inventory: [
        base,
        camera,
        { ...camera, device_sn: 'EXISTING', device_model: 'T8160', device_type: 19 },
        { ...camera, device_sn: 'UNKNOWN', device_model: 'T9999' },
        { ...camera, device_sn: 'OTHER', category: 'other' },
      ],
    });
    const c = new EufyMegaClient(f.options);
    try {
      await c.connect();
      const devices = await c.listDevices();
      assert.deepEqual(
        devices.map((d) => d.model),
        ['T8030', model, 'T8160'],
      );
      assert.equal(devices[1].kind, 'camera');
      assert.equal(devices[1].stationId, 'HBTEST');
      assert.equal(devices[1].firmware, 'fixture');
      assert.equal(f.calls.at(-1).path, '/app/house/get_devs_list');
    } finally {
      await c.close();
    }
  });
  test(`${model} cannot introduce standalone or missing-parent operation`, async () => {
    for (const parent of ['', 'MISSING']) {
      const f = fixture({
        inventory: [
          {
            category: 'eufy_security',
            device_sn: 'S220TEST',
            parent_sn: parent,
            device_model: model,
            device_type: type,
          },
        ],
      });
      const c = new EufyMegaClient(f.options);
      try {
        await c.connect();
        await assert.rejects(c.listDevices(), { code: 'unsupported_station' });
      } finally {
        await c.close();
      }
    }
  });
}
