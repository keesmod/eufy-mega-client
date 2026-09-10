import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { EufyClient, EufyMegaClient, EufyError, FileSessionStore } from '../dist/index.js';

// Synthetic persisted sessions exercise the public session contract, not a new wire fixture.
function cameraOptions({ store, fail = false } = {}) {
  const credentials = {
    email: 'camera@example.invalid',
    password: 'camera-fixture',
    country: 'NL',
  };
  const deviceId = '1'.repeat(32);
  const session = {
    version: 1,
    country: 'nl',
    deviceId,
    accountHash: createHash('sha256')
      .update(`${deviceId}:${credentials.email}:${credentials.password}`)
      .digest('hex'),
    phase: 'authenticated',
    token: 'camera-token-fixture',
    userId: 'camera-user-fixture',
    expiresAt: Date.now() / 1000 + 3600,
    identities: {},
  };
  return {
    session,
    options: {
      credentials,
      sessionStore: store ?? {
        load: async () => {
          if (fail) throw new EufyError('session_unreadable');
          return structuredClone(session);
        },
        save: async () => {},
      },
      fetch: async () => {
        throw Error('Unexpected network request in API fixture');
      },
    },
  };
}

function mowerOptions({ fail = false, closeFails = false, store, states, pending = false } = {}) {
  let connected = false;
  let stored;
  const calls = { factory: 0, connect: 0, shutdown: 0, contexts: [], signals: [] };
  const options = {
    credentials: { email: 'mower@example.invalid', password: 'mower-fixture', country: 'NL' },
    sessionStore: store ?? {
      load: async () => stored,
      save: async (value) => {
        stored = structuredClone(value);
      },
    },
    adapter(context) {
      calls.factory++;
      calls.contexts.push(context);
      return {
        get connected() {
          return connected;
        },
        async connect(answer, signal) {
          calls.connect++;
          calls.signals.push(signal);
          if (pending) {
            await new Promise((resolve, reject) => {
              signal.addEventListener('abort', () => reject(new EufyError('request_aborted')), {
                once: true,
              });
            });
          }
          if (fail) throw Error('PRIVATE-UPSTREAM-SESSION');
          const state = states?.shift() ?? {
            state: 'connected',
            internalSession: 'PRIVATE-SESSION',
          };
          connected = state.state === 'connected';
          if (connected) {
            await context.sessionStore.load();
            await context.sessionStore.save({ version: 1, data: 'mower-session-fixture' });
          }
          return state;
        },
        async shutdown() {
          calls.shutdown++;
          connected = false;
          if (closeFails) throw Error('PRIVATE-SHUTDOWN-FAILURE');
        },
      };
    },
  };
  return {
    options,
    calls,
    expire: () => {
      connected = false;
    },
  };
}

test('existing exports and camera-only use need no mower credentials or adapter', async () => {
  const { options } = cameraOptions();
  const legacy = new EufyMegaClient(options);
  const client = new EufyClient({ security: options, mowers: false });
  assert.equal(client.mowers, undefined);
  assert.equal(client.security.lifecycle, 'open');
  assert.deepEqual(client.security.authState, { state: 'disconnected' });
  assert.deepEqual(await legacy.connect(), { state: 'connected' });
  assert.deepEqual(await client.security.connect(), { state: 'connected' });
  assert.ok(client.security instanceof EufyMegaClient);
  assert.equal(typeof client.security.startLive, 'function');
  assert.equal(typeof client.security.listRecordings, 'function');
  assert.deepEqual(client.security.authState, { state: 'connected' });
  await Promise.all([legacy.shutdown(), client.shutdown()]);
  assert.equal(client.security.lifecycle, 'closed');
  assert.deepEqual(client.security.authState, { state: 'disconnected' });
  await assert.rejects(client.security.connect(), { code: 'client_closed' });
});

test('mower-only client has independent auth and no security credentials', async () => {
  const f = mowerOptions();
  const client = new EufyClient({ mowers: f.options });
  assert.equal(client.security, undefined);
  assert.equal(f.calls.factory, 0);
  const result = await client.mowers.connect();
  assert.deepEqual(result, { state: 'connected' });
  assert.deepEqual(Object.keys(result), ['state']);
  result.state = 'locked';
  assert.deepEqual(client.mowers.authState, { state: 'connected' });
  assert.equal(client.mowers.connected, true);
  f.expire();
  assert.equal(client.mowers.connected, false);
  assert.deepEqual(client.mowers.authState, { state: 'disconnected' });
  await client.close();
  assert.equal(f.calls.shutdown, 1);
  assert.equal(client.mowers.lifecycle, 'closed');
});

test('security authentication failure leaves mower auth and lifecycle intact', async () => {
  const f = mowerOptions();
  const client = new EufyClient({
    security: cameraOptions({ fail: true }).options,
    mowers: f.options,
  });
  await client.mowers.connect();
  await assert.rejects(client.security.connect(), { code: 'session_unreadable' });
  assert.equal(client.mowers.connected, true);
  await client.security.shutdown();
  assert.equal(client.mowers.lifecycle, 'open');
  assert.equal(client.mowers.connected, true);
  await client.shutdown();
});

test('mower authentication failure is sanitized and cannot invalidate security', async () => {
  const client = new EufyClient({
    security: cameraOptions().options,
    mowers: mowerOptions({ fail: true }).options,
  });
  await client.security.connect();
  await assert.rejects(client.mowers.connect(), (error) => {
    assert.equal(error.code, 'mower_authentication_failed');
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes('PRIVATE'), false);
    return true;
  });
  assert.equal(client.security.connected, true);
  assert.deepEqual(client.mowers.authState, { state: 'disconnected' });
  await client.mowers.close();
  assert.equal(client.security.connected, true);
  assert.equal(client.security.lifecycle, 'open');
  await client.shutdown();
});

test('missing or failing lazy mower factory is explicit and isolated', async () => {
  for (const factory of [
    undefined,
    () => {
      throw Error('PRIVATE-FACTORY');
    },
  ]) {
    const options = mowerOptions().options;
    options.adapter = factory;
    const client = new EufyClient({ security: cameraOptions().options, mowers: options });
    await client.security.connect();
    await assert.rejects(client.mowers.connect(), {
      code: factory ? 'mower_authentication_failed' : 'mower_protocol_unavailable',
    });
    assert.equal(client.security.connected, true);
    await client.shutdown();
  }
});

test('verification, CAPTCHA and lock state are module-local copied public results', async () => {
  const states = [
    { state: 'verification_required', sdk: 'PRIVATE' },
    { state: 'captcha_required', captchaId: 'fixture', image: 'fixture-image', token: 'PRIVATE' },
    { state: 'locked' },
    { state: 'connected' },
  ];
  const f = mowerOptions({ states: structuredClone(states) });
  const client = new EufyClient({ security: cameraOptions().options, mowers: f.options });
  await client.security.connect();
  for (const state of states) {
    const result = await client.mowers.connect();
    assert.equal(result.state, state.state);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(client.security.connected, true);
    const snapshot = client.mowers.authState;
    snapshot.state = 'disconnected';
    assert.equal(client.mowers.authState.state, state.state);
  }
  assert.equal(f.calls.factory, 1);
  await client.shutdown();
});

test('invalid adapter results never become public successful authentication', async () => {
  for (const result of [
    undefined,
    { state: 'unknown' },
    { state: 'captcha_required', image: 123 },
  ]) {
    const options = mowerOptions().options;
    options.adapter = () => ({
      connected: false,
      connect: async () => result,
      shutdown: async () => {},
    });
    const client = new EufyClient({ mowers: options });
    await assert.rejects(client.mowers.connect(), { code: 'invalid_auth_state' });
    assert.equal(client.mowers.connected, false);
    await client.shutdown();
  }
});

test('shutdown cancels active auth, rejects overlap and cannot reconnect or replay', async () => {
  const f = mowerOptions({ pending: true });
  const client = new EufyClient({ mowers: f.options });
  const connecting = assert.rejects(client.mowers.connect(), { code: 'request_aborted' });
  await new Promise(setImmediate);
  await assert.rejects(client.mowers.connect(), { code: 'authentication_busy' });
  const closing = client.shutdown();
  assert.equal(client.shutdown(), closing);
  assert.equal(client.mowers.lifecycle, 'closing');
  await Promise.all([closing, connecting]);
  await assert.rejects(client.mowers.connect(), { code: 'client_closed' });
  await client.close();
  assert.equal(f.calls.factory, 1);
  assert.equal(f.calls.connect, 1);
  assert.equal(f.calls.shutdown, 1);
  assert.equal(f.calls.signals[0].aborted, true);
  assert.equal(client.mowers.connected, false);
});

test('immediate shutdown and already-aborted login never create a mower adapter', async () => {
  for (const immediate of [true, false]) {
    const f = mowerOptions();
    const client = new EufyClient({ mowers: f.options });
    const connecting = assert.rejects(
      client.mowers.connect(undefined, immediate ? undefined : AbortSignal.abort()),
      { code: 'request_aborted' },
    );
    if (immediate) await client.shutdown();
    await connecting;
    await client.shutdown();
    assert.equal(f.calls.factory, 0);
  }
});

test('caller cancellation leaves security running and does not retry the adapter', async () => {
  const f = mowerOptions({ pending: true });
  const client = new EufyClient({ security: cameraOptions().options, mowers: f.options });
  await client.security.connect();
  const abort = new AbortController();
  const connecting = assert.rejects(client.mowers.connect(undefined, abort.signal), {
    code: 'request_aborted',
  });
  await new Promise(setImmediate);
  abort.abort();
  await connecting;
  assert.equal(client.security.connected, true);
  assert.equal(f.calls.connect, 1);
  await client.shutdown();
});

test('one failed shutdown still closes the other module and never leaks adapter errors', async () => {
  const f = mowerOptions({ closeFails: true });
  const client = new EufyClient({ security: cameraOptions().options, mowers: f.options });
  await Promise.all([client.security.connect(), client.mowers.connect()]);
  const closing = client.shutdown();
  await assert.rejects(closing, { code: 'shutdown_incomplete' });
  assert.equal(client.shutdown(), closing);
  assert.equal(client.security.lifecycle, 'closed');
  assert.equal(client.mowers.lifecycle, 'closed');
  assert.equal(client.security.connected, false);
  assert.equal(f.calls.shutdown, 1);
});

test('separate bridge consumers own separate clients and persistent session stores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eufy-modules-'));
  try {
    const cameraPath = join(directory, 'camera.json');
    const mowerPath = join(directory, 'mower.json');
    const cameraStore = new FileSessionStore(cameraPath);
    const camera = cameraOptions({ store: cameraStore });
    await cameraStore.save(camera.session);
    const mowerStore = {
      load: async () => JSON.parse(await readFile(mowerPath, 'utf8')),
      save: async (session) => writeFile(mowerPath, JSON.stringify(session), { mode: 0o600 }),
    };
    await mowerStore.save({ version: 1, data: 'previous-mower-fixture' });
    const f = mowerOptions({ store: mowerStore });
    const cameraBridge = new EufyClient({ security: camera.options });
    const mowerBridge = new EufyClient({ mowers: f.options });
    await Promise.all([cameraBridge.security.connect(), mowerBridge.mowers.connect()]);
    assert.notEqual(cameraBridge, mowerBridge);
    assert.equal(cameraBridge.mowers, undefined);
    assert.equal(mowerBridge.security, undefined);
    assert.equal(f.calls.contexts[0].sessionStore, mowerStore);
    assert.notEqual(f.calls.contexts[0].sessionStore, cameraStore);
    assert.deepEqual(await cameraStore.load(), camera.session);
    assert.deepEqual(await mowerStore.load(), { version: 1, data: 'mower-session-fixture' });
    await cameraBridge.close();
    assert.equal(mowerBridge.mowers.connected, true);
    const restartedCamera = new EufyClient({ security: camera.options });
    await restartedCamera.security.connect();
    await mowerBridge.close();
    assert.equal(restartedCamera.security.connected, true);
    await restartedCamera.close();
    assert.deepEqual(await cameraStore.load(), camera.session);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('empty client is inert and shared module store identity is rejected', async () => {
  const empty = new EufyClient();
  assert.equal(empty.security, undefined);
  assert.equal(empty.mowers, undefined);
  await empty.close();
  const security = cameraOptions().options;
  const mowers = mowerOptions().options;
  mowers.sessionStore = security.sessionStore;
  assert.throws(() => new EufyClient({ security, mowers }), { code: 'shared_session_store' });
});

test('public TypeScript consumers retain imports and cannot access internal owners', () => {
  execFileSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2023',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'test/fixtures/modular-consumer.ts',
    ],
    { cwd: new URL('../', import.meta.url), stdio: 'pipe', timeout: 12000 },
  );
});
