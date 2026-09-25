/** Private Home/Tuya map provisioning. Sources: docs/research/E15_MAP_PROVISIONING.md. */
import { createHash } from 'node:crypto';
import { EufyError } from '../../types.js';
import { APP_QUERY, type Region } from '../protocol.js';
import { validateInputs } from './session.js';
import type { MapSessionProvisioning, MqttCredentials } from './types.js';

const brokerSuffix: Record<Region, string> = {
  EU: 'tuyaeu.com',
  AZ: 'tuyaus.com',
  AY: 'tuyacn.com',
  IN: 'tuyain.com',
};
const md5 = (value: string) => createHash('md5').update(value).digest('hex');
// Distributed Android app profile, not an account credential. Independently observed
// in three successful MQTT sessions. No vendor or mower-fork implementation is included.
const CHANNEL = '29e5ad57';
const APP_SIGNATURE =
  'com.eufylife.smarthome_CC:5F:6E:B5:59:BE:41:6F:65:51:07:37:61:49:FA:D6:FF:EC:2A:24:1F:55:B4:D9:09:D3:28:6E:22:59:1E:8C_cepev5pfnhua4dkqkdpmnrdxx378mpjr_s8x78u7xwymasd9kqa7a73pjhxqsedaj';

function invalid(): never {
  throw new EufyError('mower_map_invalid_provisioning');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max) return invalid();
  return value;
}
function identity(value: unknown): string {
  const result = text(value);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) return invalid();
  return result;
}

/** Validate saved credentials without accepting an arbitrary cloud-controlled destination. */
export function readMapMqtt(value: unknown, accountUid: string, region: Region): MqttCredentials {
  const raw = object(value);
  const host = text(raw.host, 255);
  const clientId = text(raw.clientId, 256);
  if (
    !/^m[0-9]+\.tuya(?:eu|us|cn|in)\.com$/.test(host) ||
    !host.endsWith('.' + brokerSuffix[region]) ||
    raw.port !== 8883 ||
    !clientId.endsWith('/mb/' + identity(accountUid)) ||
    !/^[A-Za-z0-9_-]+\/mb\/[A-Za-z0-9_-]+$/.test(clientId)
  )
    return invalid();
  return {
    host,
    port: 8883,
    clientId,
    username: text(raw.username, 4096),
    password: text(raw.password, 4096),
  };
}

/** Called only during an explicitly enabled Home login. Do not log the input or result. */
export function mapMqttFromLogin(value: unknown, region: Region): MqttCredentials {
  const login = object(value);
  const domain = object(login.domain);
  const accountUid = identity(login.uid);
  const partner = identity(login.partnerIdentity);
  const sid = text(login.sid, 4096);
  const ecode = text(login.ecode);
  if (domain.mqttsPort !== undefined && domain.mqttsPort !== 8883) return invalid();
  return readMapMqtt(
    {
      host: domain.mobileMqttsUrl,
      port: 8883,
      clientId: `${partner}/mb/${accountUid}`,
      username: `${partner}_v1_${APP_QUERY.clientId}_${CHANNEL}_mb_${sid}${md5(md5(APP_QUERY.clientId) + ecode).slice(-16)}`,
      password: md5(md5(APP_SIGNATURE) + ecode).slice(8, 24),
    },
    accountUid,
    region,
  );
}

export interface MapProvisioningBinding {
  accountUid: string;
  deviceId: string;
  localKey: string;
  expiresAt: number;
  region: Region;
  mqtt: MqttCredentials;
}

/** Convert one fresh, device-bound RTC response. Never use cached session keys or raw responses. */
export function mapProvisioningFromRtc(
  binding: MapProvisioningBinding,
  response: unknown,
  now = Date.now(),
): MapSessionProvisioning {
  try {
    const rtc = object(response);
    if (rtc.id !== binding.deviceId) return invalid();
    const config = object(rtc.p2pConfig);
    if (!Number.isSafeInteger(config.expire) || typeof config.expire !== 'number') return invalid();
    const expiry = config.expire * 1000;
    if (!Number.isSafeInteger(expiry)) return invalid();
    if (config.session !== undefined) {
      const session = object(config.session);
      if (session.devId !== binding.deviceId || session.uid !== binding.accountUid)
        return invalid();
    }
    const relay = object(config.tcpRelay);
    if (!Array.isArray(relay.urls) || !relay.urls.every((url) => typeof url === 'string'))
      return invalid();
    if (!Array.isArray(config.ices) || typeof config.preconnect !== 'boolean') return invalid();
    if (typeof rtc.p2pId !== 'string') return invalid();
    const mqtt = readMapMqtt(binding.mqtt, binding.accountUid, binding.region);
    const result: MapSessionProvisioning = {
      expiresAt: Math.min(binding.expiresAt, expiry),
      accountUid: identity(binding.accountUid),
      peer: identity(binding.deviceId),
      localKey: binding.localKey,
      password: text(rtc.password),
      motoId: rtc.p2pId,
      preconnect: config.preconnect,
      iceTokens: structuredClone(config.ices),
      tcpToken: {
        credential: text(relay.credential),
        username: text(relay.username),
        domain: text(relay.domain, 255),
        urls: [...relay.urls],
      },
      mqtt,
      subscribeTopics: [
        'smart/mb/in/' + binding.deviceId,
        'smart/mb/' + binding.accountUid,
        mqtt.clientId,
      ],
      publishTopic: 'smart/mb/out/' + binding.deviceId,
    };
    if (JSON.stringify(result).length > 65536) return invalid();
    validateInputs(result, now);
    return result;
  } catch {
    return invalid();
  }
}
