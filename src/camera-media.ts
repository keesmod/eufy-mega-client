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
  return admission === 'h3' && admittedH3Owner(camera, owner);
}

/** ha-eufy-cam#229: an exact preset profile under the same HomeBase 3 owner admission. */
export function hasCameraPresets(camera: WireDevice | undefined, owner?: WireDevice): boolean {
  return (
    camera !== undefined &&
    exactDeviceProfile(camera)?.presets === true &&
    admittedH3Owner(camera, owner)
  );
}

/** The exact camera under its actual T8030 parent with admitted owner firmware. */
function admittedH3Owner(camera: WireDevice, owner?: WireDevice): boolean {
  if (
    !exactDeviceProfile(camera) ||
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
