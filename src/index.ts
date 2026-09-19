export { EufyMegaClient } from './client.js';
export { FileSessionStore } from './session.js';
export { EufyError } from './types.js';
export type { DownloadResult, RecordingDownload, EventStatus, ClientEvents } from './types.js';
export type {
  AuthState,
  AuthAnswer,
  Credentials,
  Device,
  CameraCapabilities,
  CameraMediaCapability,
  DeviceRelationship,
  DiscoveryIssue,
  DiscoveryResult,
  ClientOptions,
  Diagnostic,
  Session,
  SessionStore,
  StationState,
  Snapshot,
  MediaMetadata,
  StreamStop,
  LiveStream,
  LiveStartOptions,
  Recording,
  DetectionEvent,
  EventSession,
} from './types.js';
export { EufyClient } from './eufy-client.js';
export type {
  EufyClientOptions,
  ModuleLifecycle,
  ModuleLifecycleState,
  SecurityModule,
  MowerModule,
  MowerOptions,
  MowerDevice,
  MowerHomeOptions,
  MowerAdapter,
  MowerAdapterContext,
  MowerSession,
  MowerSessionStore,
  MowerLocalSessionOptions,
  MowerLocalSession,
  MowerLocalSessionEnd,
  MowerDpSnapshot,
  MowerDpReport,
  MowerDpValue,
  MowerDpPropertyType,
  MowerDpSchemaEntry,
  MowerTelemetryLevel,
  MowerActivity,
  MowerNetworkKind,
  MowerTelemetryFieldName,
  MowerTelemetryDefinition,
  MowerTelemetryField,
  MowerTelemetryValue,
  MowerTelemetry,
  MowerTelemetryOptions,
  MowerWireField,
  MowerWireFault,
  MowerWirePayload,
} from './modular-types.js';
export { decodeMowerTelemetry } from './mowers/telemetry/decode.js';
export { E15_TELEMETRY_DEFINITIONS } from './mowers/telemetry/definitions.js';
export { parseMowerWirePayload } from './mowers/telemetry/wire.js';
export { PortableMapAcquisition } from './mowers/maps/acquisition.js';
export type {
  MapSessionProvisioning,
  MapStreamName,
  MapAcquisitionSnapshot,
  MapAcquisitionDemand,
  MapAcquisitionResult,
  MapAcquisitionEnd,
} from './mowers/maps/types.js';
