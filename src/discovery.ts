import { observedDeviceState } from './device-state.js';
import {
  EufyError,
  type Device,
  type DiscoveryIssue,
  type DiscoveryResult,
  type DeviceRelationship,
  type WireDevice,
} from './types.js';

// Exact model/type pairs already evidenced by the client. Family stories extend this registry.
const profiles = new Map<
  string,
  {
    type: number;
    kind: Device['kind'];
    family?: 'solo' | 'indoor' | 'floodlight';
    standalone?: boolean;
  }
>([
  ['T8400', { type: 30, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8410', { type: 31, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8401', { type: 34, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8411', { type: 35, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8441', { type: 45, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8442', { type: 46, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8414', { type: 100, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8416', { type: 104, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8417', { type: 105, kind: 'camera', family: 'indoor', standalone: true }],
  ['T8030', { type: 18, kind: 'station' }],
  ['T8111', { type: 1, kind: 'camera' }],
  ['T8112', { type: 4, kind: 'camera' }],
  ['T8113', { type: 8, kind: 'camera' }],
  ['T8114', { type: 9, kind: 'camera' }],
  ['T8140', { type: 14, kind: 'camera' }],
  ['T8161', { type: 23, kind: 'camera' }],
  ['T8600', { type: 24, kind: 'camera' }],
  ['T8162', { type: 26, kind: 'camera' }],
  ['T8144', { type: 49, kind: 'camera' }],
  ['T8172', { type: 89, kind: 'camera' }],
  ['T8160', { type: 19, kind: 'camera' }],
  ['T8213', { type: 91, kind: 'camera' }],
  ['T8214', { type: 94, kind: 'camera' }],
  ['T8224', { type: 95, kind: 'camera' }],
  ['T8223', { type: 96, kind: 'camera' }],
  ['T8142', { type: 15, kind: 'camera' }],
  ['T8130', { type: 32, kind: 'camera', family: 'solo', standalone: true }],
  ['T8131', { type: 33, kind: 'camera', family: 'solo', standalone: true }],
  ['T8170', { type: 48, kind: 'camera', family: 'solo', standalone: true }],
  ['T8122', { type: 60, kind: 'camera', family: 'solo', standalone: true }],
  ['T8123', { type: 61, kind: 'camera', family: 'solo', standalone: true }],
  ['T8124', { type: 62, kind: 'camera', family: 'solo', standalone: true }],
  ['T8134', { type: 63, kind: 'camera', family: 'solo', standalone: true }],
  ['T8B00', { type: 64, kind: 'camera', family: 'solo', standalone: true }],
  ['T8171', { type: 88, kind: 'camera', family: 'solo', standalone: true }],
  ['T8173', { type: 98, kind: 'camera', family: 'solo', standalone: true }],
  ['T8452', { type: 132, kind: 'camera', standalone: true }],
  ['T8453', { type: 133, kind: 'camera', standalone: true }],
  ['T84A1', { type: 151, kind: 'camera', standalone: true }],
  ['T81A0', { type: 10005, kind: 'camera', standalone: true }],
  ['T8425', { type: 47, kind: 'camera', family: 'floodlight', standalone: true }],
  ['T8426', { type: 87, kind: 'camera', family: 'floodlight', standalone: true }],
]);
// The upstream family predicate also includes eufyCam S4 and LTE models.
// Keep adapter selection tied to the exact family recorded in our catalogue.
export const isSoloCamera = (raw: WireDevice): boolean => {
  const profile = profiles.get(raw.device_model);
  return profile?.family === 'solo' && profile.type === raw.device_type;
};
export const isIndoorCamera = (raw: WireDevice): boolean => {
  const profile = profiles.get(raw.device_model);
  return profile?.family === 'indoor' && profile.type === raw.device_type;
};
// Storage-only Floodlight variants are deliberately outside this command-owner profile.
export const isFloodlightCamera = (raw: WireDevice): boolean => {
  const profile = profiles.get(raw.device_model);
  return profile?.family === 'floodlight' && profile.type === raw.device_type;
};
export const isStation = (raw: WireDevice): boolean =>
  profiles.get(raw.device_model)?.kind === 'station';
export interface ConnectionOwner {
  kind: 'station' | 'standalone';
  id: string;
  transport: 'h3-lan' | 'unsupported';
}
export interface Inventory {
  result: DiscoveryResult;
  raw: Map<string, WireDevice>;
  owners: Map<string, ConnectionOwner>;
  relationships: Map<string, DeviceRelationship>;
}
const identity = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export function discover(items: unknown): Inventory {
  if (!Array.isArray(items)) throw new EufyError('invalid_inventory');
  if (items.length >= 100) throw new EufyError('inventory_completeness_unconfirmed');
  const raw = new Map<string, WireDevice>();
  const issues: DiscoveryIssue[] = [];
  const identities = new Map<string, number>();
  for (const item of items) {
    if (item && typeof item === 'object' && identity(item.device_sn))
      identities.set(item.device_sn, (identities.get(item.device_sn) ?? 0) + 1);
  }
  const reject = (index: number, deviceId: string | null, code: DiscoveryIssue['code']) =>
    issues.push({ index, deviceId, code });
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      reject(index, null, 'invalid_device_identity');
      return;
    }
    if (item.category !== 'eufy_security') return;
    if (!identity(item.device_sn) || identities.get(item.device_sn)! > 1) {
      reject(index, identity(item.device_sn) ? item.device_sn : null, 'invalid_device_identity');
      return;
    }
    if (
      typeof item.parent_sn !== 'string' ||
      (item.parent_sn !== '' && !identity(item.parent_sn)) ||
      !Number.isInteger(item.device_type)
    ) {
      reject(index, item.device_sn, 'invalid_device_relationship');
      return;
    }
    const profile = profiles.get(item.device_model);
    if (!profile || profile.type !== item.device_type) {
      reject(index, item.device_sn, 'unsupported_device');
      return;
    }
    raw.set(item.device_sn, item as WireDevice);
  });
  const owners = new Map<string, ConnectionOwner>();
  const relationships = new Map<string, DeviceRelationship>();
  for (const [id, device] of raw) {
    const profile = profiles.get(device.device_model)!;
    if (profile.kind === 'station') {
      if (device.parent_sn && device.parent_sn !== id) {
        relationships.set(id, { kind: 'unsupported', reason: 'invalid_device_relationship' });
      } else {
        owners.set(id, { id, kind: 'station', transport: 'h3-lan' });
        relationships.set(id, { kind: 'station', ownerId: id });
      }
    } else if (device.parent_sn === '' || device.parent_sn === id) {
      if (profile.standalone) {
        owners.set(id, { id, kind: 'standalone', transport: 'unsupported' });
        relationships.set(id, {
          kind: 'standalone',
          ownerId: id,
          reason: 'standalone_transport_unverified',
        });
      } else relationships.set(id, { kind: 'unsupported', reason: 'invalid_device_relationship' });
    }
  }
  for (const [id, device] of raw) {
    if (relationships.has(id)) continue;
    // Garage H3 compatibility is under evaluation, not an evidenced command owner.
    const owner = owners.get(device.parent_sn);
    relationships.set(
      id,
      owner?.kind === 'station' && !['T8452', 'T8453'].includes(device.device_model)
        ? { kind: 'station', ownerId: owner.id }
        : { kind: 'unsupported', reason: 'unsupported_station' },
    );
  }
  const devices: Device[] = [];
  for (const [id, device] of raw) {
    const relationship = relationships.get(id)!;
    if ('reason' in relationship) reject(items.indexOf(device), id, relationship.reason);
    devices.push({
      id,
      stationId: device.parent_sn || id,
      kind: profiles.get(device.device_model)!.kind,
      model: device.device_model,
      name:
        typeof device.device_alias_name === 'string'
          ? device.device_alias_name
          : typeof device.device_name === 'string'
            ? device.device_name
            : '',
      firmware:
        typeof device.main_sw_version === 'string' && device.main_sw_version
          ? device.main_sw_version
          : null,
      hardware: typeof device.main_hw_version === 'string' ? device.main_hw_version : null,
      ...observedDeviceState(device),
    });
  }
  return {
    result: {
      devices,
      relationships: [...relationships].map(([deviceId, relationship]) => ({
        deviceId,
        ...relationship,
      })),
      issues: issues.sort((a, b) => a.index - b.index),
    },
    raw,
    owners,
    relationships,
  };
}
