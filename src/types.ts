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
/** Discovery is software evidence. Owner IDs are stable device IDs, never credentials. */
export type DeviceRelationship =
  | { kind: 'station'; ownerId: string }
  | { kind: 'standalone'; ownerId: string; reason: 'standalone_transport_unverified' }
  | { kind: 'unsupported'; reason: 'invalid_device_relationship' | 'unsupported_station' };
export interface DiscoveryIssue {
  index: number;
  deviceId: string | null;
  /** Unsupported-device diagnostics only. Exact T + four uppercase ASCII letters/digits. */
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
  metadata: MediaMetadata;
  video: import('node:stream').Readable;
  audio: import('node:stream').Readable;
  ended: Promise<StreamStop>;
  stop(): Promise<StreamStop>;
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
