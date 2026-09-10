import { EufyMegaClient } from './client.js';
import { EufyError, type AuthAnswer, type AuthState, type ClientOptions } from './types.js';
import type {
  EufyClientOptions,
  ModuleLifecycleState,
  MowerAdapter,
  MowerModule,
  MowerOptions,
  SecurityModule,
} from './modular-types.js';

function authState(value: AuthState): AuthState {
  switch (value?.state) {
    case 'connected':
    case 'disconnected':
    case 'verification_required':
    case 'locked':
      return { state: value.state };
    case 'captcha_required':
      if (typeof value.captchaId === 'string' && typeof value.image === 'string')
        return { state: value.state, captchaId: value.captchaId, image: value.image };
  }
  throw new EufyError('invalid_auth_state');
}

class SecurityClient extends EufyMegaClient implements SecurityModule {
  #state: AuthState = { state: 'disconnected' };
  #lifecycle: ModuleLifecycleState = 'open';
  #shutdown?: Promise<void>;

  constructor(options: ClientOptions) {
    super(options);
  }

  get lifecycle(): ModuleLifecycleState {
    return this.#lifecycle;
  }

  get authState(): AuthState {
    if (this.#lifecycle !== 'open') return { state: 'disconnected' };
    if (this.connected) return { state: 'connected' };
    return this.#state.state === 'connected' ? { state: 'disconnected' } : authState(this.#state);
  }

  override connect(answer?: AuthAnswer, signal?: AbortSignal): Promise<AuthState> {
    return super.connect(answer, signal).then((state) => {
      this.#state = authState(state);
      return authState(this.#state);
    });
  }

  override shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    this.#lifecycle = 'closing';
    this.#shutdown = super.shutdown().finally(() => {
      this.#lifecycle = 'closed';
      this.#state = { state: 'disconnected' };
    });
    return this.#shutdown;
  }
}

// Adapter errors are reduced to known public codes, without upstream payloads or causes.
function mowerError(error: unknown): EufyError {
  const codes = [
    'authentication_required',
    'authentication_failed',
    'session_unreadable',
    'session_write_failed',
    'request_timeout',
    'request_aborted',
    'invalid_auth_state',
    'mower_protocol_unavailable',
    'client_closed',
  ];
  return new EufyError(
    error instanceof EufyError && codes.includes(error.code)
      ? error.code
      : 'mower_authentication_failed',
  );
}

class Mowers implements MowerModule {
  #options: MowerOptions;
  #adapter?: MowerAdapter;
  #state: AuthState = { state: 'disconnected' };
  #lifecycle: ModuleLifecycleState = 'open';
  #lifetime = new AbortController();
  #authentication?: Promise<AuthState>;
  #shutdown?: Promise<void>;

  constructor(options: MowerOptions) {
    this.#options = {
      credentials: { ...options.credentials },
      sessionStore: options.sessionStore,
      adapter: options.adapter,
    };
  }

  get lifecycle(): ModuleLifecycleState {
    return this.#lifecycle;
  }

  get connected(): boolean {
    return (
      this.#lifecycle === 'open' && this.#state.state === 'connected' && !!this.#adapter?.connected
    );
  }

  get authState(): AuthState {
    if (this.#lifecycle !== 'open') return { state: 'disconnected' };
    if (this.#state.state === 'connected' && !this.connected) return { state: 'disconnected' };
    return authState(this.#state);
  }

  connect(answer?: AuthAnswer, signal?: AbortSignal): Promise<AuthState> {
    if (this.#lifecycle !== 'open') return Promise.reject(new EufyError('client_closed'));
    if (this.#authentication) return Promise.reject(new EufyError('authentication_busy'));
    const abort = AbortSignal.any([this.#lifetime.signal, ...(signal ? [signal] : [])]);
    const operation = Promise.resolve().then(async () => {
      try {
        if (abort.aborted) throw new EufyError('request_aborted');
        if (!this.#adapter) {
          if (!this.#options.adapter) throw new EufyError('mower_protocol_unavailable');
          this.#adapter = this.#options.adapter({
            credentials: { ...this.#options.credentials },
            sessionStore: this.#options.sessionStore,
          });
        }
        const state = authState(await this.#adapter.connect(answer, abort));
        if (abort.aborted) throw new EufyError('request_aborted');
        if (state.state === 'connected' && !this.#adapter.connected)
          throw new EufyError('invalid_auth_state');
        this.#state = state;
        return authState(state);
      } catch (error) {
        this.#state = { state: 'disconnected' };
        throw mowerError(error);
      }
    });
    this.#authentication = operation;
    return operation.finally(() => {
      if (this.#authentication === operation) this.#authentication = undefined;
    });
  }

  shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    this.#lifecycle = 'closing';
    this.#lifetime.abort();
    this.#state = { state: 'disconnected' };
    this.#shutdown = this.#finishShutdown();
    return this.#shutdown;
  }

  async #finishShutdown(): Promise<void> {
    try {
      const [closed] = await Promise.allSettled([
        Promise.resolve().then(() => this.#adapter?.shutdown()),
        this.#authentication,
      ]);
      if (closed.status === 'rejected') throw new EufyError('shutdown_incomplete');
    } finally {
      this.#lifecycle = 'closed';
    }
  }

  close(): Promise<void> {
    return this.shutdown();
  }
}

/** Each bridge constructs its own client with only the module it owns. */
export class EufyClient {
  readonly security?: SecurityModule;
  readonly mowers?: MowerModule;
  #shutdown?: Promise<void>;

  constructor(options: EufyClientOptions = {}) {
    if (
      options.security &&
      options.mowers &&
      Object.is(options.security.sessionStore, options.mowers.sessionStore)
    )
      throw new EufyError('shared_session_store');
    if (options.security) this.security = new SecurityClient(options.security);
    if (options.mowers) this.mowers = new Mowers(options.mowers);
  }

  shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    this.#shutdown = Promise.allSettled([this.security?.shutdown(), this.mowers?.shutdown()]).then(
      (results) => {
        if (results.some((result) => result.status === 'rejected'))
          throw new EufyError('shutdown_incomplete');
      },
    );
    return this.#shutdown;
  }

  close(): Promise<void> {
    return this.shutdown();
  }
}
