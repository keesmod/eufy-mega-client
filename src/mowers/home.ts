// SPDX-License-Identifier: Apache-2.0
// Adapted and modified 2026 by keesmod. Copyright 2022 Brendan McCluskey.
// Original protocol work credited to Andre Borie. MIT app profile: 2026 Will Cooke.
// Protocol provenance and retained licences: docs/MOWER_AUTH_PROVENANCE.md.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AuthAnswer, AuthState, Credentials } from '../types.js';
import { EufyError } from '../types.js';
import type {
  MowerAdapter,
  MowerAdapterContext,
  MowerDevice,
  MowerDpSchemaEntry,
  MowerHomeOptions,
} from '../modular-types.js';
import { copySchema, parseSchema } from './telemetry/schema.js';
import { mapMqttFromLogin, mapProvisioningFromRtc, readMapMqtt } from './maps/provisioning.js';
import type { MapSessionProvisioning, MqttCredentials } from './maps/types.js';
import { WORK_PARAMETERS_DP } from './work-parameters.js';
import {
  APP_QUERY,
  REGIONS,
  derivePassword,
  encryptPassword,
  mobileOrigin,
  region,
  sign,
  type Region,
} from './protocol.js';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EufyError('mower_invalid_response');
  return value as ObjectValue;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096)
    throw new EufyError('mower_invalid_response');
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 1000) throw new EufyError('mower_invalid_response');
  return value;
}
interface Session {
  account: string;
  deviceId: string;
  identitySalt: string;
  userId: string;
  uid: string;
  accountUid: string;
  token: string;
  sid: string;
  region: Region;
  origin: string;
  homeOrigin: string;
  timezone: string;
  phoneCode: string;
  expiresAt: number;
  mapMqtt?: MqttCredentials;
}
interface Binding {
  deviceId: string;
  localKey: string;
  schema?: MowerDpSchemaEntry[];
}
/** Internal-only input. Never returned by the package's public mower module. */
export interface PrivateMowerConnection {
  readonly accountUid: string;
  readonly deviceId: string;
  readonly localKey: string;
  /** Declared data points from the device record, when the cloud supplied them. */
  readonly schema?: readonly MowerDpSchemaEntry[];
  readonly region: Region;
  readonly expiresAt: number;
}
/** Internal-only result. DP 155 from the bound device's cloud record and nothing else of it. */
export interface CloudWorkParameters {
  /** Local receipt time of the cloud response as an ISO 8601 UTC timestamp, not device time. */
  readonly observedAt: string;
  /** The value when it is text, `null` when it has another type, undefined when absent. */
  readonly value: string | null | undefined;
}

/** Internal-only values and product declaration. No identifiers, keys or other DPs escape. */
export interface CloudState {
  readonly observedAt: string;
  readonly statusValue: string | null | undefined;
  readonly statusSchema?: MowerDpSchemaEntry;
  readonly workParametersValue: string | null | undefined;
}

/** Independent Home/Tuya owner. No security imports, physical commands or map transport. */
export class EufyHomeAdapter implements MowerAdapter {
  #credentials: Credentials;
  #store: MowerAdapterContext['sessionStore'];
  #fetch: typeof fetch;
  #timeout: number;
  #session?: Session;
  #lifetime = new AbortController();
  #bindingLifetime = new AbortController();
  #discovering = false;
  #bindings = new Map<string, Binding>();
  #pending = new Set<Promise<unknown>>();
  #mapProvisioning: boolean;

  constructor(context: MowerAdapterContext, options: MowerHomeOptions = {}) {
    if (options.mapProvisioning !== undefined && typeof options.mapProvisioning !== 'boolean')
      throw new EufyError('mower_invalid_options');
    this.#mapProvisioning = options.mapProvisioning === true;
    this.#credentials = { ...context.credentials };
    this.#store = context.sessionStore;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.requestTimeoutMs ?? 15_000;
    if (!Number.isInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 60_000)
      throw new EufyError('mower_invalid_options');
  }
  get connected(): boolean {
    return (
      !this.#lifetime.signal.aborted && !!this.#session && this.#session.expiresAt > Date.now()
    );
  }
  #revokeBindings(): void {
    this.#bindingLifetime.abort();
    this.#bindingLifetime = new AbortController();
    this.#bindings.clear();
  }
  #account(): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          this.#credentials.email.trim().toLowerCase(),
          this.#credentials.country.toUpperCase(),
          this.#credentials.password,
        ]),
      )
      .digest('hex');
  }
  #track<T>(signal: AbortSignal, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = AbortSignal.any([signal, this.#lifetime.signal]);
    const operation = Promise.resolve().then(async () => {
      if (abort.aborted) throw new EufyError('request_aborted');
      try {
        const result = await task(abort);
        if (abort.aborted) throw new EufyError('request_aborted');
        return result;
      } catch (error) {
        if (abort.aborted) throw new EufyError('request_aborted');
        // Never expose upstream response text, URLs, abort reasons or nested causes.
        if (error instanceof EufyError && SAFE_CODES.has(error.code))
          throw new EufyError(error.code);
        throw new EufyError('mower_request_failed');
      }
    });
    this.#pending.add(operation);
    return operation.finally(() => this.#pending.delete(operation));
  }
  async #json(url: string, init: RequestInit, signal: AbortSignal): Promise<ObjectValue> {
    const timeout = AbortSignal.timeout(this.#timeout);
    const abort = AbortSignal.any([signal, timeout]);
    let authenticationFailure: EufyError | undefined;
    try {
      const response = await this.#fetch(url, { ...init, redirect: 'error', signal: abort });
      if (abort.aborted) throw new EufyError('request_aborted');
      if (response.status === 401 || response.status === 403) {
        const wasConnected = !!this.#session;
        authenticationFailure = new EufyError(
          wasConnected ? 'authentication_required' : 'authentication_failed',
        );
        this.#session = undefined;
        this.#revokeBindings();
        throw authenticationFailure;
      }
      if (!response.ok) throw new EufyError('mower_request_failed');
      // Bound the decoded body, including chunked responses.
      const reader = response.body?.getReader();
      if (!reader) throw new EufyError('mower_invalid_response');
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          length += item.value.byteLength;
          if (length > 2_000_000) throw new EufyError('mower_invalid_response');
          chunks.push(item.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (abort.aborted) throw new EufyError('request_aborted');
      return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (error) {
      // This response revoked its own binding lease. Preserve that authentication failure.
      if (authenticationFailure && error === authenticationFailure) throw error;
      if (signal.aborted) throw new EufyError('request_aborted');
      if (timeout.aborted) throw new EufyError('request_timeout');
      throw error;
    }
  }
  #headers(session?: Session): Record<string, string> {
    return {
      'User-Agent': 'EufyHome-Android-3.1.3-753',
      category: 'Home',
      clientType: '2',
      language: 'en',
      country: this.#credentials.country,
      timezone: session?.timezone ?? 'UTC',
      openudid: 'sdk_gphone64_arm64',
      ...(session ? { token: session.token, id: session.userId } : {}),
    };
  }
  async #tuya(
    session: Session,
    action: string,
    version: string,
    data: ObjectValue | undefined,
    signal: AbortSignal,
    authenticated = true,
    gid?: string,
  ): Promise<unknown> {
    const params: Record<string, string> = {
      ...APP_QUERY,
      deviceId: session.deviceId,
      timeZoneId: session.timezone,
      time: String(Math.floor(Date.now() / 1000)),
      requestId: randomUUID(),
      a: action,
      v: version,
      ...(authenticated ? { sid: session.sid } : {}),
      ...(gid ? { gid } : {}),
    };
    const body = data === undefined ? '' : JSON.stringify(data);
    params.sign = sign(params, body);
    const response = await this.#json(
      `${session.origin}/api.json?${new URLSearchParams(params)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TY-UA=APP/Android/2.4.0/SDK/null',
        },
        body: new URLSearchParams(body ? { postData: body } : {}),
      },
      signal,
    );
    if (response.success === false || !Object.hasOwn(response, 'result')) {
      if (
        response.errorCode === 'USER_SESSION_INVALID' ||
        response.errorCode === 'USER_SESSION_EXPIRED'
      ) {
        this.#session = undefined;
        this.#revokeBindings();
        throw new EufyError('authentication_required');
      }
      throw new EufyError(authenticated ? 'mower_request_failed' : 'authentication_failed');
    }
    return response.result;
  }
  connect(_answer: AuthAnswer | undefined, signal: AbortSignal): Promise<AuthState> {
    return this.#track(signal, async (abort) => {
      if (this.connected) return { state: 'connected' };
      this.#session = undefined;
      this.#revokeBindings();
      let saved: unknown;
      try {
        saved = await this.#store.load();
      } catch {
        throw new EufyError('session_unreadable');
      }
      if (abort.aborted) throw new EufyError('request_aborted');
      let previous: Session | undefined;
      if (saved !== undefined) {
        try {
          const envelope = object(saved);
          if (envelope.version !== 1) throw new Error();
          const raw = object(JSON.parse(string(envelope.data)));
          if (raw.account === this.#account()) {
            previous = this.#readSession(raw);
            if (previous.expiresAt > Date.now() && (!this.#mapProvisioning || previous.mapMqtt)) {
              // A persisted SID is only connected after server-side validation.
              try {
                list(await this.#tuya(previous, 'tuya.m.location.list', '2.1', undefined, abort));
                this.#session = previous;
                return { state: 'connected' };
              } catch (error) {
                if (!(error instanceof EufyError) || error.code !== 'authentication_required')
                  throw error;
              }
            }
          }
        } catch (error) {
          if (error instanceof EufyError && SAFE_CODES.has(error.code)) throw error;
          throw new EufyError('session_unreadable');
        }
      }
      const response = await this.#json(
        'https://home-api.eufylife.com/v1/user/email/login',
        {
          method: 'POST',
          headers: { ...this.#headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: this.#credentials.email,
            password: this.#credentials.password,
            client_id: 'eufyhome-app',
            client_Secret: 'GQCpr9dSp3uQpsOMgJ4xQ',
          }),
        },
        abort,
      );
      if (!response.access_token) throw new EufyError('authentication_failed');
      const info = response.user_info === undefined ? response : object(response.user_info);
      const userId = string(String(info.id ?? response.user_id ?? ''));
      const homeOrigin = this.#homeOrigin(info.request_host ?? 'https://api.eufylife.com');
      let regionCode = response.region;
      if (response.user_info !== undefined) {
        const settings = await this.#json(
          `${homeOrigin}/v1/user/setting`,
          {
            headers: { ...this.#headers(), token: string(response.access_token), id: userId },
          },
          abort,
        );
        regionCode = object(
          object(object(settings.setting).home_setting).tuya_home,
        ).tuya_region_code;
      }
      const selectedRegion = region(regionCode);
      const session: Session = {
        account: this.#account(),
        deviceId: previous?.deviceId ?? '8534c8ec0ed0' + randomBytes(16).toString('hex'),
        identitySalt: previous?.identitySalt ?? randomBytes(32).toString('hex'),
        userId,
        uid: `eh-${userId}`,
        accountUid: '',
        token: string(response.access_token),
        sid: '',
        region: selectedRegion,
        origin: REGIONS[selectedRegion],
        homeOrigin,
        timezone: string(info.timezone),
        phoneCode: string(String(info.phone_code ?? '')),
        // Conservative local reuse bound. This is not a claimed server token lifetime.
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
      const token = object(
        await this.#tuya(
          session,
          'tuya.m.user.uid.token.create',
          '1.0',
          { uid: session.uid, countryCode: session.phoneCode },
          abort,
          false,
        ),
      );
      const login = object(
        await this.#tuya(
          session,
          'tuya.m.user.uid.password.login.reg',
          '1.0',
          {
            uid: session.uid,
            createGroup: true,
            ifencrypt: 1,
            passwd: encryptPassword(token.exponent, token.publicKey, derivePassword(session.uid)),
            countryCode: session.phoneCode,
            options: '{"group": 1}',
            token: string(token.token),
          },
          abort,
          false,
        ),
      );
      session.sid = string(login.sid);
      session.accountUid = string(login.uid);
      session.origin = mobileOrigin(object(login.domain).mobileApiUrl);
      session.region = Object.entries(REGIONS).find(
        ([, origin]) => origin === session.origin,
      )![0] as Region;
      if (this.#mapProvisioning) session.mapMqtt = mapMqttFromLogin(login, session.region);
      if (abort.aborted) throw new EufyError('request_aborted');
      try {
        await this.#store.save({ version: 1, data: JSON.stringify(session) });
      } catch {
        throw new EufyError('session_write_failed');
      }
      if (abort.aborted) throw new EufyError('request_aborted');
      this.#session = session;
      return { state: 'connected' };
    });
  }
  #homeOrigin(value: unknown): string {
    const host = string(value);
    if (
      host !== 'https://api.eufylife.com' &&
      host !== 'https://home-api.eufylife.com' &&
      host !== 'https://appliances-api-eu.eufylife.com'
    )
      throw new EufyError('mower_region_unsupported');
    return host;
  }
  #readSession(raw: ObjectValue): Session {
    const result = {} as Session;
    for (const key of [
      'account',
      'deviceId',
      'identitySalt',
      'userId',
      'uid',
      'accountUid',
      'token',
      'sid',
      'timezone',
      'phoneCode',
    ] as const)
      result[key] = string(raw[key]);
    result.region = region(raw.region);
    result.origin = mobileOrigin(raw.origin);
    result.homeOrigin = this.#homeOrigin(raw.homeOrigin);
    if (REGIONS[result.region] !== result.origin) throw new EufyError('session_unreadable');
    if (
      typeof raw.expiresAt !== 'number' ||
      !Number.isFinite(raw.expiresAt) ||
      raw.expiresAt > Date.now() + 3_600_000
    )
      throw new EufyError('session_unreadable');
    result.expiresAt = raw.expiresAt;
    if (raw.mapMqtt !== undefined)
      result.mapMqtt = readMapMqtt(raw.mapMqtt, result.accountUid, result.region);
    return result;
  }
  #requireSession(): Session {
    if (!this.connected || !this.#session) {
      this.#revokeBindings();
      throw new EufyError('authentication_required');
    }
    return this.#session;
  }
  discover(signal: AbortSignal): Promise<MowerDevice[]> {
    if (this.#discovering) return Promise.reject(new EufyError('mower_discovery_busy'));
    this.#discovering = true;
    return this.#track(signal, async (abort) => {
      const session = this.#requireSession();
      this.#revokeBindings();
      const cloud = await this.#json(
        `${session.homeOrigin}/v1/device/list/devices-and-groups`,
        { headers: this.#headers(session) },
        abort,
      );
      const devices = list(cloud.items).map((item) => object(object(item).device));
      const result: MowerDevice[] = [];
      const bindings = new Map<string, Binding>();
      for (const device of devices) {
        // Exact E15 model and cross-service identity must be independently validated.
        if (object(device.product).product_code !== 'T2880') continue;
        const deviceId = string(device.id);
        const peer = object(
          await this.#tuya(session, 'tuya.m.device.get', '1.0', { devId: deviceId }, abort),
        );
        if (peer.devId !== deviceId) throw new EufyError('mower_binding_unavailable');
        const localKey = string(peer.localKey);
        const id = createHmac('sha256', session.identitySalt).update(deviceId).digest('hex');
        if (bindings.has(id)) continue;
        // The schema is optional product metadata. It never fails discovery.
        const schema = parseSchema(peer.schema);
        bindings.set(id, { deviceId, localKey, ...(schema ? { schema } : {}) });
        result.push({ id, kind: 'mower', model: 'E15', productCode: 'T2880' });
      }
      if (abort.aborted) throw new EufyError('request_aborted');
      this.#bindings = bindings;
      return result;
    }).finally(() => {
      this.#discovering = false;
    });
  }
  /** Internal library consumers only. Revoked by expiry, cancellation and shutdown. */
  withConnection<T>(
    id: string,
    signal: AbortSignal,
    use: (connection: PrivateMowerConnection, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.#track(signal, async (abort) => {
      const session = this.#requireSession();
      const binding = this.#bindings.get(id);
      if (!binding) throw new EufyError('mower_binding_unavailable');
      const expiry = AbortSignal.timeout(Math.max(1, session.expiresAt - Date.now()));
      const lease = AbortSignal.any([abort, expiry, this.#bindingLifetime.signal]);
      const schema = copySchema(binding.schema);
      const result = await use(
        Object.freeze({
          accountUid: session.accountUid,
          deviceId: binding.deviceId,
          localKey: binding.localKey,
          ...(schema ? { schema } : {}),
          region: session.region,
          expiresAt: session.expiresAt,
        }),
        lease,
      );
      if (lease.aborted) throw new EufyError('request_aborted');
      return result;
    });
  }
  /**
   * Internal library consumers only. Reads the bound device's cloud record through the request
   * discovery makes and returns DP 155 alone with the receipt time. The device ID stays inside.
   */
  readCloudWorkParameters(id: string, signal: AbortSignal): Promise<CloudWorkParameters> {
    return this.readCloudState(id, signal).then((read) => ({
      observedAt: read.observedAt,
      value: read.workParametersValue,
    }));
  }
  /** One bound cloud record for activity and work parameters. No local snapshot is produced. */
  readCloudState(id: string, signal: AbortSignal): Promise<CloudState> {
    return this.#track(signal, async (abort) => {
      const session = this.#requireSession();
      const binding = this.#bindings.get(id);
      if (!binding) throw new EufyError('mower_binding_unavailable');
      const expiry = AbortSignal.timeout(Math.max(1, session.expiresAt - Date.now()));
      const lease = AbortSignal.any([abort, expiry, this.#bindingLifetime.signal]);
      const record = object(
        await this.#tuya(session, 'tuya.m.device.get', '1.0', { devId: binding.deviceId }, lease),
      );
      if (lease.aborted) throw new EufyError('request_aborted');
      this.#requireSession();
      const observedAt = new Date().toISOString();
      if (record.devId !== binding.deviceId) throw new EufyError('mower_binding_unavailable');
      // Only the requested points are retained. Absent and wrong-typed values stay distinct.
      const read = (dp: string): string | null | undefined => {
        const dps = record.dps;
        if (!dps || typeof dps !== 'object' || Array.isArray(dps) || !Object.hasOwn(dps, dp))
          return undefined;
        const value = (dps as ObjectValue)[dp];
        return typeof value === 'string' ? value : null;
      };
      const statusSchema = copySchema(binding.schema)?.find((entry) => entry.id === '107');
      return {
        observedAt,
        statusValue: read('107'),
        ...(statusSchema ? { statusSchema } : {}),
        workParametersValue: read(WORK_PARAMETERS_DP),
      };
    });
  }
  /** Internal-only producer. No generic cloud request or raw response escapes. */
  provisionMapSession(id: string, signal: AbortSignal): Promise<MapSessionProvisioning> {
    return this.withConnection(id, signal, async (binding, lease) => {
      if (!this.#mapProvisioning) throw new EufyError('mower_maps_disabled');
      const session = this.#requireSession();
      if (!session.mapMqtt) throw new EufyError('mower_map_invalid_provisioning');
      const rtc = await this.#tuya(
        session,
        'tuya.m.rtc.config.get',
        '1.0',
        { devId: binding.deviceId },
        lease,
      );
      return mapProvisioningFromRtc({ ...binding, mqtt: session.mapMqtt }, rtc);
    });
  }

  async shutdown(): Promise<void> {
    this.#lifetime.abort();
    await Promise.allSettled([...this.#pending]);
    this.#session = undefined;
    this.#revokeBindings();
    this.#credentials = { email: '', password: '', country: '' };
  }
}
const SAFE_CODES = new Set([
  'mower_maps_disabled',
  'mower_map_invalid_provisioning',
  'authentication_failed',
  'authentication_required',
  'request_aborted',
  'request_timeout',
  'session_unreadable',
  'session_write_failed',
  'mower_region_unsupported',
  'mower_invalid_response',
  'mower_invalid_options',
  'mower_request_failed',
  'mower_binding_unavailable',
  'mower_discovery_busy',
  'mower_local_key_invalid',
  'mower_local_unreachable',
  'mower_local_authentication_failed',
  'mower_local_protocol_error',
  'mower_local_rejected',
  'mower_local_binding_mismatch',
  'mower_local_disconnected',
  'mower_local_busy',
]);
