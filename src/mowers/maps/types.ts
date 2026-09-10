/** Private, expiring provisioning. Never log or persist this through map results. */
export interface RelayToken {
  credential: string;
  username: string;
  domain: string;
  urls: string[];
  sessionId?: string;
}
export interface MqttCredentials {
  host: string;
  port: number;
  clientId: string;
  username: string;
  password: string;
}
/** Provision from the verified mower account and current RTC route before acquisition. */
export interface MapSessionProvisioning {
  expiresAt: number;
  accountUid: string;
  peer: string;
  localKey: string;
  password: string;
  motoId: string;
  preconnect: boolean;
  iceTokens: unknown[];
  tcpToken: RelayToken;
  mqtt: MqttCredentials;
  mqttHeader: string;
  subscribeTopics: string[];
  publishTopic: string;
}
export type MapStreamName = 'map.bin.stream' | 'cleanPath.bin.stream' | 'navPath.bin.stream';
/** Complete transport files. These bytes are private and have not been geometry-decoded. */
export interface MapAcquisitionSnapshot {
  revision: number;
  receivedAt: number;
  files: Record<MapStreamName, Uint8Array>;
}
export type MapAcquisitionEnd =
  | 'demand_expired'
  | 'aborted'
  | 'disconnected'
  | 'shutdown'
  | 'negotiation_timeout'
  | 'stream_ended'
  | 'protocol_error'
  | 'connection_failed'
  | 'cancel_unconfirmed'
  | 'cleanup_unconfirmed';
export interface MapAcquisitionResult {
  reason: MapAcquisitionEnd;
  cancellationConfirmed: boolean;
  cleanupConfirmed: boolean;
  lastComplete?: MapAcquisitionSnapshot;
}
export interface MapAcquisitionDemand {
  /** Total demand from start, including negotiation. Default 30 s, maximum 60 s. */
  demandMs?: number;
  signal?: AbortSignal;
}
