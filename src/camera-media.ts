import type { WireDevice } from './types.js';
import {
  exactDeviceProfile,
  h3MediaOwner,
  modelProfile,
  type CameraMediaFeature,
} from './device-profiles.js';

export function hasCameraMedia(
  camera: WireDevice | undefined,
  owner?: WireDevice,
  feature: CameraMediaFeature = 'live',
): boolean {
  if (!camera) return false;
  const profile = modelProfile(camera.device_model);
  const admission = profile?.features[feature];
  if (admission === 'established') return true;
  if (
    admission !== 'h3' ||
    profile?.type !== camera.device_type ||
    owner?.device_model !== h3MediaOwner.model ||
    exactDeviceProfile(owner)?.kind !== 'station' ||
    owner.device_sn !== camera.parent_sn ||
    !owner.device_sn.startsWith(h3MediaOwner.model)
  )
    return false;
  const version = owner.main_sw_version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  const minimum = h3MediaOwner.minimumFirmware;
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] !== minimum[i]) return parts[i]! > minimum[i]!;
  }
  return true;
}
