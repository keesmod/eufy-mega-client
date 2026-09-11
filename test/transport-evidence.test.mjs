import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { inspectTransportInventory } from '../scripts/inspect-camera-transport.mjs';

const row = (model = 'T8134', type = 63) => ({
  category: 'eufy_security',
  device_model: model,
  device_type: type,
  device_sn: 'PRIVATE_SERIAL',
  parent_sn: '',
  device_channel: 0,
  p2p_did: 'PRIVATE_DID',
  p2p_license: 'PRIVATE_LICENSE',
  member: { admin_user_id: 'PRIVATE_USER' },
  main_sw_version: 'PRIVATE_FIRMWARE',
  device_name: 'PRIVATE_ALIAS',
  ip_addr: '192.168.1.123',
  extra: 'PRIVATE_EXTRA',
});

test('complete candidate credentials never establish authentication or disclose values', () => {
  const result = inspectTransportInventory([row()]);
  assert.equal(result.devices[0].relationship, 'self');
  assert.equal(result.devices[0].didPresent, true);
  assert.equal(result.devices[0].adminUserPresent, true);
  assert.equal(result.devices[0].transportAcceptance, 'not-established');
  assert.equal(/PRIVATE|192\.168/.test(JSON.stringify(result)), false);
});

test('owner variants remain separate, and parent rows are observations rather than ownership proof', () => {
  const result = inspectTransportInventory([
    row('T8001', 0),
    { ...row('T8002', 0), device_sn: 'E' },
    { ...row('T8010', 0), device_sn: 'HB2' },
    { ...row('T8023', 25), device_sn: 'CHIME' },
    { ...row('T8025', 28), device_sn: 'MINI' },
    { ...row(), device_sn: 'CAM', parent_sn: 'MINI' },
  ]);
  assert.deepEqual(
    result.devices.map((d) => d.profile),
    [
      'older-homebase',
      'older-homebase',
      'older-homebase',
      'minibase-chime',
      'homebase-mini',
      'standalone-solocam',
    ],
  );
  assert.equal(result.devices[5].parentRow, 4);
  assert.equal(result.devices[5].transportAcceptance, 'not-established');
});

test('malformed identities, duplicate owners and wrong model/type pairs cannot become proof', () => {
  const result = inspectTransportInventory([
    row(),
    { ...row(), category: 'other' },
    { ...row('T8203', 5), device_sn: 'WIRED', parent_sn: 'PRIVATE_SERIAL' },
    { ...row('T8453', 131), device_sn: 'GARAGE', parent_sn: null },
    { ...row('T8025', 28), device_sn: 'MINI', member: null, device_channel: '0' },
    { ...row(), device_model: 'PRIVATE_UNKNOWN_MODEL' },
  ]);
  assert.equal(result.devices[0].validIdentity, false);
  assert.equal(result.devices[1].relationship, 'missing-parent');
  assert.equal(result.devices[1].typeMatches, false);
  assert.equal(result.devices[2].relationship, 'invalid');
  assert.equal(result.devices[2].typeMatches, false);
  assert.equal(result.devices[3].adminUserPresent, false);
  assert.equal(result.devices[3].channelPresent, false);
  assert.equal(result.candidateRows, 4);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  for (const value of [null, {}, Array(100).fill(row())])
    assert.throws(() => inspectTransportInventory(value));
});

test('CLI inspects a local array and sanitizes parse and file failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'transport-evidence-'));
  const file = join(directory, 'private.json');
  const run = () =>
    spawnSync(process.execPath, ['scripts/inspect-camera-transport.mjs', file], {
      encoding: 'utf8',
    });
  try {
    await writeFile(file, JSON.stringify([row()]));
    let result = run();
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).candidateRows, 1);
    await writeFile(file, '{"PRIVATE_PARSE_DATA":');
    result = run();
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes('PRIVATE'), false);
    await writeFile(file, 'x'.repeat(2 * 1024 * 1024 + 1));
    assert.equal(run().status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'CLI rejects a named pipe without waiting for a writer',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'transport-fifo-'));
    const file = join(directory, 'PRIVATE_PIPE');
    try {
      const created = spawnSync('mkfifo', [file]);
      assert.equal(created.status, 0);
      const result = spawnSync(process.execPath, ['scripts/inspect-camera-transport.mjs', file], {
        encoding: 'utf8',
        timeout: 2000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(
        result.stderr,
        'Transport evidence inspection failed. Supply a complete JSON device array in a regular file, at most 2 MiB.\n',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
