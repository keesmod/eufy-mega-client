import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Research candidates, deliberately separate from the runtime admission registry.
const candidates = new Map([
  ['T8134', [63, 'standalone-solocam']],
  ['T8200', [5, 'standalone-wired']],
  ['T8201', [5, 'standalone-wired']],
  ['T8202', [5, 'standalone-wired']],
  ['T8203', [93, 'standalone-wired']],
  ['T8452', [132, 'standalone-garage']],
  ['T8453', [133, 'standalone-garage']],
  ['T8001', [0, 'older-homebase']],
  ['T8002', [0, 'older-homebase']],
  ['T8010', [0, 'older-homebase']],
  ['T8023', [25, 'minibase-chime']],
  ['T8025', [28, 'homebase-mini']],
]);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const present = (value) => typeof value === 'string' && value.length > 0;

/** Inspect private Mega rows without returning identifiers or credential values. */
export function inspectTransportInventory(rows) {
  if (!Array.isArray(rows) || rows.length >= 100)
    throw new Error('invalid_or_incomplete_inventory');
  const counts = new Map();
  for (const row of rows)
    if (record(row) && identity(row.device_sn))
      counts.set(row.device_sn, (counts.get(row.device_sn) ?? 0) + 1);
  const devices = [];
  rows.forEach((row, index) => {
    if (!record(row) || row.category !== 'eufy_security') return;
    const candidate = candidates.get(row.device_model);
    if (!candidate) return;
    const validIdentity = identity(row.device_sn) && counts.get(row.device_sn) === 1;
    const validParent = row.parent_sn === '' || identity(row.parent_sn);
    const typeMatches = candidate[0] === row.device_type;
    const self =
      validIdentity && validParent && (row.parent_sn === '' || row.parent_sn === row.device_sn);
    const parentIndex =
      validIdentity && validParent && !self
        ? rows.findIndex(
            (parent) =>
              record(parent) &&
              parent.category === 'eufy_security' &&
              parent.device_sn === row.parent_sn &&
              counts.get(parent.device_sn) === 1,
          )
        : -1;
    devices.push({
      row: index,
      model: row.device_model,
      expectedType: candidate[0],
      profile: candidate[1],
      typeMatches,
      validIdentity,
      relationship:
        !validIdentity || !validParent
          ? 'invalid'
          : self
            ? 'self'
            : parentIndex >= 0
              ? 'parent-row'
              : 'missing-parent',
      parentRow: parentIndex >= 0 ? parentIndex : null,
      firmwarePresent: present(row.main_sw_version),
      channelPresent: Number.isInteger(row.device_channel) && row.device_channel >= 0,
      didPresent: present(row.p2p_did),
      licensePresent: present(row.p2p_license),
      adminUserPresent: record(row.member) && present(row.member.admin_user_id),
      transportAcceptance: 'not-established',
    });
  });
  return {
    schemaVersion: 1,
    mode: 'offline-descriptor-only',
    inspectedRows: rows.length,
    candidateRows: devices.length,
    devices,
    remainingEvidence: [
      'descriptor-provenance',
      'command-owner',
      'authenticated-command-response',
      'media-route',
      'stop-cancel-acknowledgement',
    ],
  };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('input_required');
  // A FIFO must not wait for a writer before fstat rejects it.
  const file = await open(process.argv[2], constants.O_RDONLY | constants.O_NONBLOCK);
  let text;
  try {
    const limit = 2 * 1024 * 1024;
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('invalid_input');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('invalid_input');
    text = buffer.subarray(0, length).toString('utf8');
  } finally {
    await file.close();
  }
  process.stdout.write(`${JSON.stringify(inspectTransportInventory(JSON.parse(text)), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    // Parser and filesystem errors can include private input or paths.
    process.stderr.write(
      'Transport evidence inspection failed. Supply a complete JSON device array in a regular file, at most 2 MiB.\n',
    );
    process.exitCode = 1;
  });
