import { hasCameraMedia } from './camera-media.js';
import { exactDeviceProfile, type CameraMediaFeature } from './device-profiles.js';
import { observedDeviceState, observedInteger } from './device-state.js';
import {
  isIndoorCamera,
  isIntegratedCamera,
  isFloodlightCamera,
  isSoloCamera,
  isStation,
  type Inventory,
} from './discovery.js';
import { hostSubnetContains, lanAddress } from './network.js';
import { RecordingAccess } from './recordings.js';
import { guardModes, readGuardMode, changeGuardMode } from './guard.js';
import { awaitEvent } from './operations.js';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  Station,
  Camera,
  SoloCamera,
  IndoorCamera,
  WallLightCam,
  FloodlightCamera,
  BatteryDoorbellCamera,
  DoorbellCamera,
  SmartDrop,
  PropertyName,
} from './vendor/http/index.js';
import type { Device as ProtocolDevice } from './vendor/http/device.js';
import type { CloudProvider } from './vendor/http/api.js';
import type { DeviceListResponse, StationListResponse } from './vendor/http/models.js';
import { P2PConnectionType, VideoCodec, AudioCodec, CommandType } from './vendor/p2p/types.js';
import type { StreamMetadata, DatabaseQueryLatestInfo } from './vendor/p2p/interfaces.js';
import type { CommandResult } from './vendor/p2p/models.js';
import type { PushMessage } from './vendor/push/models.js';
import { detectionEvents, pushEventType } from './detections.js';
import {
  decideStandalonePush,
  StandalonePushCounter,
  type PushSource,
  type StandaloneOwner,
} from './standalone-events.js';
import {
  EufyError,
  type Device,
  type WireDevice,
  type StationState,
  type Snapshot,
  type LiveStream,
  type LiveStartProgress,
  type LiveFrameTiming,
  type StationConnectionProgress,
  type StationConnectionStage,
  type StationLookupObservation,
  type StationKeySetupObservation,
  type StreamStop,
  type MediaMetadata,
  type StandalonePushObservation,
} from './types.js';
import { LiveStartObserver } from './live-start.js';
import { tapLiveFrames } from './live-frames.js';

import { mediaMetadata } from './media.js';
interface ActiveLive {
  channel: number;
  handle: LiveStream;
  finish(result: StreamStop): void;
  stop?: Promise<StreamStop>;
  acknowledged: boolean;
  stopped: boolean;
  timer: NodeJS.Timeout;
  abort?: () => void;
}
/** One additional P2P session per further concurrent live camera on a station. */
interface ExtraLive extends ActiveLive {
  key: string;
  stationId: string;
  deviceId: string;
  station: Station;
  camera: ProtocolDevice;
}
const fail = (): never => {
  throw new EufyError('operation_outside_hardware_scope');
};
/** Per-stream upper bound: 120 seconds unless a start asks for more, up to the ceiling. */
const DEFAULT_LIVE_BOUND_MS = 120000;
const MAX_LIVE_BOUND_MS = 3_600_000;
const MIN_LIVE_BOUND_MS = 1000;

/** Private adapter: protocol objects never cross the public library boundary. */
export class DeviceTransport extends EventEmitter {
  private failures = new Map<string, string>();
  private raw = new Map<string, WireDevice>();
  /**
   * Every account row, admitted or not, read only for the lookup observation: to
   * classify lookup replies and to tell whether the inventory address is shared.
   */
  private accountRows: WireDevice[] = [];
  /** Experimental standalone cameras admitted by discovery. Each is its own P2P owner. */
  private standalone = new Set<string>();
  private stations = new Map<string, Station>();
  private cameras = new Map<string, ProtocolDevice>();
  private encryption = new Map<string, 'lan-derived' | 'cipher' | 'none'>();
  /** Whether each station session was created with an inventory LAN address. */
  private stationAddresses = new Map<string, boolean>();
  /** That address itself, read only for the lookup observation. */
  private sessionAddresses = new Map<string, string>();
  private connecting = new Map<string, Promise<void>>();
  private snapshots = new Map<string, Snapshot>();
  private covers = new Map<string, string>();
  private lives = new Map<string, ActiveLive>();
  /** Primary-session live starts in progress, station id to camera channel. */
  private starting = new Map<string, number>();
  private pendingStarts = new Set<Promise<LiveStream>>();
  private commands = new Set<string>();
  /** Additional live sessions keyed by station and channel. See docs/API.md, live media. */
  private extraLives = new Map<string, ExtraLive>();
  private extraStarting = new Map<string, string>();
  private readonly liveLimit: number;
  private readonly liveUpperBound: number;
  private observedModes = new Map<string, { guard?: number; current?: number }>();
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  /** ha-eufy-cam#185: numbers-only counts of pushes naming a standalone owner. */
  private readonly standalonePushes = new StandalonePushCounter();
  private readonly lifetime = new AbortController();
  readonly recordings = new RecordingAccess(
    {
      station: async (id, signal, onProgress, onLookup) => {
        await this.connect(id, signal, onProgress, onLookup);
        return this.station(id);
      },
      camera: (id) => this.camera(id, 'recordings'),
      knownCamera: (id, station) => this.ownerOf(this.raw.get(id)) === station,
      standalone: (id) => this.standalone.has(id),
      connected: (id) => {
        try {
          return this.state(id).connected;
        } catch {
          return false;
        }
      },
      busy: (id) =>
        this.lives.has(id) || this.starting.has(id) || this.commands.has(id) || this.extraBusy(id),
    },
    this.lifetime.signal,
  );
  private readonly provider: CloudProvider = {
    isConnected: () => !this.lifetime.signal.aborted,
    getDevices: () =>
      Object.fromEntries(
        [...this.raw.values()]
          .filter((d) => !isStation(d))
          .map((d) => [d.device_sn, this.cameraWire(d)]),
      ),
    refreshStationData: async () => {
      this.emit('refresh');
    },
    getCommandCredentials: async (stationId, _cipherId, userId) => {
      if (this.raw.get(stationId)?.member?.admin_user_id !== userId)
        throw new EufyError('invalid_connection_credentials');
      return { mode: 'lan-derived' };
    },
    getP2pKey: async () => fail(),
    getCipher: async () => fail(),
    getPublicKey: async () => fail(),
    getImage: async () => fail(),
    getVoices: async () => ({}),
    setParameters: async () => fail(),
    updateUserPassword: async () => fail(),
  };
  constructor(options: { maxLiveStreamsPerStation?: number; liveUpperBoundMs?: number } = {}) {
    super();
    const limit = options.maxLiveStreamsPerStation ?? 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > 4)
      throw new EufyError('invalid_live_stream_limit');
    this.liveLimit = limit;
    const bound = options.liveUpperBoundMs ?? DEFAULT_LIVE_BOUND_MS;
    if (!Number.isInteger(bound) || bound < DEFAULT_LIVE_BOUND_MS || bound > MAX_LIVE_BOUND_MS)
      throw new EufyError('invalid_live_bound');
    this.liveUpperBound = bound;
  }
  private liveBound(maxDurationMs?: number): number {
    if (maxDurationMs === undefined) return DEFAULT_LIVE_BOUND_MS;
    if (
      !Number.isInteger(maxDurationMs) ||
      maxDurationMs < MIN_LIVE_BOUND_MS ||
      maxDurationMs > this.liveUpperBound
    )
      throw new EufyError('invalid_live_bound');
    return maxDurationMs;
  }
  private cameraWire(raw: WireDevice): DeviceListResponse {
    return { ...raw, station_sn: this.ownerOf(raw) } as unknown as DeviceListResponse;
  }
  /** The connection owner: the HomeBase, or the camera itself on the experimental route. */
  private ownerOf(raw: WireDevice | undefined): string | undefined {
    return raw && this.standalone.has(raw.device_sn) ? raw.device_sn : raw?.parent_sn;
  }
  private hasMedia(id: string, feature: CameraMediaFeature): boolean {
    if (this.standalone.has(id)) return true;
    const raw = this.raw.get(id);
    return hasCameraMedia(raw, this.raw.get(this.ownerOf(raw) ?? ''), feature);
  }
  async load(raw: Map<string, WireDevice>, inventory?: Inventory): Promise<void> {
    if (this.lifetime.signal.aborted) throw new EufyError('client_closed');
    // Never replace a transport in the middle of a device operation.
    if (
      this.lives.size ||
      this.starting.size ||
      this.commands.size ||
      this.extraLives.size ||
      this.extraStarting.size ||
      this.recordings.active ||
      this.connecting.size
    )
      throw new EufyError('devices_busy');
    this.failures.clear();
    const accountRows = inventory?.accountRows ?? [...raw.values()];
    if (inventory) {
      for (const issue of inventory.result.issues)
        if (issue.deviceId) this.failures.set(issue.deviceId, issue.code);
      raw = new Map([...raw].filter(([id]) => !this.failures.has(id)));
    }
    const previous = this.raw,
      previousStandalone = this.standalone;
    const standalone = new Set(
      [...(inventory?.owners ?? [])]
        .filter(([id, owner]) => owner.transport === 'lan-experimental' && raw.has(id))
        .map(([id]) => id),
    );
    const changed = (id: string) => {
      const before = previous.get(id),
        after = raw.get(id);
      return (
        !after ||
        previousStandalone.has(id) !== standalone.has(id) ||
        (before &&
          (before.device_model !== after.device_model ||
            before.device_type !== after.device_type ||
            before.parent_sn !== after.parent_sn ||
            before.device_channel !== after.device_channel ||
            before.p2p_did !== after.p2p_did ||
            before.p2p_license !== after.p2p_license ||
            before.member?.admin_user_id !== after.member?.admin_user_id))
      );
    };
    this.raw = raw;
    this.accountRows = accountRows;
    this.standalone = standalone;
    for (const [id, camera] of this.cameras)
      if (changed(id)) {
        camera.destroy();
        camera.removeAllListeners();
        this.cameras.delete(id);
        this.snapshots.delete(id);
        this.covers.delete(id);
      }
    for (const [id, station] of this.stations)
      if (changed(id)) {
        station.removeAllListeners();
        await station.dispose();
        this.stations.delete(id);
        this.stationAddresses.delete(id);
        this.sessionAddresses.delete(id);
        this.encryption.delete(id);
        this.observedModes.delete(id);
      }
    for (const device of raw.values())
      if (!isStation(device)) {
        try {
          const existing = this.cameras.get(device.device_sn);
          if (existing) {
            existing.update(this.cameraWire(device));
            continue;
          }
          // Discovery admits exact pairs. Family selection does not grant media access.
          const factory = Camera.isSmartDrop(device.device_type)
            ? SmartDrop
            : Camera.isLockWifiVideo(device.device_type)
              ? DoorbellCamera
              : Camera.isBatteryDoorbell(device.device_type)
                ? BatteryDoorbellCamera
                : isFloodlightCamera(device)
                  ? FloodlightCamera
                  : isSoloCamera(device)
                    ? SoloCamera
                    : isIndoorCamera(device)
                      ? IndoorCamera
                      : Camera.isWallLightCam(device.device_type)
                        ? WallLightCam
                        : Camera;
          const camera = await factory.getInstance(this.provider, this.cameraWire(device), {
            simultaneousDetections: false,
          });
          this.cameras.set(device.device_sn, camera);
          for (const [key, type] of Object.entries(detectionEvents)) {
            camera.on(key.replace(/^device /, '') as 'person detected', (_device, active, name) => {
              // A standalone camera's events are push-only, see filterPush.
              if (
                active &&
                !this.standalone.has(device.device_sn) &&
                this.supportsEvent(device.device_sn, type)
              )
                this.emit('detection', {
                  id: device.device_sn,
                  type,
                  name,
                  stranger: key === 'device stranger person detected',
                });
            });
          }
          camera.on('property changed', () => this.emit('device', this.device(device.device_sn)));
          camera.initialize();
        } catch {
          const camera = this.cameras.get(device.device_sn);
          camera?.destroy();
          camera?.removeAllListeners();
          this.cameras.delete(device.device_sn);
          this.failures.set(device.device_sn, 'device_initialization_failed');
        }
      }
    for (const device of raw.values())
      if (isStation(device) || standalone.has(device.device_sn)) {
        try {
          if (
            typeof device.p2p_did !== 'string' ||
            !device.p2p_did ||
            !device.member?.admin_user_id
          )
            throw new EufyError('invalid_connection_credentials');
          const stationWire = this.stationWire(device);
          const existing = this.stations.get(device.device_sn);
          if (existing) {
            existing.update(stationWire);
            continue;
          }
          const address = lanAddress(device);
          const station = await Station.getInstance(this.provider, stationWire, address);
          station.setConnectionType(P2PConnectionType.ONLY_LOCAL);
          // #142: only an experimental standalone camera may go on without a
          // command key after a successful key request result without a key
          // answer. A change of route recreates the station, so a reused one keeps it.
          station.setKeyWithoutAnswer(standalone.has(device.device_sn));
          this.stations.set(device.device_sn, station);
          this.stationAddresses.set(device.device_sn, address !== undefined);
          if (address !== undefined) this.sessionAddresses.set(device.device_sn, address);
          this.bind(station);
          station.initialize();
        } catch (error) {
          const station = this.stations.get(device.device_sn);
          if (station) {
            station.removeAllListeners();
            await station.dispose();
          }
          this.stations.delete(device.device_sn);
          this.stationAddresses.delete(device.device_sn);
          this.sessionAddresses.delete(device.device_sn);
          this.encryption.delete(device.device_sn);
          this.observedModes.delete(device.device_sn);
          this.failures.set(
            device.device_sn,
            error instanceof EufyError && error.code === 'invalid_connection_credentials'
              ? error.code
              : 'device_initialization_failed',
          );
        }
      }
  }
  device(id: string): Device {
    const failure = this.failures.get(id);
    if (failure) throw new EufyError(failure);
    const raw = this.raw.get(id);
    if (!raw) throw new EufyError('unknown_device');
    const camera = this.cameras.get(id);
    return {
      id,
      stationId: raw.parent_sn || id,
      kind: isStation(raw) ? 'station' : 'camera',
      model: raw.device_model,
      name: String(raw.device_alias_name || raw.device_name || ''),
      firmware:
        typeof raw.main_sw_version === 'string' && raw.main_sw_version ? raw.main_sw_version : null,
      hardware: typeof raw.main_hw_version === 'string' ? raw.main_hw_version : null,
      ...observedDeviceState(raw, camera ? (key) => camera.getRawProperty(key) : undefined),
    };
  }
  state(id: string): StationState {
    const station = this.station(id);
    const value = (name: PropertyName) =>
      station.hasProperty(name) ? station.getPropertyValue(name) : undefined;
    const number = (name: PropertyName): number | null => {
      const v = value(name);
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    // A standalone owner reports its session only, never alarm state.
    const alarmState = !this.standalone.has(id);
    return {
      id,
      connected: station.isConnected() && this.encryption.has(id),
      guardMode: alarmState ? (this.observedModes.get(id)?.guard ?? null) : null,
      currentMode: alarmState ? (this.observedModes.get(id)?.current ?? null) : null,
      alarm: alarmState && value(PropertyName.StationAlarm) === true,
      alarmDelay: (alarmState && number(PropertyName.StationAlarmDelay)) || 0,
      armDelay: (alarmState && number(PropertyName.StationAlarmArmDelay)) || 0,
      commandEncryption: this.encryption.get(id) ?? null,
    };
  }
  private station(id: string): Station {
    const failure = this.failures.get(id);
    if (failure) throw new EufyError(failure);
    const station = this.stations.get(id);
    if (!station) throw new EufyError('unknown_station');
    return station;
  }
  private camera(id: string, feature?: CameraMediaFeature): ProtocolDevice {
    const failure = this.failures.get(id);
    if (failure) throw new EufyError(failure);
    const camera = this.cameras.get(id);
    if (!camera) throw new EufyError('unknown_camera');
    // ha-eufy-cam#175: no recording request with evidence exists on the experimental
    // standalone route.
    if (feature === 'recordings' && this.standalone.has(id))
      throw new EufyError('standalone_recordings_unverified');
    if (feature && !this.hasMedia(id, feature)) throw new EufyError('camera_media_unverified');
    return camera;
  }
  cameraCapabilities(id: string): import('./types.js').CameraCapabilities {
    const capability = (feature: CameraMediaFeature) => {
      let reason: string | null = null;
      try {
        const camera = this.camera(id, feature);
        this.station(camera.getStationSerial());
      } catch (error) {
        reason = error instanceof EufyError ? error.code : 'device_initialization_failed';
      }
      return {
        available: reason === null,
        status: reason === null ? ('experimental' as const) : ('unsupported' as const),
        reason,
      };
    };
    return {
      snapshot: capability('snapshot'),
      live: capability('live'),
      recordings: capability('recordings'),
    };
  }
  supportsEvent(id: string, type: string): boolean {
    const camera = this.cameras.get(id);
    if (!camera || this.failures.has(id) || this.failures.has(camera.getStationSerial()))
      return false;
    if (type === 'notification') return true;
    // Integrated products expose camera detections only, not lock/lid or parcel state.
    if (isIntegratedCamera(this.raw.get(id)!) && !['motion', 'person', 'ring'].includes(type))
      return false;
    const properties: Record<string, PropertyName> = {
      motion: PropertyName.DeviceMotionDetected,
      person: PropertyName.DevicePersonDetected,
      ring: PropertyName.DeviceRinging,
      vehicle: PropertyName.DeviceVehicleDetected,
      pet: PropertyName.DevicePetDetected,
      crying: PropertyName.DeviceCryingDetected,
      sound: PropertyName.DeviceSoundDetected,
      package_delivered: PropertyName.DevicePackageDelivered,
      package_stranded: PropertyName.DevicePackageStranded,
      package_taken: PropertyName.DevicePackageTaken,
      loitering: PropertyName.DeviceSomeoneLoitering,
      radar_motion: PropertyName.DeviceRadarMotionDetected,
      dog: PropertyName.DeviceDogDetected,
      dog_lick: PropertyName.DeviceDogLickDetected,
      dog_poop: PropertyName.DeviceDogPoopDetected,
    };
    const property = properties[type];
    return property !== undefined && camera.hasProperty(property);
  }
  /** ha-eufy-cam#185: the exact profile of this standalone owner allows push events. */
  standaloneEvents(id: string): boolean {
    const raw = this.raw.get(id);
    return (
      this.standalone.has(id) &&
      raw !== undefined &&
      exactDeviceProfile(raw)?.standaloneEvents === true
    );
  }
  private standaloneOwner(message: PushMessage): StandaloneOwner | undefined {
    const id = [message.device_sn, message.station_sn].find(
      (sn) => typeof sn === 'string' && this.standalone.has(sn),
    );
    const raw = id === undefined ? undefined : this.raw.get(id);
    if (id === undefined || !raw) return undefined;
    return {
      id,
      type: raw.device_type,
      events: this.standaloneEvents(id),
      available: this.supportsEvent(id, 'notification'),
      detects: (type) => this.supportsEvent(id, type),
    };
  }
  /**
   * The event filter. A push naming an experimental standalone owner is decided
   * and counted here, and only its motion and person detections pass, to
   * Detections. Every other push gets acceptPush, uncounted.
   */
  filterPush(message: PushMessage, source: PushSource): boolean {
    const owner = this.standaloneOwner(message);
    if (!owner) return this.acceptPush(message);
    const decision = decideStandalonePush(owner, message);
    this.standalonePushes.record(decision, message, source);
    return decision.admitted;
  }
  /** Synchronous and without I/O. Counts since this transport was created. */
  standalonePushStatus(): StandalonePushObservation {
    return this.standalonePushes.snapshot();
  }
  acceptPush(message: PushMessage): boolean {
    // Standalone owners never pass here. filterPush admits their motion and person
    // pushes for Detections only, and this refusal keeps processPush away from the
    // vendored Station and camera handlers (guard mode, alarm, microSD,
    // loadEventImage, 10013) and refreshSnapshots.
    if (this.standalone.has(message.station_sn) || this.standalone.has(message.device_sn))
      return false;
    const raw = this.raw.get(message.device_sn);
    if (raw && isIntegratedCamera(raw) && pushEventType(message) === 'notification') return false;
    if (
      (!message.device_sn || message.device_sn === message.station_sn) &&
      this.stations.has(message.station_sn) &&
      !this.failures.has(message.station_sn)
    )
      return true;
    return (
      this.ownerOf(this.raw.get(message.device_sn)) === message.station_sn &&
      this.stations.has(message.station_sn) &&
      this.supportsEvent(message.device_sn, pushEventType(message))
    );
  }
  private bind(station: Station): void {
    const id = station.getSerial();
    station.on('encryption ready', (_station, mode) => {
      this.encryption.set(id, mode);
      station.getCameraInfo();
      this.emit('station', this.state(id));
    });
    station.on('close', () => {
      this.encryption.delete(id);
      this.finishLive(id, { confirmed: false, reason: 'connection_lost' });
      this.emit('station', this.state(id));
    });
    station.on('connection error', () =>
      this.emit('fault', new EufyError('device_connection_failed')),
    );
    station.on('property changed', () => this.emit('station', this.state(id)));
    station.on('parameter observed', (_s, type, value, source) => {
      // A standalone camera's own arming state is not admitted on its route.
      if (this.standalone.has(id)) return;
      if (source !== 'p2p' || !guardModes.has(Number(value))) return;
      const state = this.observedModes.get(id) ?? {};
      if (type === CommandType.CMD_SET_ARMING) state.guard = Number(value);
      else if (type === CommandType.CMD_GET_ALARM_MODE) state.current = Number(value);
      else return;
      this.observedModes.set(id, state);
      this.emit('station', this.state(id));
    });
    station.on('raw device property changed', (serial, params) => {
      const camera = this.cameras.get(serial);
      if (camera?.getStationSerial() === id)
        for (const [type, p] of Object.entries(params))
          camera.updateRawProperty(Number(type), p.value, p.source);
    });
    station.on('runtime state', (_s, channel, battery) => {
      const camera = [...this.cameras.values()].find(
        (c) => c.getStationSerial() === id && c.getChannel() === channel,
      );
      if (camera?.hasProperty(PropertyName.DeviceBattery) && observedInteger(battery, 100) !== null)
        camera.updateRawProperty(CommandType.CMD_GET_BATTERY, String(battery), 'p2p');
    });
    station.on('database query latest', (_s, code, rows) => {
      if (code === 0) this.latest(id, rows);
    });
    station.on('image download', (_s, path, data) => {
      if (
        data.length < 3 ||
        data.length > 5_000_000 ||
        data[0] !== 255 ||
        data[1] !== 216 ||
        data[2] !== 255
      )
        return;
      for (const [cameraId, cover] of this.covers)
        if (cover === path && this.ownerOf(this.raw.get(cameraId)) === id) {
          const snapshot: Snapshot = {
            deviceId: cameraId,
            data,
            mime: 'image/jpeg',
            receivedAt: new Date().toISOString(),
          };
          this.snapshots.set(cameraId, snapshot);
          this.emit('snapshot', snapshot);
        }
    });
    station.on('command result', (_s, result) => {
      const live = this.lives.get(id);
      if (
        !live ||
        result.channel !== live.channel ||
        result.command_type !== CommandType.CMD_STOP_REALTIME_MEDIA
      )
        return;
      if (result.return_code !== 0) {
        this.finishLive(id, { confirmed: false, reason: 'connection_lost' });
        void station.close();
        return;
      }
      live.acknowledged = true;
      if (live.stopped) this.finishLive(id, { confirmed: true, reason: 'device' });
    });
    station.on('livestream stop', (_s, channel) => {
      const live = this.lives.get(id);
      if (!live || channel !== live.channel) return;
      live.stopped = true;
      // Upstream emits this locally as soon as STOP is sent. Wait for device ACK.
      if (live.acknowledged) this.finishLive(id, { confirmed: true, reason: 'device' });
    });
    station.on('livestream error', () => {
      this.finishLive(id, { confirmed: false, reason: 'connection_lost' });
    });
    station.on('push notification', (_s, message) => this.emit('push', message));
  }
  private latest(stationId: string, rows: DatabaseQueryLatestInfo[]): void {
    for (const row of rows) {
      if (
        !this.cameras.has(row.device_sn) ||
        this.ownerOf(this.raw.get(row.device_sn)) !== stationId ||
        !this.hasMedia(row.device_sn, 'snapshot') ||
        !('crop_local_path' in row)
      )
        continue;
      const path = row.crop_local_path;
      if (typeof path !== 'string' || !path || path.length > 2048) continue;
      if (this.covers.get(row.device_sn) === path && this.snapshots.has(row.device_sn)) continue;
      this.covers.set(row.device_sn, path);
      this.station(stationId).downloadImage(path);
    }
  }
  async connect(
    id: string,
    signal?: AbortSignal,
    onProgress?: (progress: StationConnectionProgress) => void,
    onLookup?: (observation: StationLookupObservation) => void,
    onKeySetup?: (observation: StationKeySetupObservation) => void,
  ): Promise<void> {
    if (this.state(id).connected) return;
    if (this.connecting.has(id)) throw new EufyError('connection_busy');
    const station = this.station(id);
    // Each stage is reported once, in the order observed. A consumer's failure
    // never alters the connection.
    const started = performance.now();
    const seen = new Set<StationConnectionStage>();
    const mark = (stage: StationConnectionStage) => {
      if (!onProgress || seen.has(stage)) return;
      seen.add(stage);
      try {
        const progress: StationConnectionProgress = {
          stage,
          elapsedMs: Math.min(3_600_000, Math.max(0, Math.round(performance.now() - started))),
        };
        if (stage === 'lookup') progress.inventoryAddress = this.stationAddresses.get(id) === true;
        onProgress(progress);
      } catch {
        // Ignored by contract. Progress never alters the connection.
      }
    };
    // An attempt that reached its lookup reads the session's lookup observation
    // once, when it ends and before a failed attempt closes the session.
    let lookup: 'reached' | 'started' | undefined;
    // Every other account row counts, also one that discovery or load did not admit.
    const others = this.accountRows.filter((row) => row.device_sn !== id);
    const observe = () => {
      if (!lookup || !onLookup) return;
      try {
        // An attempt cancelled before its session started observed nothing.
        const observed = lookup === 'started' ? station.getLookupObservation() : undefined;
        onLookup(this.lookupObservation(id, others, observed));
      } catch {
        // Ignored by contract. The observation never alters the connection.
      }
    };
    // An attempt whose session opened reads the session's key setup observation
    // once, when it ends and before a failed attempt closes the session.
    let sessionOpened = false;
    const keySetup = () => {
      if (!sessionOpened || !onKeySetup) return;
      try {
        const observed = station.getKeySetupObservation();
        if (observed) onKeySetup({ ...observed });
      } catch {
        // Ignored by contract. The observation never alters the connection.
      }
    };
    const found = () => mark('station_found');
    const opened = () => {
      sessionOpened = true;
      mark('session_open');
    };
    try {
      station.on('station found', found);
      station.on('connect', opened);
      const operation = this.wait(
        station,
        'encryption ready',
        () => {
          lookup = 'reached';
          mark('lookup');
          // A consumer may cancel from its lookup callback. Then no session
          // starts that the close below would race.
          if (signal?.aborted || this.lifetime.signal.aborted) return;
          lookup = 'started';
          try {
            // The session compares each lookup reply with the other rows' DIDs
            // as it arrives and keeps only counts.
            station.setLookupAccountDids(
              new Set(
                others.flatMap((row) =>
                  typeof row.p2p_did === 'string' && row.p2p_did ? [row.p2p_did] : [],
                ),
              ),
            );
          } catch {
            // Observation only. It never alters the connection.
          }
          void station
            .connect()
            .catch(() => station.emit('connection error', station, new Error('Connection failed')));
        },
        (_s, mode) => mode,
        signal,
        20000,
      ).then(() => mark('encryption_ready'));
      this.connecting.set(id, operation);
      try {
        await operation;
      } catch (error) {
        observe();
        keySetup();
        await station.close();
        throw error;
      }
      observe();
      keySetup();
    } finally {
      station.off('station found', found);
      station.off('connect', opened);
      this.connecting.delete(id);
    }
  }
  /** The public lookup observation of an ended attempt, without identifiers or addresses. */
  private lookupObservation(
    id: string,
    others: WireDevice[],
    observed: StationLookupObservation | undefined,
  ): StationLookupObservation {
    const observation: StationLookupObservation = observed ?? {
      rounds: 0,
      broadcastTargets: 0,
      broadcastEnabled: false,
      sendErrors: 0,
      datagrams: 0,
      otherHeaders: 0,
      ownReplies: 0,
      accountReplies: 0,
      foreignReplies: 0,
      nearReplies: 0,
      inventoryReply: 'none',
    };
    const address = this.sessionAddresses.get(id);
    if (address === undefined) return { ...observation };
    const onSubnet = hostSubnetContains(address);
    return {
      ...observation,
      ...(onSubnet === undefined ? {} : { inventoryAddressOnSubnet: onSubnet }),
      inventoryAddressShared: others.some((row) => lanAddress(row) === address),
    };
  }
  async snapshot(id: string, signal?: AbortSignal): Promise<Snapshot> {
    const camera = this.camera(id, 'snapshot');
    await this.connect(camera.getStationSerial(), signal);
    const existing = this.snapshots.get(id);
    if (existing) return { ...existing, data: Buffer.from(existing.data) };
    return this.wait(
      this,
      'snapshot',
      () => this.station(camera.getStationSerial()).databaseQueryLatestInfo(),
      (snapshot) => (snapshot.deviceId === id ? snapshot : undefined),
      signal,
      15000,
    );
  }
  private wait<T>(
    source: EventEmitter,
    event: string,
    issue: () => void,
    accept: (...args: any[]) => T | undefined,
    signal?: AbortSignal,
    timeout = 15000,
  ): Promise<T> {
    const abort = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    return awaitEvent(source, event, issue, accept, abort, timeout);
  }
  async startLive(
    id: string,
    signal?: AbortSignal,
    maxDurationMs?: number,
    onProgress?: (progress: LiveStartProgress) => void,
    onFrameTiming?: (timing: LiveFrameTiming) => void,
  ): Promise<LiveStream> {
    const progress = new LiveStartObserver(onProgress);
    const bound = this.liveBound(maxDurationMs);
    const camera = this.camera(id, 'live'),
      stationId = camera.getStationSerial(),
      station = this.station(stationId),
      channel = camera.getChannel(),
      key = this.liveKey(stationId, channel);
    if (this.commands.has(stationId) || this.recordings.busy(stationId))
      throw new EufyError('station_busy');
    if (this.extraLives.has(key) || this.extraStarting.has(key))
      throw new EufyError('station_busy');
    // With concurrency enabled every live stream gets its own session, so the
    // primary session stays free for control, snapshots and recordings. With
    // the default limit of 1 the single stream uses the primary session. An
    // experimental standalone camera always uses its one primary session.
    if (this.liveLimit > 1 && !this.standalone.has(stationId)) {
      if (this.liveCount(stationId) >= this.liveLimit) throw new EufyError('station_busy');
      return this.startExtraLive(id, camera, stationId, bound, progress, signal, onFrameTiming);
    }
    if (this.lives.has(stationId) || this.starting.has(stationId))
      throw new EufyError('station_busy');
    this.starting.set(stationId, channel);
    const operation = this.openLive(
      id,
      camera,
      stationId,
      station,
      bound,
      progress,
      signal,
      onFrameTiming,
    );
    this.pendingStarts.add(operation);
    try {
      return await operation;
    } finally {
      this.starting.delete(stationId);
      this.pendingStarts.delete(operation);
    }
  }
  private async openLive(
    id: string,
    camera: ProtocolDevice,
    stationId: string,
    station: Station,
    bound: number,
    progress: LiveStartObserver,
    signal?: AbortSignal,
    onFrameTiming?: (timing: LiveFrameTiming) => void,
  ): Promise<LiveStream> {
    let issued = false;
    let unwatch = () => {};
    try {
      await this.connect(stationId, signal);
      progress.mark('session_ready');
      unwatch = progress.watch(station, camera.getChannel());
      return await this.wait(
        station,
        'livestream start',
        () => {
          issued = true;
          progress.mark('start_issued');
          station.startLivestream(camera);
        },
        (_s, channel, metadata: StreamMetadata, video: Readable, audio: Readable) => {
          if (channel !== camera.getChannel()) return undefined;
          progress.mark('metadata');
          let finish!: (result: StreamStop) => void;
          const ended = new Promise<StreamStop>((resolve) => {
            finish = resolve;
          });
          const handle: LiveStream = {
            id: randomUUID(),
            deviceId: id,
            get metadata() {
              return mediaMetadata(metadata);
            },
            video,
            audio,
            ended,
            stop: () => (this.lives.get(stationId)?.handle === handle ? this.stopLive(id) : ended),
          };
          const active: ActiveLive = {
            channel,
            handle,
            finish,
            acknowledged: false,
            stopped: false,
            timer: setTimeout(() => void this.stopLive(id), bound),
          };
          const abort = () => {
            if (this.lives.get(stationId)?.handle === handle)
              void this.stopLive(id).catch(() => {});
          };
          active.abort = () => {
            signal?.removeEventListener('abort', abort);
            video.off('error', abort);
            audio.off('error', abort);
          };
          signal?.addEventListener('abort', abort, { once: true });
          video.once('error', abort);
          audio.once('error', abort);
          this.lives.set(stationId, active);
          tapLiveFrames(video, audio, onFrameTiming);
          return handle;
        },
        signal,
        20000,
      );
    } catch (error) {
      if (issued) {
        // Cancellation ends the caller's wait, but still owns device cleanup.
        // A fresh bounded signal lets STOP finish during caller cancellation
        // and shutdown. Disposal waits for this operation before closing UDP.
        try {
          await this.confirmStop(station, camera, new AbortController().signal);
          this.emit('live-stop', { deviceId: id, confirmed: true, reason: 'device' });
        } catch {
          this.emit('live-stop', { deviceId: id, confirmed: false, reason: 'connection_lost' });
          await station.close();
        }
      }
      throw error;
    } finally {
      unwatch();
    }
  }
  private async confirmStop(
    station: Station,
    camera: ProtocolDevice,
    signal: AbortSignal,
  ): Promise<void> {
    await awaitEvent(
      station,
      'command result',
      () => station.stopLivestream(camera, true),
      (_s, result: CommandResult) => {
        if (
          result.command_type !== CommandType.CMD_STOP_REALTIME_MEDIA ||
          result.channel !== camera.getChannel()
        )
          return undefined;
        if (result.return_code !== 0) throw new EufyError('stop_rejected', result.return_code);
        return true;
      },
      signal,
      8000,
    );
  }
  async stopLive(id: string): Promise<StreamStop> {
    const camera = this.camera(id),
      stationId = camera.getStationSerial(),
      station = this.station(stationId),
      live = this.lives.get(stationId);
    if (!live || live.handle.deviceId !== id) {
      const extra = this.extraLives.get(this.liveKey(stationId, camera.getChannel()));
      if (extra?.deviceId === id) return this.stopExtraLive(extra.key);
      throw new EufyError('live_session_not_found');
    }
    if (live.stop) return live.stop;
    live.stop = (async () => {
      const timeout = setTimeout(() => {
        this.finishLive(stationId, { confirmed: false, reason: 'timeout' });
        void station.close();
      }, 8000);
      try {
        station.stopLivestream(camera);
        return await live.handle.ended;
      } catch {
        await station.close();
        return { confirmed: false, reason: 'connection_lost' } as StreamStop;
      } finally {
        clearTimeout(timeout);
      }
    })();
    return live.stop;
  }
  async ensureLiveStopped(id: string, signal?: AbortSignal): Promise<StreamStop> {
    const camera = this.camera(id),
      stationId = camera.getStationSerial(),
      station = this.station(stationId);
    const live = this.lives.get(stationId);
    if (live?.handle.deviceId === id) return this.stopLive(id);
    const extra = this.extraLives.get(this.liveKey(stationId, camera.getChannel()));
    if (extra?.deviceId === id) return this.stopExtraLive(extra.key);
    if (
      live ||
      this.starting.has(stationId) ||
      this.commands.has(stationId) ||
      this.extraBusy(stationId) ||
      this.recordings.busy(stationId)
    )
      throw new EufyError('station_busy');
    this.commands.add(stationId);
    const abort = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    try {
      await this.connect(stationId, abort);
      await this.confirmStop(station, camera, abort);
      // Lost UDP packets can leave the media sequence out of sync even when
      // commands work again. End that session after its STOP acknowledgement
      // and establish a fresh encrypted connection before releasing ownership.
      await station.close();
      await this.connect(stationId, abort);
      return { confirmed: true, reason: 'device' };
    } catch (error) {
      await station.close();
      throw error;
    } finally {
      this.commands.delete(stationId);
    }
  }
  private finishLive(stationId: string, result: StreamStop): void {
    const live = this.lives.get(stationId);
    if (!live) return;
    this.lives.delete(stationId);
    clearTimeout(live.timer);
    live.abort?.();
    live.finish(result);
    this.emit('live-stop', { deviceId: live.handle.deviceId, ...result });
  }
  private liveKey(stationId: string, channel: number): string {
    return `${stationId}#live:${channel}`;
  }
  private extraBusy(stationId: string): boolean {
    for (const live of this.extraLives.values()) if (live.stationId === stationId) return true;
    for (const owner of this.extraStarting.values()) if (owner === stationId) return true;
    return false;
  }
  private liveCount(stationId: string): number {
    let count = this.lives.has(stationId) || this.starting.has(stationId) ? 1 : 0;
    for (const live of this.extraLives.values()) if (live.stationId === stationId) count++;
    for (const owner of this.extraStarting.values()) if (owner === stationId) count++;
    return count;
  }
  private stationWire(device: WireDevice): StationListResponse {
    return {
      ...device,
      station_sn: device.device_sn,
      station_name: device.device_name,
      station_model: device.device_model,
      devices: [...this.raw.values()]
        .filter((d) => this.cameras.has(d.device_sn) && this.ownerOf(d) === device.device_sn)
        .map((d) => this.cameraWire(d)),
    } as unknown as StationListResponse;
  }
  /** One additional station object gives one additional P2P session with its own socket. */
  protected async createExtraStation(stationId: string): Promise<Station> {
    const device = this.raw.get(stationId);
    if (!device) throw new EufyError('unknown_station');
    const station = await Station.getInstance(
      this.provider,
      this.stationWire(device),
      lanAddress(device),
    );
    station.setConnectionType(P2PConnectionType.ONLY_LOCAL);
    station.setKeyWithoutAnswer(this.standalone.has(stationId));
    station.initialize();
    return station;
  }
  private async startExtraLive(
    id: string,
    camera: ProtocolDevice,
    stationId: string,
    bound: number,
    progress: LiveStartObserver,
    signal?: AbortSignal,
    onFrameTiming?: (timing: LiveFrameTiming) => void,
  ): Promise<LiveStream> {
    const key = this.liveKey(stationId, camera.getChannel());
    if (this.extraLives.has(key) || this.extraStarting.has(key))
      throw new EufyError('station_busy');
    this.extraStarting.set(key, stationId);
    const operation = this.openExtraLive(
      id,
      camera,
      stationId,
      key,
      bound,
      progress,
      signal,
      onFrameTiming,
    );
    this.pendingStarts.add(operation);
    try {
      return await operation;
    } finally {
      this.extraStarting.delete(key);
      this.pendingStarts.delete(operation);
    }
  }
  private async openExtraLive(
    id: string,
    camera: ProtocolDevice,
    stationId: string,
    key: string,
    bound: number,
    progress: LiveStartObserver,
    signal?: AbortSignal,
    onFrameTiming?: (timing: LiveFrameTiming) => void,
  ): Promise<LiveStream> {
    const station = await this.createExtraStation(stationId);
    let issued = false;
    let unwatch = () => {};
    try {
      this.bindExtra(station, key);
      await this.wait(
        station,
        'encryption ready',
        () => {
          void station
            .connect()
            .catch(() => station.emit('connection error', station, new Error('Connection failed')));
        },
        (_s, mode) => mode,
        signal,
        20000,
      );
      progress.mark('session_ready');
      unwatch = progress.watch(station, camera.getChannel());
      return await this.wait(
        station,
        'livestream start',
        () => {
          issued = true;
          progress.mark('start_issued');
          station.startLivestream(camera);
        },
        (_s, channel, metadata: StreamMetadata, video: Readable, audio: Readable) => {
          if (channel !== camera.getChannel()) return undefined;
          progress.mark('metadata');
          let finish!: (result: StreamStop) => void;
          const ended = new Promise<StreamStop>((resolve) => {
            finish = resolve;
          });
          const handle: LiveStream = {
            id: randomUUID(),
            deviceId: id,
            get metadata() {
              return mediaMetadata(metadata);
            },
            video,
            audio,
            ended,
            stop: () =>
              this.extraLives.get(key)?.handle === handle ? this.stopExtraLive(key) : ended,
          };
          const active: ExtraLive = {
            key,
            stationId,
            deviceId: id,
            station,
            camera,
            channel,
            handle,
            finish,
            acknowledged: false,
            stopped: false,
            timer: setTimeout(() => void this.stopExtraLive(key).catch(() => {}), bound),
          };
          const abort = () => {
            if (this.extraLives.get(key)?.handle === handle)
              void this.stopExtraLive(key).catch(() => {});
          };
          active.abort = () => {
            signal?.removeEventListener('abort', abort);
            video.off('error', abort);
            audio.off('error', abort);
          };
          signal?.addEventListener('abort', abort, { once: true });
          video.once('error', abort);
          audio.once('error', abort);
          this.extraLives.set(key, active);
          tapLiveFrames(video, audio, onFrameTiming);
          return handle;
        },
        signal,
        20000,
      );
    } catch (error) {
      if (issued) {
        // The extra session owns its own STOP. Confirm it before releasing the socket.
        try {
          await this.confirmStop(station, camera, new AbortController().signal);
          this.emit('live-stop', { deviceId: id, confirmed: true, reason: 'device' });
        } catch {
          this.emit('live-stop', { deviceId: id, confirmed: false, reason: 'connection_lost' });
        }
      }
      await station.dispose();
      throw error;
    } finally {
      unwatch();
    }
  }
  private bindExtra(station: Station, key: string): void {
    station.on('close', () => {
      this.finishExtraLive(key, { confirmed: false, reason: 'connection_lost' });
    });
    station.on('command result', (_s, result) => {
      const live = this.extraLives.get(key);
      if (
        !live ||
        result.channel !== live.channel ||
        result.command_type !== CommandType.CMD_STOP_REALTIME_MEDIA
      )
        return;
      if (result.return_code !== 0) {
        this.finishExtraLive(key, { confirmed: false, reason: 'connection_lost' });
        void station.close();
        return;
      }
      live.acknowledged = true;
      if (live.stopped) this.finishExtraLive(key, { confirmed: true, reason: 'device' });
    });
    station.on('livestream stop', (_s, channel) => {
      const live = this.extraLives.get(key);
      if (!live || channel !== live.channel) return;
      live.stopped = true;
      if (live.acknowledged) this.finishExtraLive(key, { confirmed: true, reason: 'device' });
    });
    station.on('livestream error', () => {
      this.finishExtraLive(key, { confirmed: false, reason: 'connection_lost' });
    });
  }
  private async stopExtraLive(key: string): Promise<StreamStop> {
    const live = this.extraLives.get(key);
    if (!live) throw new EufyError('live_session_not_found');
    if (live.stop) return live.stop;
    live.stop = (async () => {
      const timeout = setTimeout(() => {
        this.finishExtraLive(key, { confirmed: false, reason: 'timeout' });
        void live.station.close();
      }, 8000);
      try {
        live.station.stopLivestream(live.camera);
        return await live.handle.ended;
      } catch {
        await live.station.close();
        return { confirmed: false, reason: 'connection_lost' } as StreamStop;
      } finally {
        clearTimeout(timeout);
        // The extra session exists for this stream only. Release its socket.
        await live.station.dispose();
      }
    })();
    return live.stop;
  }
  private finishExtraLive(key: string, result: StreamStop): void {
    const live = this.extraLives.get(key);
    if (!live) return;
    this.extraLives.delete(key);
    clearTimeout(live.timer);
    live.abort?.();
    live.finish(result);
    this.emit('live-stop', { deviceId: live.deviceId, ...result });
    // A lost session has no stop owner. Release it off the event path.
    if (!live.stop) setImmediate(() => void live.station.dispose().catch(() => {}));
  }
  processPush(message: PushMessage): void {
    // acceptPush refuses every standalone owner, see its comment.
    const station = this.stations.get(message.station_sn);
    if (!station || !this.acceptPush(message)) return;
    station.processPushNotification(message);
    this.cameras.get(message.device_sn)?.processPushNotification(station, message, 10);
    this.refreshSnapshots(station.getSerial());
  }
  private refreshSnapshots(id: string): void {
    if (this.refreshTimers.has(id) || this.lifetime.signal.aborted) return;
    const timer = setTimeout(() => {
      this.refreshTimers.delete(id);
      const station = this.stations.get(id);
      if (!station?.isConnected() || this.lifetime.signal.aborted) return;
      // Extra sessions do not occupy the primary session, so snapshots keep flowing.
      if (
        this.lives.has(id) ||
        this.starting.has(id) ||
        this.recordings.busy(id) ||
        this.commands.has(id)
      ) {
        this.refreshSnapshots(id);
        return;
      }
      station.databaseQueryLatestInfo();
    }, 2000);
    timer.unref();
    this.refreshTimers.set(id, timer);
  }
  /** The experimental standalone route covers camera media only, never alarm state. */
  private homeBaseOnly(id: string): void {
    if (this.standalone.has(id)) throw new EufyError('operation_outside_hardware_scope');
  }
  async refreshStationState(id: string, signal?: AbortSignal): Promise<StationState> {
    this.homeBaseOnly(id);
    await this.connect(id, signal);
    await readGuardMode(
      this.station(id),
      AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]),
    );
    return this.state(id);
  }
  async setGuardMode(
    id: string,
    mode: number,
    signal?: AbortSignal,
  ): Promise<{ confirmed: true; commandSent: boolean; state: StationState }> {
    this.homeBaseOnly(id);
    if (!guardModes.has(mode)) throw new EufyError('invalid_guard_mode');
    // Streams on extra sessions leave the primary session free for this command.
    if (
      this.commands.has(id) ||
      this.lives.has(id) ||
      this.starting.has(id) ||
      this.recordings.busy(id)
    )
      throw new EufyError('station_busy');
    const station = this.station(id),
      abort = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    this.commands.add(id);
    try {
      await this.connect(id, abort);
      const before = await readGuardMode(station, abort);
      if (before === mode) return { confirmed: true, commandSent: false, state: this.state(id) };
      await changeGuardMode(station, mode, abort);
      return { confirmed: true, commandSent: true, state: this.state(id) };
    } catch (error) {
      await station.close();
      throw error;
    } finally {
      this.commands.delete(id);
    }
  }
  async close(): Promise<void> {
    this.lifetime.abort();
    await this.recordings.close();
    await Promise.allSettled([...this.pendingStarts]);
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    await Promise.allSettled([
      ...[...this.lives.values()].map((live) => this.stopLive(live.handle.deviceId)),
      ...[...this.extraLives.keys()].map((key) => this.stopExtraLive(key)),
    ]);
    await Promise.allSettled([...this.stations.values()].map((station) => station.dispose()));
    for (const camera of this.cameras.values()) {
      camera.destroy();
      camera.removeAllListeners();
    }
    this.stations.clear();
    this.stationAddresses.clear();
    this.sessionAddresses.clear();
    this.cameras.clear();
    this.raw.clear();
    this.accountRows = [];
    this.snapshots.clear();
    this.removeAllListeners();
  }
}
