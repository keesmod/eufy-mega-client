import test from 'node:test';
import assert from 'node:assert/strict';
import { EufyMegaClient } from '../dist/index.js';
import { cloudFixture } from './fixtures/mega-cloud.mjs';
import { families, inventory } from './fixtures/families.mjs';
import { mediaFixture } from './fixtures/media.mjs';

const privateMarkers = [
  'PRIVATE_SERIAL',
  'PRIVATE_KEY',
  'PRIVATE_RECORDING',
  'PRIVATE_PAYLOAD',
  'PRIVATE_PERSON',
  'PRIVATE_TOKEN',
];
function assertClean(value) {
  const text = JSON.stringify(value);
  for (const marker of privateMarkers) assert.equal(text.includes(marker), false, marker);
}
for (const p of families) {
  test(`${p.id}: cloud diagnostics retain discovery/failure evidence and exclude private fields`, async () => {
    const { rows } = inventory(p);
    const f = cloudFixture({
      inventory: rows.map((row) => ({
        ...row,
        local_key: privateMarkers[1],
        recording: privateMarkers[2],
        payload: privateMarkers[3],
      })),
    });
    let failInventory = false;
    const client = new EufyMegaClient({
      ...f.options,
      fetch: (url, init) => {
        if (failInventory && new URL(url).pathname === '/app/house/get_devs_list') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                code: 503,
                device_sn: privateMarkers[0],
                key: privateMarkers[1],
                recording: privateMarkers[2],
                payload: privateMarkers[3],
                person_name: privateMarkers[4],
                token: privateMarkers[5],
              }),
              { status: 503 },
            ),
          );
        }
        return f.options.fetch(url, init);
      },
    });
    try {
      await client.connect();
      await client.listDevices();
      const success = f.diagnostics.at(-1);
      assert.equal(success.path, '/app/house/get_devs_list');
      assert.equal(success.status, 200);
      assert.equal(success.code, 0);
      failInventory = true;
      let failure;
      await assert.rejects(client.listDevices(), (error) => {
        failure = error;
        return error.code === 'http_error';
      });
      assert.equal(failure.message, 'http_error (503)');
      const diagnostic = f.diagnostics.at(-1);
      assert.equal(diagnostic.path, success.path);
      assert.equal(diagnostic.status, 503);
      assert.equal(diagnostic.code, 503);
      for (const event of f.diagnostics) {
        assert.deepEqual(Object.keys(event).sort(), [
          'code',
          'elapsedMs',
          'host',
          'operation',
          'path',
          'status',
        ]);
        assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0);
      }
      assertClean({ diagnostics: f.diagnostics, code: failure.code, message: failure.message });
      const serialized = JSON.stringify(f.diagnostics);
      for (const row of rows)
        if (row.device_sn) assert.equal(serialized.includes(row.device_sn), false);
      assert.equal(serialized.includes('secret-auth-token'), false);
    } finally {
      await client.close();
    }
  });
}
test('media connection faults expose only the library failure, never vendor context', async () => {
  const f = await mediaFixture(families[0]),
    faults = [];
  f.transport.on('fault', (error) => faults.push(error));
  try {
    f.station.emit(
      'connection error',
      f.station,
      Object.assign(new Error(privateMarkers.join(' ')), {
        context: { device: privateMarkers[0], key: privateMarkers[1] },
      }),
    );
    assert.equal(faults.length, 1);
    assert.equal(faults[0].code, 'device_connection_failed');
    assert.equal(faults[0].message, 'device_connection_failed');
    assertClean(faults);
    assertClean(faults[0].stack);
  } finally {
    await f.close();
  }
});
