import { isIP } from 'node:net';
import type { WireDevice } from './types.js';
/** Use only the documented LAN-IP parameter or an explicitly private device IP. */
export function lanAddress(device: WireDevice): string | undefined {
  const local = (value: unknown): value is string =>
    typeof value === 'string' &&
    isIP(value) === 4 &&
    (/^(10\.|192\.168\.)/.test(value) || /^172\.(1[6-9]|2\d|3[01])\./.test(value));
  const parameter = device.params?.find((p) => p.param_type === 1176)?.param_value;
  if (local(parameter)) return parameter;
  return local(device.ip_addr) ? device.ip_addr : undefined;
}
