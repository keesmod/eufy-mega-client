import { createCipheriv, createECDH, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  MEGA_PRESET_KEY,
  buildKeyExchange,
  finalizeKeyExchange,
  generateKeyIdent,
  megaEncryptBody,
  megaDecryptBody,
  sharedKeyToAesKey,
  sharedKeySigningKey,
  xSignature,
  type MegaIdentity,
} from './crypto.js';
import {
  EufyError,
  type AuthAnswer,
  type AuthState,
  type ClientOptions,
  type Session,
  type EventSession,
} from './types.js';

interface Result {
  code: number;
  data?: unknown;
}
const LOGIN_KEY =
  '04c5c00c4f8d1197cc7c3167c52bf7acb054d722f0ef08dcd7e0883236e0d72a3868d9750cb47fa4619248f3d83f0f662671dadc6e2d31c2f41db0161651c7c076';
const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new EufyError('invalid_response');
  return x as Record<string, unknown>;
};
export { object as responseObject };
const allowedHost = (host: string): boolean =>
  /^(?:mega|app-[a-z]+)-(?:eu|us)-pr\.eufy\.com$/.test(host);
const success = (code: number) => code === 0 || code === 200;

/** Only Mega cloud transport. There is no legacy HTTP fallback. */
export class MegaCloud {
  private readonly lifetime = new AbortController();
  private readonly request: typeof fetch;
  private session?: Session;
  private queue: Promise<unknown> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  private nextRequest = 0;
  private readonly timeout: number;
  private readonly interval: number;
  constructor(private readonly options: ClientOptions) {
    if (!/^[a-z]{2}$/i.test(options.credentials.country)) throw new EufyError('invalid_country');
    this.request = options.fetch ?? fetch;
    this.timeout = options.requestTimeoutMs ?? 15000;
    this.interval = options.minRequestIntervalMs ?? 3000;
    if (
      !Number.isFinite(this.timeout) ||
      this.timeout < 1 ||
      !Number.isFinite(this.interval) ||
      this.interval < 0
    )
      throw new EufyError('invalid_timeout');
  }
  close(): void {
    this.lifetime.abort();
  }
  get connected(): boolean {
    const s = this.session;
    return (
      !this.lifetime.signal.aborted &&
      !!s &&
      s.phase === 'authenticated' &&
      !!s.token &&
      !!s.userId &&
      (s.expiresAt ?? 0) > Date.now() / 1000 + 60
    );
  }
  private hash(deviceId: string): string {
    const { email, password } = this.options.credentials;
    return createHash('sha256').update(`${deviceId}:${email}:${password}`).digest('hex');
  }
  private async initialize(): Promise<void> {
    if (this.session) return;
    const saved = await this.options.sessionStore.load();
    const country = this.options.credentials.country.toLowerCase();
    if (
      saved?.version === 1 &&
      saved.country === country &&
      /^[a-f0-9]{32}$/.test(saved.deviceId) &&
      saved.accountHash === this.hash(saved.deviceId)
    ) {
      if (saved.domain && !allowedHost(saved.domain)) throw new EufyError('invalid_session_domain');
      this.session = saved;
    } else {
      const deviceId = generateKeyIdent();
      this.session = {
        version: 1,
        country,
        deviceId,
        accountHash: this.hash(deviceId),
        phase: 'new',
        identities: {},
      };
    }
  }
  private async persist(): Promise<void> {
    const snapshot = structuredClone(this.session!);
    const write = this.writes.catch(() => {}).then(() => this.options.sessionStore.save(snapshot));
    this.writes = write;
    await write;
  }
  async flush(): Promise<void> {
    await this.writes;
  }
  getEventSession(): EventSession | undefined {
    return this.session?.events ? structuredClone(this.session.events) : undefined;
  }
  async saveEventSession(events: EventSession): Promise<void> {
    if (!this.session) throw new EufyError('authentication_required');
    this.session.events = structuredClone(events);
    await this.persist();
  }
  private host(service: string): string {
    if (!/^[a-z]+$/.test(service)) throw new EufyError('invalid_service');
    const domain = this.session?.domain;
    if (!domain?.startsWith('mega-')) throw new EufyError('domain_unresolved');
    return domain.replace(/^mega-/, `app-${service}-`);
  }
  private async post(
    host: string,
    path: string,
    makeRequest: () => RequestInit,
    signal?: AbortSignal,
  ): Promise<Result> {
    if (!allowedHost(host) || !path.startsWith('/') || path.includes('?') || path.includes('#'))
      throw new EufyError('endpoint_not_allowed');
    const abort = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    const requestAbort = AbortSignal.any([abort, AbortSignal.timeout(this.timeout)]);
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const started = Date.now();
        try {
          requestAbort.throwIfAborted();
          await delay(Math.max(0, this.nextRequest - Date.now()), undefined, {
            signal: requestAbort,
          });
          requestAbort.throwIfAborted();
          this.nextRequest = Date.now() + this.interval;
          // Sign only after waiting for our slot. Never replay a previous signature.
          const response = await this.request(`https://${host}${path}`, {
            ...makeRequest(),
            method: 'POST',
            redirect: 'error',
            signal: requestAbort,
          });
          const reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader)
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > 2 * 1024 * 1024) throw new EufyError('response_too_large');
                chunks.push(value);
              }
            } finally {
              await reader.cancel().catch(() => {});
            }
          const parsed = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          const code = parsed.code;
          // Consumer diagnostics must never alter protocol or authentication behavior.
          try {
            this.options.diagnostics?.({
              operation: 'cloud_request',
              host,
              path,
              status: response.status,
              code: typeof code === 'number' ? code : undefined,
              elapsedMs: Date.now() - started,
            });
          } catch {}
          if (!response.ok) throw new EufyError('http_error', response.status);
          if (typeof code !== 'number') throw new EufyError('invalid_response');
          return { code, data: parsed.data };
        } catch (error) {
          if (error instanceof EufyError) throw error;
          if (requestAbort.aborted)
            throw new EufyError(abort.aborted ? 'cancelled' : 'request_timeout');
          throw new EufyError('request_failed');
        }
      });
    this.queue = operation;
    // Queueing also consumes the deadline. A cancelled queued request never sends.
    return new Promise<Result>((resolve, reject) => {
      const cancel = () => reject(new EufyError(abort.aborted ? 'cancelled' : 'request_timeout'));
      if (requestAbort.aborted) cancel();
      else requestAbort.addEventListener('abort', cancel, { once: true });
      operation.then(
        (result) => {
          requestAbort.removeEventListener('abort', cancel);
          resolve(result);
        },
        (error) => {
          requestAbort.removeEventListener('abort', cancel);
          reject(error);
        },
      );
    });
  }
  private headers(): Record<string, string> {
    const s = this.session!;
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'app-name': 'eufy_mega',
      'app-version': '6.0.51_26722',
      app_version: '6.0.51_26722',
      'os-type': 'android',
      os_type: 'android',
      'os-version': '14',
      os_version: '14',
      'phone-model': 'Pixel 8',
      phone_model: 'Pixel 8',
      'model-type': 'PHONE',
      'user-agent': 'ktor-client',
      openudid: s.deviceId,
      country: s.country.toUpperCase(),
      language: s.country,
      ab_code: s.country,
      'x-encryption-info': 'algo_ecdh',
      'x-replay-info': 'replay',
      'test-flag': 'false',
    };
    if (s.userId) h.gtoken = createHash('md5').update(s.userId).digest('hex');
    if (s.token) {
      h['x-auth-token'] = s.token;
      h.authorization = s.token;
    }
    return h;
  }
  private async signed(
    host: string,
    path: string,
    payload: unknown,
    identity: MegaIdentity | undefined,
    bootstrap?: { keyIdent: string; encrypted: string },
    signal?: AbortSignal,
  ): Promise<Result> {
    const result = await this.post(
      host,
      path,
      () => {
        if (!identity && !bootstrap) throw new EufyError('identity_missing');
        const value =
          bootstrap?.encrypted ??
          megaEncryptBody(JSON.stringify(payload), sharedKeyToAesKey(identity!.sharedKey));
        const timestamp = String(Math.floor(Date.now() / 1000));
        const nonce = generateKeyIdent();
        return {
          headers: {
            ...this.headers(),
            'x-key-ident': bootstrap?.keyIdent ?? identity!.keyIdent,
            'x-request-ts': timestamp,
            'x-request-once': nonce,
            'x-signature': xSignature(
              bootstrap ? MEGA_PRESET_KEY : sharedKeySigningKey(identity!.sharedKey),
              timestamp,
              nonce,
              value,
            ),
          },
          body: bootstrap ? JSON.stringify({ client_public_key: value }) : value,
        };
      },
      signal,
    );
    if (result.code === 4404 || result.code === 4416) {
      this.session!.identities = {};
      await this.persist();
    }
    return result;
  }
  private async identity(signal?: AbortSignal): Promise<MegaIdentity> {
    const host = this.host('openapi');
    const cached = this.session!.identities[host];
    if (cached) return cached;
    const exchange = buildKeyExchange();
    const result = await this.signed(
      host,
      '/openapi/oauth/key/exchange',
      undefined,
      undefined,
      { keyIdent: exchange.keyIdent, encrypted: exchange.clientPublicKeyBody },
      signal,
    );
    if (!success(result.code)) throw new EufyError('key_exchange_failed', result.code);
    const key = object(result.data).server_public_key;
    if (typeof key !== 'string') throw new EufyError('invalid_key_exchange');
    const identity = finalizeKeyExchange(
      exchange.ecdh,
      key,
      exchange.keyIdent,
      exchange.clientPublicKey,
    );
    this.session!.identities[host] = identity;
    await this.persist();
    return identity;
  }
  private async raw(
    service: string,
    path: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<Result> {
    const identity = await this.identity(signal);
    const result = await this.signed(
      this.host(service),
      path,
      payload,
      identity,
      undefined,
      signal,
    );
    if (typeof result.data === 'string' && success(result.code)) {
      try {
        result.data = JSON.parse(
          megaDecryptBody(result.data, sharedKeyToAesKey(identity.sharedKey)),
        );
      } catch {
        throw new EufyError('response_decryption_failed');
      }
    }
    return result;
  }
  async call(
    service: string,
    path: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.connected) throw new EufyError('authentication_required');
    const result = await this.raw(service, path, payload, signal);
    if (!success(result.code)) throw new EufyError('request_rejected', result.code);
    return result.data;
  }
  async connect(answer?: AuthAnswer, signal?: AbortSignal): Promise<AuthState> {
    await this.initialize();
    const s = this.session!;
    if (this.connected && !answer) return { state: 'connected' };
    if (s.phase === 'locked') return { state: 'locked' };
    if (s.phase === 'verification' && !answer) return { state: 'verification_required' };
    if (s.phase === 'captcha' && !answer) return this.captcha(signal);
    if (!s.domain) {
      const domain = `mega-${s.country === 'us' ? 'us' : 'eu'}-pr.eufy.com`;
      const result = await this.post(
        domain,
        '/passport/estimate_domain',
        () => ({ headers: this.headers(), body: JSON.stringify({ ab: s.country, mode: 1 }) }),
        signal,
      );
      if (!success(result.code)) throw new EufyError('domain_discovery_failed', result.code);
      const resolved = object(result.data).domain;
      if (typeof resolved !== 'string' || !allowedHost(resolved) || !resolved.startsWith('mega-'))
        throw new EufyError('invalid_region');
      s.domain = resolved;
    }
    if (s.phase === 'authenticated') {
      s.phase = 'new';
      delete s.token;
      delete s.userId;
      delete s.expiresAt;
    }
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const key = ecdh.computeSecret(Buffer.from(LOGIN_KEY, 'hex'));
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    const password =
      cipher.update(this.options.credentials.password, 'utf8', 'base64') + cipher.final('base64');
    const result = await this.raw(
      'passport',
      '/passport/login',
      {
        email: this.options.credentials.email,
        password,
        ab: s.country,
        client_secret_info: { public_key: ecdh.getPublicKey('hex') },
        login_id: '',
        verify_code: answer && 'verifyCode' in answer ? answer.verifyCode : '',
        captcha_id: answer && 'captchaId' in answer ? answer.captchaId : '',
        answer: answer && 'answer' in answer ? answer.answer : '',
      },
      signal,
    );
    if ([100028, 100027].includes(result.code)) {
      s.phase = 'locked';
      await this.persist();
      return { state: 'locked' };
    }
    if ([100032, 100033].includes(result.code)) {
      s.phase = 'captcha';
      await this.persist();
      return this.captcha(signal);
    }
    if (!success(result.code)) {
      await this.persist();
      throw new EufyError('authentication_rejected', result.code);
    }
    const data = object(result.data);
    const token = data.auth_token ?? data.token;
    const userId = data.user_id ?? data.userId;
    if (
      typeof token !== 'string' ||
      !token ||
      typeof userId !== 'string' ||
      !userId ||
      typeof data.token_expires_at !== 'number'
    )
      throw new EufyError('invalid_authentication');
    s.token = token;
    s.userId = userId;
    s.expiresAt = data.token_expires_at;
    if (data.fa_info && object(data.fa_info).step === 26052) {
      const send = s.phase !== 'verification';
      s.phase = 'verification';
      await this.persist();
      if (send) {
        const result = await this.raw(
          'push',
          '/app/sendmsg/verify_code',
          { message_type: 2, biz_type: 1004, transaction: String(Date.now()) },
          signal,
        );
        if (!success(result.code)) throw new EufyError('verification_send_failed', result.code);
      }
      return { state: 'verification_required' };
    }
    s.phase = 'authenticated';
    await this.persist();
    return { state: 'connected' };
  }
  private async captcha(signal?: AbortSignal): Promise<AuthState> {
    const result = await this.raw(
      'passport',
      '/passport/generate/captcha',
      { captcha_type: 'PIC', biz_type: 0 },
      signal,
    );
    if (!success(result.code)) throw new EufyError('captcha_failed', result.code);
    const data = object(result.data);
    if (typeof data.captcha_id !== 'string' || typeof data.item !== 'string')
      throw new EufyError('invalid_captcha');
    return { state: 'captcha_required', captchaId: data.captcha_id, image: data.item };
  }
}
