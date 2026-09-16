import type { EufyMegaClient } from './client.js';
import type { AuthAnswer, AuthState, ClientOptions, Credentials } from './types.js';

export type ModuleLifecycleState = 'open' | 'closing' | 'closed';

/** Authentication and resource ownership belong to one module only. */
export interface ModuleLifecycle {
  readonly lifecycle: ModuleLifecycleState;
  readonly connected: boolean;
  readonly authState: AuthState;
  connect(answer?: AuthAnswer, signal?: AbortSignal): Promise<AuthState>;
  shutdown(): Promise<void>;
  close(): Promise<void>;
}

/** The existing camera API, with independent authentication and lifecycle state. */
export interface SecurityModule
  extends Pick<EufyMegaClient, keyof EufyMegaClient>, ModuleLifecycle {}

/** Opaque secret persistence, never a device identifier, result or diagnostic. */
export interface MowerSession {
  version: 1;
  data: string;
}

export interface MowerSessionStore {
  load(): Promise<MowerSession | undefined>;
  save(session: MowerSession): Promise<void>;
}

export interface MowerAdapterContext {
  credentials: Credentials;
  sessionStore: MowerSessionStore;
}

/**
 * Library-owned adapter contract, without SDK objects or protocol commands.
 * Implementations own account-bound session restore, expiry and persistence.
 * connect must honor cancellation. shutdown must cancel work and flush writes.
 * Neither operation may automatically replay a physical command.
 */
export interface MowerAdapter {
  readonly connected: boolean;
  connect(answer: AuthAnswer | undefined, signal: AbortSignal): Promise<AuthState>;
  shutdown(): Promise<void>;
  discover?(signal: AbortSignal): Promise<MowerDevice[]>;
}

export interface MowerHomeOptions {
  requestTimeoutMs?: number;
  /** Injectable for deterministic tests. Receives private HTTP data. */
  fetch?: typeof fetch;
}

export interface MowerDevice {
  id: string;
  kind: 'mower';
  model: 'E15';
  productCode: 'T2880';
}

export interface MowerOptions extends MowerAdapterContext {
  home?: MowerHomeOptions;
  /** Created lazily once per module. Return a fresh adapter for each client. */
  adapter?: (context: MowerAdapterContext) => MowerAdapter;
}

/** Options for one read-only local session. The host is the mower's LAN address. */
export interface MowerLocalSessionOptions {
  host: string;
  /** Tuya LAN protocol port, default 6668. */
  port?: number;
  /** Deadline for connecting, key negotiation and each query, default 5000 ms. */
  timeoutMs?: number;
}

/** A JSON value exactly as the device reported it. Interpretation belongs to later telemetry work. */
export type MowerDpValue =
  boolean | number | string | null | MowerDpValue[] | { [key: string]: MowerDpValue };

/** Raw data points from one local query. Values may contain private data; do not log them. */
export interface MowerDpSnapshot {
  source: 'local-tuya-3.5';
  /** Local receipt time as an ISO 8601 UTC timestamp, not device time. */
  observedAt: string;
  dps: Record<string, MowerDpValue>;
}

export type MowerLocalSessionEnd =
  | 'disconnected'
  | 'shutdown'
  | 'aborted'
  | 'timeout'
  | 'peer_closed'
  | 'connection_failed'
  | 'authentication_failed'
  | 'protocol_error';

/** One authenticated TCP session to one E15. Read-only: no DP writes, commands or settings. */
export interface MowerLocalSession {
  readonly connected: boolean;
  /** Resolves once the socket is closed and all owned resources are released. */
  readonly closed: Promise<MowerLocalSessionEnd>;
  queryStatus(signal?: AbortSignal): Promise<MowerDpSnapshot>;
  /** Idempotent. Resolves when the socket has actually closed. */
  disconnect(): Promise<void>;
}

/** Protocol features will be added by their owning stories after evidence review. */
export interface MowerModule extends ModuleLifecycle {
  discover(signal?: AbortSignal): Promise<MowerDevice[]>;
  /**
   * Open a read-only local Tuya 3.5 session to one discovered mower. The private local key is
   * used only during key negotiation inside the verified cloud binding and is then discarded.
   */
  openLocalSession(
    id: string,
    options: MowerLocalSessionOptions,
    signal?: AbortSignal,
  ): Promise<MowerLocalSession>;
}

export interface EufyClientOptions {
  /** Omit or set false when this installation has no security module. */
  security?: ClientOptions | false;
  /** Omit or set false when this installation has no mower module. */
  mowers?: MowerOptions | false;
}
