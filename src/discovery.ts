import { exactDeviceProfile, modelProfile } from './device-profiles.js';
import { observedDeviceState } from './device-state.js';
import {
  EufyError,
  type Device,
  type DiscoveryIssue,
  type DiscoveryResult,
  type DeviceRelationship,
  type WireDevice,
} from './types.js';

// Family selection stays exact even when upstream predicates cover other families.
export const isSoloCamera = (raw: WireDevice): boolean =>
  exactDeviceProfile(raw)?.family === 'solo';
export const isIndoorCamera = (raw: WireDevice): boolean =>
  exactDeviceProfile(raw)?.family === 'indoor';
export const isFloodlightCamera = (raw: WireDevice): boolean =>
  exactDeviceProfile(raw)?.family === 'floodlight';
// Called on admitted inventory. Preserve the established model-only helper behavior.
export const isStation = (raw: WireDevice): boolean =>
  modelProfile(raw.device_model)?.kind === 'station';
export const isIntegratedCamera = (raw: WireDevice): boolean =>
  exactDeviceProfile(raw)?.family === 'integrated';
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
  const diagnosticVersion = (value: unknown): string | undefined =>
    typeof value === 'string' &&
    value.length <= 19 &&
    !/[^0-9.]/.test(value) &&
    /^[0-9]{1,4}(?:\.[0-9]{1,4}){0,3}$/.test(value)
      ? value
      : undefined;
  const context = (item: Record<string, unknown>): DiscoveryIssue['context'] => {
    const parent = item.parent_sn;
    const valid =
      typeof parent === 'string' && parent.length <= 64 && !/[^A-Za-z0-9_-]/.test(parent);
    const matches =
      valid && parent !== ''
        ? items.filter(
            (row) =>
              row &&
              typeof row === 'object' &&
              !Array.isArray(row) &&
              row.category === 'eufy_security' &&
              row.device_sn === parent,
          )
        : [];
    const parentStatus = !valid
      ? 'invalid'
      : parent === ''
        ? 'none'
        : parent === item.device_sn
          ? 'self'
          : matches.length > 1
            ? 'ambiguous'
            : matches.length === 1
              ? 'present'
              : 'missing';
    const owner = parentStatus === 'present' ? matches[0] : undefined;
    const parentModel = owner?.device_model;
    return {
      ...(diagnosticVersion(item.main_sw_version)
        ? { firmware: diagnosticVersion(item.main_sw_version) }
        : {}),
      ...(diagnosticVersion(item.main_hw_version)
        ? { hardware: diagnosticVersion(item.main_hw_version) }
        : {}),
      parentStatus,
      ...(owner ? { parentId: parent as string } : {}),
      ...(typeof parentModel === 'string' &&
      parentModel.length === 5 &&
      /^T[A-Z0-9]{4}$/.test(parentModel)
        ? { parentModel }
        : {}),
      ...(diagnosticVersion(owner?.main_sw_version)
        ? { parentFirmware: diagnosticVersion(owner.main_sw_version) }
        : {}),
    };
  };
  const reject = (index: number, deviceId: string | null, code: DiscoveryIssue['code']) =>
    issues.push({
      index,
      deviceId,
      code,
      ...(items[index] &&
      typeof items[index] === 'object' &&
      !Array.isArray(items[index]) &&
      items[index].category === 'eufy_security'
        ? { context: context(items[index]) }
        : {}),
    });
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
    const profile = modelProfile(item.device_model);
    if (!profile || profile.type !== item.device_type) {
      // These bounds restrict diagnostics only, never recognition. Do not trim,
      // truncate or coerce values: a serial prefix is not a received model code.
      issues.push({
        index,
        deviceId: item.device_sn,
        code: 'unsupported_device',
        context: context(item),
        ...(typeof item.device_model === 'string' &&
        item.device_model.length === 5 &&
        /^T[A-Z0-9]{4}$/.test(item.device_model)
          ? { deviceModel: item.device_model }
          : {}),
        ...(Number.isInteger(item.device_type) && item.device_type >= 0 && item.device_type <= 65535
          ? { deviceType: item.device_type }
          : {}),
      });
      return;
    }
    raw.set(item.device_sn, item as WireDevice);
  });
  const owners = new Map<string, ConnectionOwner>();
  const relationships = new Map<string, DeviceRelationship>();
  for (const [id, device] of raw) {
    const profile = modelProfile(device.device_model)!;
    if (profile.kind === 'station') {
      if (device.parent_sn && device.parent_sn !== id) {
        relationships.set(id, { kind: 'unsupported', reason: 'invalid_device_relationship' });
      } else {
        owners.set(id, { id, kind: 'station', transport: 'h3-lan' });
        relationships.set(id, { kind: 'station', ownerId: id });
      }
    } else if (device.parent_sn === '' || device.parent_sn === id) {
      if (profile.topology === 'standalone' || profile.topology === 'h3-or-standalone') {
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
    const owner = owners.get(device.parent_sn);
    relationships.set(
      id,
      modelProfile(device.device_model)?.topology !== 'standalone' &&
        owner?.kind === 'station' &&
        owner.transport === 'h3-lan'
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
      kind: modelProfile(device.device_model)!.kind,
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
