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
  /** Physical control stays off unless this explicit opt-in is present and valid. */
  commands?: MowerCommandOptions;
  /** Setting writes stay off unless this explicit opt-in is present and valid. */
  settings?: MowerSettingsOptions;
}

/**
 * Explicit per-client opt-in for physical control. Without it every `sendCommand()` call is
 * refused with `mower_commands_disabled`. Nothing here is persisted or sent to the device.
 */
export interface MowerCommandOptions {
  /** Must be literally `true`. */
  enabled: true;
  /**
   * The consumer's own stop route in words, for example "pause then return through this
   * session with the official app at hand". Required, 1 to 200 printable characters. The
   * library never executes it and never retries or replays a command on the consumer's behalf.
   */
  stopRoute: string;
  /** Bound for the read-back after every write, default 10000 ms, 1000 to 60000. */
  readBackMs?: number;
}

export type MowerCommandKind = 'start' | 'pause' | 'resume' | 'stop' | 'return';

export interface MowerCommandRequest {
  kind: MowerCommandKind;
  /** Overrides the opt-in read-back bound for this command only, 1000 to 60000 ms. */
  readBackMs?: number;
  /**
   * Called synchronously for each fresh progress observation while the read-back runs, so a
   * consumer can show what the mower does before the outcome arrives. Errors it throws are
   * ignored. It cannot change, end, retry or replay the command, and the outcome stays the
   * only result.
   */
  onProgress?: (progress: MowerCommandProgress) => void;
}

/**
 * One fresh observation during a command's read-back. `acknowledged` is the first report
 * carrying the class's control point or the written point at its value, as in the outcome.
 * `activity` is every fresh DP 107 report that decodes to a confirmed activity, for example
 * `returning` within a second of a `stop`, long before its map-saving reflection.
 */
export type MowerCommandProgress =
  | { kind: 'acknowledged'; observedAt: string; sequence: number; dp: string }
  | { kind: 'activity'; observedAt: string; sequence: number; value: MowerActivity };

/** The one declared boolean data point written for a command class. See docs/MOWER_COMMANDS.md. */
export interface MowerCommandWrite {
  dp: string;
  code: string;
  value: boolean;
}

/** Furthest stage evidenced by fresh reports. A sent command is never `completed`. */
export type MowerCommandStage = 'sent' | 'acknowledged' | 'reflected';
/** Why the read-back ended. Only `reflected` means the expected activity was reported. */
export type MowerCommandEnd = 'reflected' | 'rejected' | 'timed_out' | 'report_limit';

/** Lifecycle of one command from fresh reports only. Nothing is inferred from age or silence. */
export interface MowerCommandOutcome {
  command: MowerCommandKind;
  write: MowerCommandWrite;
  /** The status query taken immediately before the write. The refusals are decided on it. */
  before: MowerDpSnapshot;
  /** Local time the control frame was written to the socket. */
  sentAt: string;
  stage: MowerCommandStage;
  end: MowerCommandEnd;
  /** The device's frame reply to the control command, when one arrived during the read-back. */
  reply?: { observedAt: string; returnCodeZero: boolean; rejected: boolean };
  /** First fresh report carrying the class's control point or the written point at its value. */
  acknowledgement?: { observedAt: string; sequence: number; dp: string };
  /** First fresh DP 107 report that decodes to the expected confirmed activity, for the classes that expect one. */
  activity?: { observedAt: string; sequence: number; value: MowerActivity };
  /**
   * First fresh DP 107 report whose wire records equal the class's expected payload. Only `stop`
   * uses this: its reflection is the map-saving payload (fields 2 = 5 and 3 = 1), not an activity.
   */
  payload?: { observedAt: string; sequence: number; name: 'map_saving' };
  /** Every report received during the read-back in arrival order, at most 64. */
  reports: MowerDpReport[];
}

/**
 * Explicit per-client opt-in for setting writes, separate from `commands`. Without it every
 * `setSetting()` call is refused with `mower_settings_disabled`. Reading settings needs no
 * opt-in. Nothing here is persisted or sent to the device.
 */
export interface MowerSettingsOptions {
  /** Must be literally `true`. */
  enabled: true;
  /** Bound for the read-back after every write, default 10000 ms, 1000 to 60000. */
  readBackMs?: number;
}

/**
 * The settings the library reads, named after the device's declared codes. `mowHeight`,
 * `volume`, `smartNoGoZones` and `sparseLawnOptimization` can be written behind the opt-in.
 * `rainAutoReturn`, `childLock` and `birdViewCapture` are read only and never written.
 * Data points and sources: docs/MOWER_SETTINGS.md.
 */
export type MowerSettingName =
  | 'mowHeight'
  | 'volume'
  | 'smartNoGoZones'
  | 'sparseLawnOptimization'
  | 'rainAutoReturn'
  | 'childLock'
  | 'birdViewCapture';

export type MowerSettingValue = boolean | number;

/** One setting from one snapshot. Nothing is inferred when the point is absent or invalid. */
export type MowerSettingField =
  | {
      state: 'reported';
      dp: string;
      type: 'bool' | 'value';
      value: MowerSettingValue;
      /**
       * True when the library writes this setting and the device declares the point writable
       * with the expected code and type. The client's settings opt-in is reported separately.
       */
      writable: boolean;
      /** Value settings only: the app's own input bound narrowed by the device's declaration. */
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
    }
  | { state: 'missing'; dp: string }
  | { state: 'invalid'; dp: string };

/** Typed settings decoded from one local snapshot. */
export interface MowerSettings {
  source: 'local-tuya-3.5';
  /** Receipt time of the snapshot, not device time. */
  observedAt: string;
  settings: Record<MowerSettingName, MowerSettingField>;
}

export interface MowerSettingsDecodeOptions {
  /** The session's declared data points. Without it no setting reads as writable. */
  schema?: readonly MowerDpSchemaEntry[];
}

export interface MowerSettingRequest {
  name: MowerSettingName;
  /** A boolean for a switch setting, an integer within the setting's bound for a value setting. */
  value: MowerSettingValue;
  /** Overrides the opt-in read-back bound for this write only, 1000 to 60000 ms. */
  readBackMs?: number;
}

/** The one declared data point written for a setting. See docs/MOWER_SETTINGS.md. */
export interface MowerSettingWrite {
  dp: string;
  code: string;
  value: MowerSettingValue;
}

/** Furthest stage evidenced by fresh reports. A sent setting is never `completed`. */
export type MowerSettingStage = 'sent' | 'reflected';
/** Why the read-back ended. Only `reflected` means the device reported the written value. */
export type MowerSettingEnd = 'reflected' | 'rejected' | 'timed_out' | 'report_limit';

/** Lifecycle of one setting write from fresh reports only. Nothing is inferred from silence. */
export interface MowerSettingOutcome {
  setting: MowerSettingName;
  write: MowerSettingWrite;
  /** The status query taken immediately before the write. The refusals are decided on it. */
  before: MowerDpSnapshot;
  /** The setting's value on that query, the value a deliberate restore writes back. */
  previous: MowerSettingValue;
  /** Local time the control frame was written to the socket. */
  sentAt: string;
  stage: MowerSettingStage;
  end: MowerSettingEnd;
  /** The device's frame reply to the control command, when one arrived during the read-back. */
  reply?: { observedAt: string; returnCodeZero: boolean; rejected: boolean };
  /** First fresh report that carried the written point at the written value. */
  reflection?: { observedAt: string; sequence: number; value: MowerSettingValue };
  /** Latest fresh report that carried the written point at another value, when one arrived. */
  other?: { observedAt: string; sequence: number; value: MowerDpValue };
  /** Every report received during the read-back in arrival order, at most 64. */
  reports: MowerDpReport[];
}

/** Options for one read-only local session. The host is the mower's LAN address. */
export interface MowerLocalSessionOptions {
  host: string;
  /** Tuya LAN protocol port, default 6668. */
  port?: number;
  /** Deadline for connecting, key negotiation and each query/report read, default 5000 ms. */
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

/** One spontaneous LAN report. No queried or previously merged device cache is substituted. */
export interface MowerDpReport extends MowerDpSnapshot {
  kind: 'device-report';
  /** Device frame counter. It may be zero and does not correlate with a request sequence. */
  sequence: number;
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
        | { kind: 'boolean'; on: MowerActivity; off: MowerActivity }
        | {
            /**
             * One candidate reading of a raw wire-format payload. Every listed field number
             * must be a varint with exactly the given value. An absent field counts as zero.
             * Other fields are ignored. An empty `match` is an invalid definition.
             */
            kind: 'wire';
            match: Record<number, number>;
            activity: MowerActivity;
          }
        | {
            /**
             * A mission status message read by its fields: 1 mission, 2 sub-mission, 3 state
             * (1 running, 2 paused) and 5 an error flag, each a varint, an absent field counting
             * as zero. A running or paused mission listed in `mowing` reads `mowing` or
             * `paused`, a running mission listed in `returning` reads `returning`, and a message
             * without mission, sub-mission, state or error flag, the empty or single-zero-byte
             * payload included, reads `idle`. Anything else is not claimed.
             */
            kind: 'mission_status';
            mowing: readonly number[];
            returning: readonly number[];
          };
    }
  | { field: 'battery' | 'progress'; decode: { kind: 'percent' } }
  | {
      field: 'network';
      decode:
        | { kind: 'enum'; values: Record<string, MowerNetworkKind> }
        | { kind: 'signal_dbm' }
        | { kind: 'signal_percent' };
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
  /**
   * Structural parse of a raw payload named by a `wire` definition of any level. It exposes
   * field numbers and values, never a meaning. See docs/MOWER_TELEMETRY.md.
   */
  wire?: MowerWirePayload;
}

/** One record of a wire-format payload. `bytes`, `fixed32` and `fixed64` are copied, not decoded. */
export type MowerWireField =
  | { number: number; wire: 'varint'; value: number }
  | { number: number; wire: 'bytes' | 'fixed32' | 'fixed64'; value: Uint8Array };

export type MowerWireFault =
  | 'not_text'
  | 'not_base64'
  | 'too_long'
  | 'truncated'
  | 'field_number'
  | 'wire_type'
  | 'varint'
  | 'too_many_fields';

/**
 * A raw data point decoded from base64 into wire-format records. `fields` is a well-formed
 * record sequence, `default` is the observed empty or single-zero-byte payload with no
 * records, and `malformed` names the first fault. No field meaning is attached.
 */
export type MowerWirePayload =
  | { shape: 'fields'; byteLength: number; fields: MowerWireField[] }
  | { shape: 'default'; byteLength: number; fields: [] }
  | { shape: 'malformed'; byteLength: number; reason: MowerWireFault };

/** Typed view of one snapshot. Nothing is inferred from age or absence. */
export interface MowerTelemetry {
  source: 'local-tuya-3.5';
  observedAt: string;
  status: MowerTelemetryField<MowerActivity>;
  battery: MowerTelemetryField<{ percent: number }>;
  progress: MowerTelemetryField<{ percent: number }>;
  network: MowerTelemetryField<{
    kind?: MowerNetworkKind;
    signalDbm?: number;
    /** Device-declared signal percentage, not an inferred dBm measurement. */
    signalPercent?: number;
  }>;
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

/**
 * One authenticated TCP session to one E15. Reads never write. Commands exist only behind the
 * explicit `commands` opt-in and write one declared boolean point each. Settings exist only
 * behind the separate `settings` opt-in and write one declared setting point each.
 */
export interface MowerLocalSession {
  readonly connected: boolean;
  /** True only when the owning client opted in with valid `MowerCommandOptions`. */
  readonly commandsEnabled: boolean;
  /** True only when the owning client opted in with valid `MowerSettingsOptions`. */
  readonly settingsEnabled: boolean;
  /** Resolves once the socket is closed and all owned resources are released. */
  readonly closed: Promise<MowerLocalSessionEnd>;
  /** Copy of the device's declared data points from discovery, when the cloud supplied one. */
  readonly schema: MowerDpSchemaEntry[] | undefined;
  queryStatus(signal?: AbortSignal): Promise<MowerDpSnapshot>;
  /** One status query decoded with the session schema and the library's E15 definitions. */
  queryTelemetry(signal?: AbortSignal): Promise<MowerTelemetry>;
  /**
   * Receive one command-8 report within the session timeout. Does not query or refresh DPs.
   * A transport heartbeat keeps a pending read alive. Receipt time is when the full frame
   * arrived, including when it arrived before this call. Consumers must check that time.
   */
  receiveReport(signal?: AbortSignal): Promise<MowerDpReport>;
  /**
   * Send one opt-in command and read its lifecycle back from fresh reports within the bound.
   * One fresh status query precedes the write and decides the typed refusals. One command owns
   * the session at a time. Nothing is retried, replayed or reconnected. Resolves `timed_out`
   * rather than throwing when the bound passes, because the write has already happened.
   */
  sendCommand(request: MowerCommandRequest, signal?: AbortSignal): Promise<MowerCommandOutcome>;
  /** One status query decoded into typed settings with the session schema. Never writes. */
  querySettings(signal?: AbortSignal): Promise<MowerSettings>;
  /**
   * Write one opt-in setting and read it back from fresh reports within the bound. One fresh
   * status query precedes the write and decides the typed refusals. Rain and child protection
   * are never written. Nothing is retried, replayed or reconnected, and a restore is a separate
   * deliberate call. Resolves `timed_out` rather than throwing when the bound passes.
   */
  setSetting(request: MowerSettingRequest, signal?: AbortSignal): Promise<MowerSettingOutcome>;
  /** Idempotent. Resolves when the socket has actually closed. */
  disconnect(): Promise<void>;
}

/** Protocol features will be added by their owning stories after evidence review. */
export interface MowerModule extends ModuleLifecycle {
  /** True only when this client was constructed with a valid `commands` opt-in. */
  readonly commandsEnabled: boolean;
  /** True only when this client was constructed with a valid `settings` opt-in. */
  readonly settingsEnabled: boolean;
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
