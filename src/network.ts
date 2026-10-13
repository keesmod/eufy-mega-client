import os from 'node:os';
import { isIP } from 'node:net';
import type { WireDevice } from './types.js';
/** Use only the documented LAN-IP parameter or an explicitly private device IP. */
export function lanAddress(device: WireDevice): string | undefined {
  const local = (value: unknown): value is string =>
    typeof value === 'string' &&
    isIP(value) === 4 &&
    (/^(10\.|192\.168\.)/.test(value) || /^172\.(1[6-9]|2\d|3[01])\./.test(value));
  // Discovery also reads unvalidated rows, so a malformed params value means no address.
  const parameter = Array.isArray(device.params)
    ? device.params.find(
        (p: unknown) => (p as { param_type?: unknown } | null)?.param_type === 1176,
      )?.param_value
    : undefined;
  if (local(parameter)) return parameter;
  return local(device.ip_addr) ? device.ip_addr : undefined;
}
const ipv4 = (value: unknown): number | undefined =>
  typeof value === 'string' && isIP(value) === 4
    ? value.split('.').reduce((result, part) => result * 256 + Number(part), 0)
    : undefined;
/**
 * Whether an IPv4 address lies inside the address and netmask of one of the
 * host's external IPv4 interfaces. Undefined when that cannot be determined.
 */
export function hostSubnetContains(address: string): boolean | undefined {
  try {
    const target = ipv4(address);
    if (target === undefined) return undefined;
    for (const details of Object.values(os.networkInterfaces()).flat()) {
      if (!details || details.family !== 'IPv4' || details.internal) continue;
      const own = ipv4(details.address);
      const mask = ipv4(details.netmask);
      if (own === undefined || mask === undefined) continue;
      if ((own & mask) === (target & mask)) return true;
    }
    return false;
  } catch {
    return undefined;
  }
}
