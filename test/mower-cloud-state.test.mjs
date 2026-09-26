// Synthetic cloud records exercise the authenticated read boundary. Status payloads are built
// from the independently documented DP 107 field numbers, never copied from device captures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { EufyClient, EufyError, decodeMowerTelemetry } from '../dist/index.js';
import { cloud, credentials, memory } from './fixtures/mower-cloud.mjs';
import { deviceId, localKey } from './fixtures/local-mower.mjs';
import { e15Schema } from './fixtures/e15-telemetry.mjs';

const json = (data) => new Response(JSON.stringify(data));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
// These synthetic records use small field numbers and values, each a one-byte varint.
const status = (fields) =>
  b64(Object.entries(fields).flatMap(([field, value]) => [Number(field) * 8, value]));
const parameters = b64([6 * 8 + 2, 2, 1 * 8, 2]); // Blade speed wrapper with enum high.

async function connected(t, { dps, schema = e15Schema, later, timeout = 1000 } = {}) {
  const base = cloud({ dps, schema });
  const calls = [];
  let discovered = false;
  const client = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      home: {
        requestTimeoutMs: timeout,
        fetch: async (url, init) => {
          const parsed = new URL(url);
          const action = parsed.searchParams.get('a') ?? parsed.pathname;
          calls.push({
            action,
            version: parsed.searchParams.get('v'),
            body: init.body?.get?.('postData'),
          });
          if (discovered && later && action === 'tuya.m.device.get') return later(init);
          return base(url, init);
        },
      },
    },
  });
  t.after(() => client.shutdown());
  await client.mowers.connect();
  const [mower] = await client.mowers.discover();
  discovered = true;
  return { client, mowers: client.mowers, id: mower.id, calls };
}

function noSecrets(value) {
  const text = inspect(value, { depth: null });
  for (const secret of [deviceId, localKey, 'PRIVATE-']) assert.ok(!text.includes(secret), text);
}

test('one authenticated record supplies activity and work parameters with a shared receipt time', async (t) => {
  let activity = status({ 1: 17, 3: 1 });
  const { mowers, id, calls } = await connected(t, {
    // Discovery's older cache is not substituted for a later read.
    dps: { 107: 'AA==' },
    later: () =>
      json({
        result: {
          devId: deviceId,
          localKey,
          dps: {
            1: true,
            8: 87,
            107: activity,
            155: parameters,
            156: 'PRIVATE-OTHER-POINT',
          },
        },
      }),
  });
  const before = Date.now();
  const reading = await mowers.queryCloudState(id);
  const after = Date.now();
  assert.deepEqual(reading, {
    source: 'cloud',
    observedAt: reading.observedAt,
    status: { state: 'reported', value: 'mowing' },
    workParameters: {
      source: 'cloud',
      observedAt: reading.observedAt,
      state: 'reported',
      parameters: { bladeSpeed: 'high' },
      undecodedFields: [],
    },
  });
  assert.ok(Date.parse(reading.observedAt) >= before && Date.parse(reading.observedAt) <= after);
  assert.equal(new Date(reading.observedAt).toISOString(), reading.observedAt);
  assert.equal(calls.filter(({ action }) => action === 'tuya.m.device.get').length, 2);
  assert.deepEqual(calls.at(-1), {
    action: 'tuya.m.device.get',
    version: '1.0',
    body: JSON.stringify({ devId: deviceId }),
  });
  assert.equal(mowers.commandsEnabled, false);
  assert.equal(mowers.settingsEnabled, false);
  noSecrets(reading);

  activity = status({ 4: 2 });
  const next = await mowers.queryCloudState(id);
  assert.deepEqual(next.status, { state: 'reported', value: 'idle' });
  assert.equal(calls.filter(({ action }) => action === 'tuya.m.device.get').length, 3);
  reading.workParameters.parameters.bladeSpeed = 'low';
  assert.equal(next.workParameters.parameters.bladeSpeed, 'high');
  // The old public reading still makes one request and preserves its return contract.
  const previousAPI = await mowers.queryWorkParameters(id);
  assert.deepEqual(previousAPI, { ...next.workParameters, observedAt: previousAPI.observedAt });
  assert.equal(calls.filter(({ action }) => action === 'tuya.m.device.get').length, 4);
});

test('cloud status uses the same confirmed DP 107 meanings as local telemetry', async (t) => {
  for (const [value, expected] of [
    ['', 'idle'],
    ['AA==', 'idle'],
    [status({ 4: 2 }), 'idle'],
    [status({ 6: 1 }), 'idle'],
    [status({ 1: 2, 3: 1 }), 'mowing'],
    [status({ 1: 17, 2: 3, 3: 1 }), 'mowing'],
    [status({ 1: 17, 3: 2 }), 'paused'],
    [status({ 1: 1, 3: 1 }), 'returning'],
  ]) {
    const { mowers, id } = await connected(t, { dps: { 107: value } });
    const reading = await mowers.queryCloudState(id);
    assert.deepEqual(reading.status, { state: 'reported', value: expected });
    assert.equal(reading.workParameters.state, 'missing');
    const local = decodeMowerTelemetry({
      source: 'local-tuya-3.5',
      observedAt: reading.observedAt,
      dps: { 107: value },
    });
    assert.equal(local.status.value, expected);
    assert.equal(local.status.source, 'local-tuya-3.5');
    assert.equal(reading.source, 'cloud');
  }
});

test('missing, malformed and unclaimed activity stays distinct and independent of DP 155', async (t) => {
  for (const [dps, expected] of [
    [undefined, 'missing'],
    [{}, 'missing'],
    [{ 1: true, 2: false, 118: 100 }, 'missing'],
    [{ 107: null }, 'invalid'],
    [{ 107: 1 }, 'invalid'],
    [{ 107: {} }, 'invalid'],
    [{ 107: 'not-base64' }, 'invalid'],
    [{ 107: b64([8]) }, 'invalid'],
    [{ 107: status({ 2: 5, 3: 1 }) }, 'invalid'],
    [{ 107: status({ 1: 17 }) }, 'invalid'],
    [{ 107: status({ 1: 1, 3: 2 }) }, 'invalid'],
    [{ 107: status({ 1: 99, 3: 1 }) }, 'invalid'],
  ]) {
    const { mowers, id } = await connected(t, { dps: { ...dps, 155: parameters } });
    const reading = await mowers.queryCloudState(id);
    assert.deepEqual(reading.status, { state: expected }, inspect(dps));
    assert.equal(reading.workParameters.state, 'reported');
  }
  for (const value of [null, 1, 'not-base64']) {
    const { mowers, id } = await connected(t, { dps: { 107: 'AA==', 155: value } });
    const reading = await mowers.queryCloudState(id);
    assert.deepEqual(reading.status, { state: 'reported', value: 'idle' });
    assert.equal(reading.workParameters.state, 'invalid');
  }
  const declared = await connected(t, {
    schema: [
      {
        id: 107,
        code: 'synthetic_wrong_type',
        mode: 'ro',
        type: 'obj',
        property: { type: 'bool' },
      },
    ],
    dps: { 107: 'AA==' },
  });
  assert.deepEqual((await declared.mowers.queryCloudState(declared.id)).status, {
    state: 'invalid',
  });
});

test('cloud reads require authentication, the current device binding and a capable adapter', async (t) => {
  const client = new EufyClient({
    mowers: { credentials, sessionStore: memory(), home: { fetch: cloud() } },
  });
  t.after(() => client.shutdown());
  await assert.rejects(client.mowers.queryCloudState('unknown'), {
    code: 'authentication_required',
  });
  await client.mowers.connect();
  await assert.rejects(client.mowers.queryCloudState('unknown'), {
    code: 'mower_binding_unavailable',
  });
  const { mowers, id, calls } = await connected(t);
  const before = calls.length;
  for (const invalid of ['unknown', 42, undefined, { id }])
    await assert.rejects(mowers.queryCloudState(invalid), { code: 'mower_binding_unavailable' });
  assert.equal(calls.length, before);

  const custom = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      adapter: () => ({
        connected: true,
        connect: async () => ({ state: 'connected' }),
        shutdown: async () => {},
      }),
    },
  });
  t.after(() => custom.shutdown());
  await custom.mowers.connect();
  await assert.rejects(custom.mowers.queryCloudState('unknown'), {
    code: 'mower_protocol_unavailable',
  });
  await custom.shutdown();
  await assert.rejects(custom.mowers.queryCloudState('unknown'), { code: 'client_closed' });
});

test('foreign records, expired sessions and upstream errors cannot return a reading or leak data', async (t) => {
  for (const [later, code] of [
    [
      () => json({ result: { devId: 'SYNTHETIC-OTHER', localKey, dps: { 107: 'AA==' } } }),
      'mower_binding_unavailable',
    ],
    [() => json({ result: 'PRIVATE-BODY' }), 'mower_invalid_response'],
    [
      () => json({ success: false, errorCode: 'PRIVATE-CODE', errorMsg: 'PRIVATE-MESSAGE' }),
      'mower_request_failed',
    ],
    [() => new Response('PRIVATE-BODY', { status: 500 }), 'mower_request_failed'],
    [
      () => {
        throw Error('PRIVATE-FETCH');
      },
      'mower_request_failed',
    ],
    [() => json({ success: false, errorCode: 'USER_SESSION_EXPIRED' }), 'authentication_required'],
  ]) {
    const { mowers, id, calls } = await connected(t, { later });
    await assert.rejects(mowers.queryCloudState(id), (error) => {
      noSecrets(error);
      return error instanceof EufyError && error.code === code;
    });
    assert.equal(calls.filter(({ action }) => action === 'tuya.m.device.get').length, 2);
    assert.equal(calls.filter(({ action }) => action === '/v1/user/email/login').length, 1);
    if (code === 'authentication_required') {
      assert.equal(mowers.connected, false);
      await assert.rejects(mowers.queryCloudState(id), { code });
    }
  }
});

for (const method of ['queryCloudState', 'queryWorkParameters']) {
  for (const status of [401, 403]) {
    test(`${method} preserves authentication_required for HTTP ${status}`, async (t) => {
      const { mowers, id, calls } = await connected(t, {
        later: () => new Response('PRIVATE-AUTH-RESPONSE', { status }),
      });
      await assert.rejects(mowers[method](id), (error) => {
        noSecrets(error);
        return error instanceof EufyError && error.code === 'authentication_required';
      });
      assert.equal(mowers.connected, false);
      const count = calls.length;
      await assert.rejects(mowers[method](id), { code: 'authentication_required' });
      assert.equal(calls.length, count);
      assert.equal(calls.filter(({ action }) => action === 'tuya.m.device.get').length, 2);
      assert.equal(calls.filter(({ action }) => action === '/v1/user/email/login').length, 1);
    });
  }
}

test('caller abort still wins over a late HTTP authentication response', async (t) => {
  for (const method of ['queryCloudState', 'queryWorkParameters']) {
    let entered;
    let release;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const { mowers, id } = await connected(t, {
      later: () =>
        new Promise((resolve) => {
          release = resolve;
          entered();
        }),
    });
    const controller = new AbortController();
    const pending = assert.rejects(mowers[method](id, controller.signal), {
      code: 'request_aborted',
    });
    await ready;
    controller.abort('PRIVATE-REASON');
    release(new Response('PRIVATE-AUTH-RESPONSE', { status: 401 }));
    await pending;
    assert.equal(mowers.connected, true);
  }
});

test('session expiry during a response cannot return newly timestamped cloud data', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const { mowers, id } = await connected(t, {
    later: () => {
      now += 3_600_001;
      return json({ result: { devId: deviceId, dps: { 107: 'AA==', 155: parameters } } });
    },
  });
  await assert.rejects(mowers.queryCloudState(id), { code: 'authentication_required' });
  assert.equal(mowers.connected, false);
});

test('abort, rediscovery, timeout and shutdown end a pending read without a late result', async (t) => {
  const initial = await connected(t);
  const before = initial.calls.length;
  await assert.rejects(
    initial.mowers.queryCloudState(initial.id, AbortSignal.abort('PRIVATE-REASON')),
    {
      code: 'request_aborted',
    },
  );
  assert.equal(initial.calls.length, before);
  for (const mode of ['abort', 'rediscover', 'timeout', 'shutdown']) {
    let entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    let first = true;
    const { client, mowers, id } = await connected(t, {
      timeout: mode === 'timeout' ? 25 : 1000,
      later: (init) => {
        if (!first) return json({ result: { devId: deviceId, localKey, dps: { 107: 'AA==' } } });
        first = false;
        return new Promise((_, reject) => {
          entered();
          init.signal.addEventListener('abort', () => reject(Error('PRIVATE-ABORT')), {
            once: true,
          });
        });
      },
    });
    const controller = new AbortController();
    // AbortSignal.timeout is unref'd. This test owns a short keep-alive until it has settled.
    const keepAlive = setTimeout(() => {}, 2000);
    try {
      const pending = assert.rejects(mowers.queryCloudState(id, controller.signal), (error) => {
        noSecrets(error);
        return error.code === (mode === 'timeout' ? 'request_timeout' : 'request_aborted');
      });
      await ready;
      if (mode === 'abort') controller.abort('PRIVATE-REASON');
      if (mode === 'rediscover') await mowers.discover();
      if (mode === 'shutdown') await client.shutdown();
      await pending;
    } finally {
      clearTimeout(keepAlive);
    }
  }
});

test('the module rejects malformed adapter answers before exposing cloud state', async (t) => {
  let answer;
  const client = new EufyClient({
    mowers: {
      credentials,
      sessionStore: memory(),
      adapter: () => ({
        connected: true,
        connect: async () => ({ state: 'connected' }),
        shutdown: async () => {},
        readCloudState: async () => answer,
      }),
    },
  });
  t.after(() => client.shutdown());
  await client.mowers.connect();
  for (answer of [undefined, {}, { observedAt: 'PRIVATE-NOT-A-TIME', statusValue: 'AA==' }])
    await assert.rejects(client.mowers.queryCloudState('fixture'), (error) => {
      noSecrets(error);
      return error.code === 'mower_invalid_response';
    });
});
