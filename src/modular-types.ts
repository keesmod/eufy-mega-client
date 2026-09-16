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

/** Property types of a Tuya data point as declared by the product definition. */
export type MowerDpPropertyType = 'bool' | 'value' | 'enum' | 'string' | 'bitmap' | 'raw';

/** One data-point declaration from the device's own cloud schema. Product metadata, not a secret. */
export interface MowerDpSchemaEntry {
  /** Same key space as `MowerDpSnapshot.dps`. */
  id: string;
  /** Product function identifier, when the cloud supplies it. */
  code?: string;
  mode: 'ro' | 'rw' | 'wr';
  type: MowerDpPropertyType;
  min?: number;
  max?: number;
  scale?: number;
  step?: number;
  unit?: string;
  range?: string[];
  maxlen?: number;
}

export type MowerTelemetryLevel = 'hypothesis' | 'observed' | 'confirmed';
export type MowerActivity =
  'mowing' | 'paused' | 'returning' | 'charging' | 'docked' | 'idle' | 'error' | 'unknown';
export type MowerNetworkKind = 'wifi' | 'cellular' | 'ethernet' | 'none';
export type MowerTelemetryFieldName = 'status' | 'battery' | 'progress' | 'network';

/**
 * Binds one typed field to one data point. Only `confirmed` definitions produce values.
 * `source` names the evidence recorded in docs/MOWER_TELEMETRY.md.
 */
export type MowerTelemetryDefinition = {
  dp: string;
  level: MowerTelemetryLevel;
  source: string;
} & (
  | {
      field: 'status';
      decode:
        | { kind: 'enum'; values: Record<string, MowerActivity> }
        | { kind: 'boolean'; on: MowerActivity; off: MowerActivity };
    }
  | { field: 'battery' | 'progress'; decode: { kind: 'percent' } }
  | {
      field: 'network';
      decode: { kind: 'enum'; values: Record<string, MowerNetworkKind> } | { kind: 'signal_dbm' };
    }
);

export type MowerTelemetryField<T> =
  | { state: 'reported'; value: T; dp: string[]; source: 'local-tuya-3.5'; observedAt: string }
  | { state: 'missing'; dp: string[] }
  | { state: 'invalid'; dp: string[] }
  | { state: 'unconfirmed'; level?: MowerTelemetryLevel };

/** One reported data point resolved through the device schema. `valid` exists only when declared. */
export interface MowerTelemetryValue {
  id: string;
  value: MowerDpValue;
  declared: boolean;
  code?: string;
  type?: MowerDpPropertyType;
  valid?: boolean;
  unit?: string;
  /** Declared value divided by ten to the power of the declared scale. */
  scaled?: number;
}

/** Typed view of one snapshot. Nothing is inferred from age or absence. */
export interface MowerTelemetry {
  source: 'local-tuya-3.5';
  observedAt: string;
  status: MowerTelemetryField<MowerActivity>;
  battery: MowerTelemetryField<{ percent: number }>;
  progress: MowerTelemetryField<{ percent: number }>;
  network: MowerTelemetryField<{ kind?: MowerNetworkKind; signalDbm?: number }>;
  /** Every reported data point, keyed by id, typed by the device's own declaration. */
  fields: Record<string, MowerTelemetryValue>;
  /** Raw pass-through, copied from the snapshot. */
  dps: Record<string, MowerDpValue>;
}

export interface MowerTelemetryOptions {
  schema?: readonly MowerDpSchemaEntry[];
  definitions?: readonly MowerTelemetryDefinition[];
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
  /** Copy of the device's declared data points from discovery, when the cloud supplied one. */
  readonly schema: MowerDpSchemaEntry[] | undefined;
  queryStatus(signal?: AbortSignal): Promise<MowerDpSnapshot>;
  /** One status query decoded with the session schema and the library's E15 definitions. */
  queryTelemetry(signal?: AbortSignal): Promise<MowerTelemetry>;
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
