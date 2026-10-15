import type { MegaIdentity } from './crypto.js';

export class EufyError extends Error {
  constructor(
    readonly code: string,
    readonly remoteCode?: number,
  ) {
    super(remoteCode === undefined ? code : `${code} (${remoteCode})`);
    this.name = 'EufyError';
  }
}

export type AuthState =
  | { state: 'disconnected' | 'connected' | 'verification_required' | 'locked' }
  | { state: 'captcha_required'; captchaId: string; image: string };
export interface Credentials {
  email: string;
  password: string;
  country: string;
}
export type AuthAnswer = { verifyCode: string } | { captchaId: string; answer: string };
/** Secret material. Store privately; never include this object in diagnostics. */
export interface Session {
  version: 1;
  country: string;
  deviceId: string;
  accountHash: string;
  phase: 'authenticated' | 'verification' | 'captcha' | 'locked' | 'new';
  domain?: string;
  token?: string;
  userId?: string;
  expiresAt?: number;
  identities: Record<string, MegaIdentity>;
  events?: EventSession;
}
export interface SessionStore {
  load(): Promise<Session | undefined>;
  save(session: Session): Promise<void>;
}
/** Software admission only. Availability does not establish hardware validation. */
export interface CameraMediaCapability {
  available: boolean;
  status: 'experimental' | 'unsupported';
  reason: string | null;
}
export interface CameraCapabilities {
  snapshot: CameraMediaCapability;
  live: CameraMediaCapability;
  recordings: CameraMediaCapability;
}
export interface Device {
  id: string;
  stationId: string;
  kind: 'station' | 'camera';
  model: string;
  name: string;
  firmware: string | null;
  hardware: string | null;
  battery: number | null;
  /** Last reported device status, not reachability inferred from its HomeBase. */
  availability?: 'online' | 'offline' | 'disabled' | null;
}
/**
 * Which connection fields a standalone inventory row carries. Presence only, never
 * values. A present field is not proof that it is valid or authenticates.
 */
export interface StandaloneDescriptor {
  /** The P2P device ID. */
  did: boolean;
  /** The P2P license. */
  license: boolean;
  /** The administrator user ID of the account's membership. */
  adminUser: boolean;
  /** A private IPv4 LAN address in the row. */
  lanAddress: boolean;
}
/** Discovery is software evidence. Owner IDs are stable device IDs, never credentials. */
export type DeviceRelationship =
  | { kind: 'station'; ownerId: string }
  | {
      kind: 'standalone';
      ownerId: string;
      reason: 'standalone_transport_unverified';
      descriptor: StandaloneDescriptor;
    }
  /** Admitted only with the `experimentalStandalone` option. Unverified on hardware. */
  | {
      kind: 'standalone';
      ownerId: string;
      transport: 'experimental';
      descriptor: StandaloneDescriptor;
    }
  | { kind: 'unsupported'; reason: 'invalid_device_relationship' | 'unsupported_station' };
export interface DiscoveryIssue {
  index: number;
  deviceId: string | null;
  /**
   * Unsupported-device diagnostics only. At most eight characters: T, four uppercase ASCII
   * letters/digits, then optionally one to three more or a hyphen and one or two more.
   */
  deviceModel?: string;
  /** Unsupported-device diagnostics only. Integer in 0..65535, never coerced. */
  deviceType?: number;
  /** Bounded received context. parentId is private, like deviceId. Never log either ID. */
  context?: {
    firmware?: string;
    hardware?: string;
    parentStatus: 'none' | 'self' | 'present' | 'missing' | 'ambiguous' | 'invalid';
    parentId?: string;
    parentModel?: string;
    parentFirmware?: string;
  };
  code:
    | 'invalid_device_identity'
    | 'invalid_device_relationship'
    | 'unsupported_device'
    | 'unsupported_station'
    | 'standalone_transport_unverified';
}
export interface DiscoveryResult {
  devices: Device[];
  relationships: (DeviceRelationship & { deviceId: string })[];
  issues: DiscoveryIssue[];
}
export interface Diagnostic {
  operation: string;
  host: string;
  path: string;
  elapsedMs: number;
  status?: number;
  code?: number;
}
export interface ClientOptions {
  credentials: Credentials;
  sessionStore: SessionStore;
  requestTimeoutMs?: number;
  minRequestIntervalMs?: number;
  /**
   * Concurrent live streams per station, 1 to 4, default 1. Above 1, every
   * further concurrent live camera on a station uses its own P2P session.
   */
  maxLiveStreamsPerStation?: number;
  /**
   * Ceiling for the per-start live bound in milliseconds, 120000 to 3600000,
   * default 120000. A start may request up to this value with `maxDurationMs`.
   */
  liveUpperBoundMs?: number;
  /**
   * Opt-in, default false. Standalone cameras whose exact profile allows it
   * become their own P2P owner on the local LAN-derived route, with snapshot,
   * live and recordings. Unverified on hardware. See docs/API.md.
   */
  experimentalStandalone?: boolean;
  diagnostics?: (event: Diagnostic) => void;
  /** Injectable for deterministic protocol tests. */
  fetch?: typeof fetch;
}

/** Private wire data. These values are not returned by the public client API. */
export interface WireDevice extends Record<string, unknown> {
  device_sn: string;
  parent_sn: string;
  device_model: string;
  device_name: string;
  device_type: number;
  device_channel: number;
  category: string;
  p2p_did: string;
  p2p_license: string;
  member: { admin_user_id: string; [key: string]: unknown };
  params: { param_type: number; param_value: string; update_time?: number }[] | null;
}

export interface StationState {
  id: string;
  connected: boolean;
  guardMode: number | null;
  currentMode: number | null;
  alarm: boolean;
  alarmDelay: number;
  armDelay: number;
  commandEncryption: 'lan-derived' | 'cipher' | null;
}
export interface Snapshot {
  deviceId: string;
  data: Buffer;
  mime: 'image/jpeg';
  receivedAt: string;
}
export interface MediaMetadata {
  videoCodec: 'h264' | 'h265' | 'unknown';
  audioCodec: 'aac' | 'aac-lc' | 'aac-eld' | 'none' | 'unknown';
  fps: number;
  width: number;
  height: number;
}
export interface StreamStop {
  confirmed: boolean;
  reason: 'device' | 'connection_lost' | 'timeout' | 'shutdown';
}
export interface LiveStream {
  id: string;
  deviceId: string;
  /** Current observed codecs. Audio may become known after bounded video startup. */
  metadata: MediaMetadata;
  video: import('node:stream').Readable;
  audio: import('node:stream').Readable;
  ended: Promise<StreamStop>;
  stop(): Promise<StreamStop>;
}
export interface LiveStartOptions {
  signal?: AbortSignal;
  /**
   * Upper bound for this stream in milliseconds, 1000 up to the client's
   * `liveUpperBoundMs`, default 120000. The library sends STOP at the bound.
   */
  maxDurationMs?: number;
  /**
   * Called synchronously once per stage of this start, from the call until the
   * start resolves, fails or is cancelled, so a consumer can record how far a
   * start without media got. Errors it throws are ignored. It cannot change,
   * end or retry the start. See docs/API.md, live start stages.
   */
  onProgress?: (progress: LiveStartProgress) => void;
}
/**
 * `session_ready`: the P2P session that carries the stream is connected and
 * encrypted. `start_issued`: START was handed to that session.
 * `start_result`: the station answered START, with `returnCode`.
 * `no_data_end`: the P2P library ended the stream because no media followed.
 * `metadata`: the stream's metadata arrived and the start resolves.
 */
export type LiveStartStage =
  'session_ready' | 'start_issued' | 'start_result' | 'no_data_end' | 'metadata';
/** One stage of a live start. No identifiers, and every value is bounded. */
export interface LiveStartProgress {
  stage: LiveStartStage;
  /** Milliseconds since the `startLive` call, 0 to 3600000. */
  elapsedMs: number;
  /** Only with `start_result`: the station's numeric return code, 0 for success. */
  returnCode?: number;
}
/**
 * `lookup`: the station connection started and its local lookup is about to begin.
 * `station_found`: the station answered the lookup with its own DID.
 * `session_open`: the station answered the session handshake.
 * `encryption_ready`: the command key is in place and the connection resolves.
 */
export type StationConnectionStage =
  'lookup' | 'station_found' | 'session_open' | 'encryption_ready';
/** One stage of a station connection. No identifiers or addresses. */
export interface StationConnectionProgress {
  stage: StationConnectionStage;
  /** Milliseconds since this connection attempt started, 0 to 3600000. */
  elapsedMs: number;
  /**
   * Only with `lookup`: whether the station's session was created with a private
   * LAN address from the inventory.
   */
  inventoryAddress?: boolean;
}
/**
 * What the local lookup of one connection attempt saw. No DID, address, port,
 * serial or interface name. Counts saturate at 999 unless stated.
 * See docs/API.md, station lookup observation.
 */
export interface StationLookupObservation {
  /** Lookup rounds sent, 0 to 99. A round with no target is not counted. */
  rounds: number;
  /** Directed broadcast targets of the latest round, 0 to 16. */
  broadcastTargets: number;
  /** Whether the session socket accepted broadcasts. False when the attempt ran no lookup. */
  broadcastEnabled: boolean;
  /** Lookup sends that failed. */
  sendErrors: number;
  /** Datagrams received on the session socket while the lookup ran. */
  datagrams: number;
  /** Of those, datagrams that are not lookup replies. */
  otherHeaders: number;
  /** Lookup replies carrying the station's own DID. */
  ownReplies: number;
  /** Only with an own reply: the latest round sent when the first one arrived, 0 to 99. */
  ownRound?: number;
  /** Replies carrying the DID of another device or station in this inventory. */
  accountReplies: number;
  /** Replies carrying a DID that is not in this inventory. */
  foreignReplies: number;
  /** Replies that are not own but match the own DID after normalisation. */
  nearReplies: number;
  /** Class of the first reply from the inventory address, `none` without one. */
  inventoryReply: 'none' | 'own' | 'account' | 'foreign' | 'near';
  /**
   * Only with an inventory address: whether it lies in the IPv4 subnet of one of
   * the host's external interfaces. Absent when the interfaces cannot be read.
   */
  inventoryAddressOnSubnet?: boolean;
  /** Only with an inventory address: whether another inventory row has the same LAN address. */
  inventoryAddressShared?: boolean;
}
export interface StationConnectOptions {
  signal?: AbortSignal;
  /**
   * Called synchronously once per stage of this connection attempt, until it
   * resolves, fails or is cancelled, so a consumer can record how far a failed
   * connection got. Errors it throws are ignored. See docs/API.md, station
   * connection stages.
   */
  onProgress?: (progress: StationConnectionProgress) => void;
  /**
   * Called synchronously at most once per attempt that reached `lookup`, when it
   * resolves, fails or is cancelled. Errors it throws are ignored. It cannot
   * change the connection. See docs/API.md, station lookup observation.
   */
  onLookup?: (observation: StationLookupObservation) => void;
}
export interface Recording {
  id: string;
  deviceId: string;
  stationId: string;
  start: string;
  end: string;
  bytes: number;
  thumbnail: boolean;
}
export type RecordingOperation = 'list' | 'calendar' | 'thumbnail' | 'download';
/**
 * `admission`: input, reference and busy checks before any connection.
 * `connect`: the owner's connection was requested. `query`: the request was
 * issued on the owner's session and awaits its answer. `validate`: an answer
 * arrived and is checked. `transfer`: a download was started on the session.
 */
export type RecordingOperationStage = 'admission' | 'connect' | 'query' | 'validate' | 'transfer';
/** One database query of a recording operation. No identifiers, every number an integer. */
export interface RecordingQueryPage {
  /** Rows requested: 100, 500, 2000 or 10000 for a list, 0 for a calendar. */
  limit: number;
  /** Milliseconds from sending this page until its answer, or until the operation ended without one, 0 to 3600000. */
  elapsedMs: number;
  /** Whether an answer event for this page arrived. */
  answered: boolean;
  /**
   * Return code of the command result for this query command, clamped to
   * -999999..999999. Results of commands that were still pending when the
   * operation began are not counted. `null` without one.
   */
  ackCode: number | null;
  /** The answer's database result code (mIntRet), clamped to -999999..999999. `null` without one. */
  resultCode: number | null;
  /** Rows in the answer, 0 to 10000. `null` without an answer. */
  rows: number | null;
}
/**
 * Counts over the rows of the latest answered page of a list, each 0 to 10000.
 * `own`, `otherDevice` and `stationMismatch` divide the rows. `invalidTime`,
 * `otherDay` and `cipherId` count across them.
 */
export interface RecordingRowClasses {
  /** A camera of this owner, with the owner's station ID and a valid storage path. */
  own: number;
  /** A device that is not a known camera of this owner. */
  otherDevice: number;
  /** A camera of this owner with another station ID or an invalid storage path. */
  stationMismatch: number;
  /** A start or end time that is not a valid date. */
  invalidTime: number;
  /** A valid start time on another day than the requested one. */
  otherDay: number;
  /** A row with a cipher ID field of any value, `null` and 0 included. */
  cipherId: number;
}
/**
 * What one recording operation saw, reported once when it resolves, fails or is
 * cancelled. No serial, DID, path, name or address, and every number is a
 * bounded integer. See docs/API.md, recording operation observation.
 */
export interface RecordingObservation {
  operation: RecordingOperation;
  /** `standalone` for an experimental standalone owner, else `station`. */
  owner: 'standalone' | 'station';
  /** Whether the owner's session was connected when the operation started. */
  sessionOpen: boolean;
  /** The last stage reached. */
  stage: RecordingOperationStage;
  /** The `EufyError` code on failure, `unexpected_error` for any other error, `null` on success. */
  code: string | null;
  /** The error's numeric `remoteCode`, clamped to -999999..999999, else `null`. */
  remoteCode: number | null;
  /** Milliseconds since the operation started, 0 to 3600000. */
  elapsedMs: number;
  /** A list: one entry per page sent, at most 4. A calendar: one entry with limit 0. Otherwise empty. */
  pages: RecordingQueryPage[];
  /** Database replies the owner's session could not dispatch during this operation, 0 to 99. */
  unhandledReplies: number;
  /** Why the latest of those was not dispatched, `null` without one. */
  unhandledReason: 'unknown_cmd' | 'parse_error' | null;
  /** The numeric mIntRet of the latest of those, clamped to -999999..999999, else `null`. */
  unhandledResultCode: number | null;
  /** A list only, once an answer with a row array arrived. Otherwise `null`. */
  rowClasses: RecordingRowClasses | null;
}
export interface RecordingOperationOptions {
  signal?: AbortSignal;
  /**
   * Called synchronously exactly once, before the operation's promise settles,
   * on success and on failure, once the call reaches the client's device
   * transport. A call that fails before that, such as with
   * `authentication_required` or `client_closed`, reports nothing. Errors it
   * throws are ignored, and it cannot change the operation. See docs/API.md,
   * recording operation observation.
   */
  onObservation?: (observation: RecordingObservation) => void;
  /** Forwarded to the owner's connection when the operation has to connect. See StationConnectOptions. */
  onProgress?: (progress: StationConnectionProgress) => void;
  /** Forwarded to the owner's connection when the operation has to connect. See StationConnectOptions. */
  onLookup?: (observation: StationLookupObservation) => void;
}
export type DownloadResult =
  | { complete: true; bytes: number }
  | {
      complete: false;
      bytes: number;
      reason: 'cancelled' | 'connection_lost' | 'timeout' | 'rejected' | 'too_large';
      stopConfirmed: boolean;
    };
export interface RecordingDownload {
  id: string;
  deviceId: string;
  metadata: MediaMetadata;
  video: import('node:stream').Readable;
  audio: import('node:stream').Readable;
  completed: Promise<DownloadResult>;
  cancel(): Promise<DownloadResult>;
}
export interface EventStatus {
  connected: boolean;
  received: number;
  duplicates: number;
  lastReceivedAt: string | null;
}

/** Private opaque FCM registration. This is secret session material. */
export interface EventSession {
  version: 1;
  registration: string;
  persistentIds: string[];
  seen: Record<string, number>;
}
export interface DetectionEvent {
  id: string;
  deviceId: string;
  type: string;
  receivedAt: string;
  occurredAt: string | null;
  source: 'device' | 'push';
  personName: string | null;
  recognition: 'known' | 'unknown' | 'unidentified' | 'not_applicable';
  vendorEventType?: number;
}

/** Typed public events. No protocol SDK objects or secret session data. */
export interface ClientEvents {
  auth: [state: AuthState];
  device: [device: Device];
  station: [state: StationState];
  snapshot: [snapshot: Snapshot];
  event: [event: DetectionEvent];
  'events-connection': [connected: boolean];
  'live-stop': [result: StreamStop & { deviceId: string }];
  fault: [error: EufyError];
}
