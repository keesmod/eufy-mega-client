import { DeviceProperties, PropertyName } from './vendor/http/types.js';
import type { Device, WireDevice } from './types.js';

// Validate observed wire values before SDK coercion can turn malformed text into zero.
export function observedInteger(value: unknown, max: number): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
}

export function observedDeviceState(
  raw: WireDevice,
  read?: (key: number) => unknown,
): Pick<Device, 'battery' | 'availability'> {
  const properties = DeviceProperties[raw.device_type];
  const value = (name: PropertyName, max: number) => {
    const key = properties?.[name]?.key;
    if (typeof key !== 'number') return null;
    const params = Array.isArray(raw.params) ? raw.params : [];
    const observed = read ? read(key) : params.findLast((p) => p?.param_type === key)?.param_value;
    return observedInteger(observed, max);
  };
  const status = value(PropertyName.DeviceState, 5);
  return {
    battery: value(PropertyName.DeviceBattery, 100),
    availability:
      status === null ? null : status === 1 ? 'online' : status === 2 ? 'disabled' : 'offline',
  };
}
