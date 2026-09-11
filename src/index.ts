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
} from './modular-types.js';
export { PortableMapAcquisition } from './mowers/maps/acquisition.js';
export type {
  MapSessionProvisioning,
  MapStreamName,
  MapAcquisitionSnapshot,
  MapAcquisitionDemand,
  MapAcquisitionResult,
  MapAcquisitionEnd,
} from './mowers/maps/types.js';
