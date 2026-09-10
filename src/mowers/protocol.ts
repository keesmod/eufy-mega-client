// SPDX-License-Identifier: Apache-2.0
// Adapted and modified 2026 by keesmod. Copyright 2022 Brendan McCluskey.
// Original protocol work credited to Andre Borie. MIT app profile: 2026 Will Cooke.
// Adapted from Apache-2.0 robovac and MIT eufy-x8. See docs/MOWER_AUTH_PROVENANCE.md.
// App-distributed constants below are not user credentials.
import { createCipheriv, createHash, createHmac } from 'node:crypto';
import { EufyError } from '../types.js';

export const REGIONS = {
  EU: 'https://a1.tuyaeu.com',
  AZ: 'https://a1.tuyaus.com',
  AY: 'https://a1.tuyacn.com',
  IN: 'https://a1.tuyain.com',
} as const;
export type Region = keyof typeof REGIONS;
export function region(value: unknown): Region {
  if (typeof value !== 'string' || !Object.hasOwn(REGIONS, value))
    throw new EufyError('mower_region_unsupported');
  return value as Region;
}
export function mobileOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new EufyError('mower_invalid_response');
  // Never forward the session to an arbitrary redirect or cloud-supplied host.
  const url = new URL(value);
  if (
    !Object.values(REGIONS).includes(url.origin as (typeof REGIONS)[Region]) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new EufyError('mower_region_unsupported');
  return url.origin;
}
export const APP_QUERY = Object.freeze({
  appVersion: '2.4.0',
  platform: 'sdk_gphone64_arm64',
  clientId: 'yx5v9uc3ef9wg3v9atje',
  lang: 'en',
  osSystem: '12',
  os: 'Android',
  ttid: 'android',
  et: '0.0.1',
  sdkVersion: '3.0.8cAnker',
});
const SIGNED = new Set([
  'a',
  'v',
  'lat',
  'lon',
  'lang',
  'deviceId',
  'appVersion',
  'ttid',
  'isH5',
  'h5Token',
  'os',
  'clientId',
  'postData',
  'time',
  'requestId',
  'et',
  'n4h5',
  'sid',
  'sp',
]);
const md5 = (value: string | Buffer) => createHash('md5').update(value).digest('hex');
export function sign(query: Record<string, string>, body: string): string {
  const params = body ? { ...query, postData: body } : query;
  const message = Object.keys(params)
    .sort()
    .filter((key) => SIGNED.has(key))
    .map((key) => {
      let value = params[key]!;
      if (key === 'postData') {
        const hash = md5(value);
        value = hash.slice(8, 16) + hash.slice(0, 8) + hash.slice(24, 32) + hash.slice(16, 24);
      }
      return `${key}=${value}`;
    })
    .join('||');
  return createHmac('sha256', 'A_cepev5pfnhua4dkqkdpmnrdxx378mpjr_s8x78u7xwymasd9kqa7a73pjhxqsedaj')
    .update(message)
    .digest('hex');
}
export function derivePassword(uid: string): string {
  // This observed profile uses ASCII account UIDs. Reject ambiguous encodings.
  if (!/^[\x20-\x7e]{1,128}$/.test(uid)) throw new EufyError('mower_invalid_response');
  const cipher = createCipheriv(
    'aes-128-cbc',
    Buffer.from([36, 78, 109, 138, 86, 172, 135, 145, 36, 67, 45, 139, 108, 188, 162, 196]),
    Buffer.from([119, 36, 86, 242, 167, 102, 76, 243, 57, 44, 53, 151, 233, 62, 87, 71]),
  );
  cipher.setAutoPadding(false);
  const bytes = Buffer.concat([
    cipher.update(uid.padStart(Math.ceil(uid.length / 16) * 16, '0')),
    cipher.final(),
  ]);
  return md5(bytes.toString('hex').toUpperCase());
}
export function encryptPassword(exponent: unknown, modulus: unknown, password: string): string {
  // Decimal RSA parameters, bounded before BigInt parsing and exponentiation.
  if (!/^[0-9]{1,7}$/.test(String(exponent)) || !/^[0-9]{77,1234}$/.test(String(modulus)))
    throw new EufyError('mower_invalid_response');
  let e = BigInt(String(exponent));
  const n = BigInt(String(modulus));
  let base = BigInt('0x' + Buffer.from(password).toString('hex'));
  if (e < 3n || e > 65537n || e % 2n === 0n || n <= base)
    throw new EufyError('mower_invalid_response');
  let result = 1n;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % n;
    base = (base * base) % n;
    e >>= 1n;
  }
  return result.toString(16).padStart(Math.ceil(n.toString(2).length / 8) * 2, '0');
}
