import type { CameraCapabilities, WireDevice } from './types.js';

export type CameraMediaFeature = keyof CameraCapabilities;
export type MediaAdmission = 'established' | 'h3' | 'blocked';
export type MediaPolicy = Readonly<Record<CameraMediaFeature, MediaAdmission>>;
export type CameraFamily =
  | 'eufycam'
  | 'solo'
  | 'indoor'
  | 'battery-doorbell'
  | 'wired-doorbell'
  | 'floodlight'
  | 'walllight'
  | 'garage'
  | 'integrated'
  | 'lte';
export type CameraTopology = 'h3' | 'h3-or-standalone' | 'standalone';
export interface DeviceProfile {
  readonly type: number;
  readonly kind: 'camera' | 'station';
  readonly family: CameraFamily | 'homebase';
  readonly topology: CameraTopology | 'owner';
  readonly features: MediaPolicy;
}

// Each feature is explicit. Shared policies avoid repeating identical admission rules.
const h3Media: MediaPolicy = Object.freeze({ snapshot: 'h3', live: 'h3', recordings: 'h3' });
const establishedMedia: MediaPolicy = Object.freeze({
  snapshot: 'established',
  live: 'established',
  recordings: 'established',
});
const blockedMedia: MediaPolicy = Object.freeze({
  snapshot: 'blocked',
  live: 'blocked',
  recordings: 'blocked',
});
const camera = (
  type: number,
  family: CameraFamily,
  topology: CameraTopology,
  features: MediaPolicy,
): DeviceProfile =>
  Object.freeze({ type, kind: 'camera', family, topology, features: Object.freeze(features) });

// Existing additional-H3 software boundary, not a measured minimum for every model.
export const h3MediaOwner = Object.freeze({
  model: 'T8030',
  minimumFirmware: Object.freeze([2, 0, 9, 7]),
});

// Exact existing discovery and media policy. No model-prefix or type-only admission.
// The original four established routes intentionally retain their model-only media
// check. Discovery still validates their exact pairs and actual connection owner.
export const deviceProfiles: Readonly<Record<string, DeviceProfile>> = Object.freeze({
  T8400: camera(30, 'indoor', 'h3-or-standalone', h3Media),
  T8410: camera(31, 'indoor', 'h3-or-standalone', h3Media),
  T8401: camera(34, 'indoor', 'h3-or-standalone', h3Media),
  T8411: camera(35, 'indoor', 'h3-or-standalone', h3Media),
  T8441: camera(45, 'indoor', 'h3-or-standalone', h3Media),
  T8442: camera(46, 'indoor', 'h3-or-standalone', h3Media),
  T8414: camera(100, 'indoor', 'h3-or-standalone', h3Media),
  T8416: camera(104, 'indoor', 'h3-or-standalone', h3Media),
  T8417: camera(105, 'indoor', 'h3-or-standalone', h3Media),
  T8030: Object.freeze({
    type: 18,
    kind: 'station',
    family: 'homebase',
    topology: 'owner',
    features: blockedMedia,
  }),
  T86P2: camera(111, 'lte', 'h3-or-standalone', h3Media),
  T8111: camera(1, 'eufycam', 'h3', h3Media),
  T8110: camera(10035, 'eufycam', 'h3-or-standalone', h3Media),
  T8112: camera(4, 'eufycam', 'h3', h3Media),
  T8113: camera(8, 'eufycam', 'h3', h3Media),
  T8114: camera(9, 'eufycam', 'h3', h3Media),
  T8140: camera(14, 'eufycam', 'h3', h3Media),
  T8161: camera(23, 'eufycam', 'h3', h3Media),
  T8600: camera(24, 'eufycam', 'h3', h3Media),
  T8162: camera(26, 'eufycam', 'h3', h3Media),
  T8144: camera(49, 'eufycam', 'h3', h3Media),
  T8172: camera(89, 'eufycam', 'h3', h3Media),
  T8160: camera(19, 'eufycam', 'h3', establishedMedia),
  T8200: camera(5, 'wired-doorbell', 'standalone', blockedMedia),
  T8201: camera(5, 'wired-doorbell', 'standalone', blockedMedia),
  T8202: camera(5, 'wired-doorbell', 'standalone', blockedMedia),
  T8203: camera(93, 'wired-doorbell', 'standalone', blockedMedia),
  T8213: camera(91, 'battery-doorbell', 'h3', establishedMedia),
  T8214: camera(94, 'battery-doorbell', 'h3', h3Media),
  T8224: camera(95, 'battery-doorbell', 'h3', h3Media),
  T8223: camera(96, 'battery-doorbell', 'h3', h3Media),
  T8142: camera(15, 'eufycam', 'h3', establishedMedia),
  T8130: camera(32, 'solo', 'h3-or-standalone', h3Media),
  T8131: camera(33, 'solo', 'h3-or-standalone', h3Media),
  T8170: camera(48, 'solo', 'h3-or-standalone', h3Media),
  T8122: camera(60, 'solo', 'h3-or-standalone', h3Media),
  T8123: camera(61, 'solo', 'h3-or-standalone', h3Media),
  T8124: camera(62, 'solo', 'h3-or-standalone', h3Media),
  T8134: camera(63, 'solo', 'h3-or-standalone', establishedMedia),
  T8B00: camera(64, 'solo', 'h3-or-standalone', h3Media),
  T8171: camera(88, 'solo', 'h3-or-standalone', h3Media),
  T8173: camera(98, 'solo', 'h3-or-standalone', h3Media),
  T8452: camera(132, 'garage', 'standalone', blockedMedia),
  T8453: camera(133, 'garage', 'standalone', blockedMedia),
  T84A1: camera(151, 'walllight', 'h3-or-standalone', blockedMedia),
  T81A0: camera(10005, 'walllight', 'h3-or-standalone', h3Media),
  T8425: camera(47, 'floodlight', 'h3-or-standalone', h3Media),
  T8426: camera(87, 'floodlight', 'h3-or-standalone', h3Media),
  T8530: camera(55, 'integrated', 'h3-or-standalone', h3Media),
  T8790: camera(90, 'integrated', 'h3-or-standalone', h3Media),
  T85V0: camera(203, 'integrated', 'h3-or-standalone', h3Media),
});

export function modelProfile(model: unknown): DeviceProfile | undefined {
  return typeof model === 'string' && Object.hasOwn(deviceProfiles, model)
    ? deviceProfiles[model]
    : undefined;
}

export function exactDeviceProfile(raw: WireDevice): DeviceProfile | undefined {
  const profile = modelProfile(raw.device_model);
  return profile?.type === raw.device_type ? profile : undefined;
}

// Software evidence only. Dated hardware observations stay in MODEL_MATRIX.md.
export const profileEvidence: Readonly<Record<DeviceProfile['family'], string>> = Object.freeze({
  homebase: 'DISCOVERY.md',
  eufycam: 'EUFYCAM.md',
  solo: 'SOLOCAM.md',
  indoor: 'INDOOR.md',
  'battery-doorbell': 'BATTERY_DOORBELLS.md',
  'wired-doorbell': 'WIRED_DOORBELLS.md',
  floodlight: 'FLOODLIGHT.md',
  walllight: 'WALLLIGHT.md',
  garage: 'GARAGE.md',
  integrated: 'INTEGRATED_CAMERAS.md',
  lte: 'LTE.md',
});
