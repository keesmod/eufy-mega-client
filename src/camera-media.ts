import type { WireDevice } from './types.js';

// Software command evidence: docs/EUFYCAM.md, docs/BATTERY_DOORBELLS.md, docs/SOLOCAM.md and docs/FLOODLIGHT.md.
// T81A0 ownership and command evidence: docs/WALLLIGHT.md.
// Discovery alone is not media evidence.
const additionalH3Media = new Map([
  ['T8111', 1],
  ['T8112', 4],
  ['T8113', 8],
  ['T8114', 9],
  ['T8140', 14],
  ['T8161', 23],
  ['T8600', 24],
  ['T8162', 26],
  ['T8144', 49],
  ['T8172', 89],
  ['T8214', 94],
  ['T8224', 95],
  ['T8223', 96],
  ['T8130', 32],
  ['T8131', 33],
  ['T8170', 48],
  ['T8122', 60],
  ['T8123', 61],
  ['T8124', 62],
  ['T8B00', 64],
  ['T8171', 88],
  ['T8173', 98],
  ['T81A0', 10005],
  ['T8425', 47],
  ['T8426', 87],
]);
export function hasCameraMedia(camera: WireDevice | undefined, owner?: WireDevice): boolean {
  if (!camera) return false;
  // Preserve the established routes and firmware behavior of the original four models.
  if (['T8160', 'T8142', 'T8134', 'T8213'].includes(camera.device_model)) return true;
  if (
    additionalH3Media.get(camera.device_model) !== camera.device_type ||
    owner?.device_model !== 'T8030' ||
    owner.device_type !== 18 ||
    owner.device_sn !== camera.parent_sn ||
    !owner.device_sn.startsWith('T8030')
  )
    return false;
  const version = owner.main_sw_version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  const minimum = [2, 0, 9, 7];
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] !== minimum[i]) return parts[i]! > minimum[i]!;
  }
  return true;
}
