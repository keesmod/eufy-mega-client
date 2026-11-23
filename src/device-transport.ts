import { hasCameraMedia, hasCameraPresets } from './camera-media.js';
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
import {
  guardModes,
  observedGuardModes,
  readGuardMode,
  changeGuardMode,
  KEYPAD_GUARD_MODE,
} from './guard.js';
import { AccessoryStore, readingName, readingValue } from './accessories.js';
import type { AccessoryRow } from './discovery.js';
import type { ParamReport } from './vendor/p2p/param-report.js';
import { CusPushEvent } from './vendor/push/types.js';
import { movePreset } from './preset.js';
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
  CommandName,
} from './vendor/http/index.js';
import type { Device as ProtocolDevice } from './vendor/http/device.js';
import type { RawValues } from './vendor/http/interfaces.js';
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
  type StandalonePushSource,
  type SnapshotDownloadOutcome,
  type SnapshotQueryTrigger,
  type SnapshotRefreshObservation,
  type UnroutedPush,
  type UnroutedPushReason,
  type PresetMoveResult,
  type AccessoryObservation,
  type AccessoryParameters,
  type AccessoryState,
} from './types.js';
import { LiveStartObserver } from './live-start.js';
import { SnapshotRefreshCounter, eventCountChange } from './snapshot-refresh.js';
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
/** ha-eufy-cam#293: a requested snapshot picture without a reply by then counts as no_reply. */
const IMAGE_REPLY_MS = 15000;
/** ha-eufy-cam#293: latest-info queries remembered per station until their reply. */
const LATEST_QUERIES = 4;
/** ha-eufy-cam#293: a remembered query older than this got no reply and is dropped. */
const LATEST_REPLY_MS = 15000;
const MAX_LIVE_BOUND_MS = 3_600_000;
const MIN_LIVE_BOUND_MS = 1000;
/** A push field for the unrouted-push record: an integer in -1..99999, else null. */
const pushInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) >= -1 && (value as number) <= 99999
    ? (value as number)
    : null;
const serial = (value: unknown): string => (typeof value === 'string' ? value : '');

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
  /** ha-eufy-cam#293: the picture download requested per camera and not answered yet. */
  private pendingImages = new Map<string, { path: string; timer?: NodeJS.Timeout }>();
  /** ha-eufy-cam#293: each camera's last latest-info `event_count`. */
  private eventCounts = new Map<string, number>();
  /** ha-eufy-cam#293: the latest-info queries sent per station, oldest first. */
  private latestQueries = new Map<string, { trigger: SnapshotQueryTrigger; at: number }[]>();
  /** ha-eufy-cam#293: numbers-only counts of the snapshot refresh. */
  private readonly snapshotRefresh = new SnapshotRefreshCounter();
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
  /** ha-eufy-cam#275: admitted accessories, their readings and delivery counts. */
  private readonly accessories = new AccessoryStore();
  private accessoryRows = new Map<string, AccessoryRow>();
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
    // ha-eufy-cam#275: before the stations, because an admitted keypad joins its station wire.
    this.accessoryRows = new Map(inventory?.accessories ?? []);
    this.accessories.load(this.accessoryRows);
    for (const [id, camera] of this.cameras)
      if (changed(id)) {
        camera.destroy();
        camera.removeAllListeners();
        this.cameras.delete(id);
        this.snapshots.delete(id);
        this.covers.delete(id);
        this.forgetImage(id);
        this.eventCounts.delete(id);
      }
    for (const [id, station] of this.stations)
      if (changed(id)) {
        station.removeAllListeners();
        await station.dispose();
        this.stations.delete(id);
        this.stationAddresses.delete(id);
        this.sessionAddresses.delete(id);
        this.encryption.delete(id);
        this.latestQueries.delete(id);
        this.observedModes.delete(id);
        // The close handler is gone with the listeners, so end the live readings here.
        for (const accessory of this.accessories.close(id)) this.emitAccessory(accessory);
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
          // ha-eufy-cam#252: the exact battery-doorbell profile also selects the doorbell
          // adapter for a type without a vendored doorbell predicate, such as T8215/97.
          const factory = Camera.isSmartDrop(device.device_type)
            ? SmartDrop
            : Camera.isLockWifiVideo(device.device_type)
              ? DoorbellCamera
              : Camera.isBatteryDoorbell(device.device_type) ||
                  exactDeviceProfile(device)?.family === 'battery-doorbell'
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
          for (const accessory of this.accessories.close(device.device_sn))
            this.emitAccessory(accessory);
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
      availableModes: alarmState ? this.guardModesFor(id) : [],
    };
  }
  /** ha-eufy-cam#275: Off (6) only on a HomeBase with an admitted keypad. */
  private guardModesFor(id: string): number[] {
    return [
      ...guardModes,
      ...(this.accessories.keypads(id).length ? [KEYPAD_GUARD_MODE] : []),
    ].sort((a, b) => a - b);
  }
  /** ha-eufy-cam#275: synchronous, no I/O. A failed HomeBase keeps its accessories' last values. */
  accessoryState(id: string): AccessoryState {
    const failure = this.failures.get(id);
    if (failure) throw new EufyError(failure);
    const state = this.accessories.state(id);
    if (!state) throw new EufyError('unknown_device');
    return state;
  }
  /** ha-eufy-cam#275: synchronous, no I/O. Counts since this transport was created. */
  accessoryObservation(): AccessoryObservation {
    return this.accessories.snapshot();
  }
  /** ha-eufy-cam#286: synchronous, no I/O. Null for an ID that is no admitted keypad. */
  accessoryParameters(id: string): AccessoryParameters | null {
    return this.accessories.parameters(id) ?? null;
  }
  private emitAccessory(id: string): void {
    const state = this.accessories.state(id);
    if (state) this.emit('accessory', state);
  }
  /** Channels of this owner's cameras. An accessory on such a channel is ambiguous. */
  private cameraChannels(stationId: string): Set<number> {
    return new Set(
      [...this.raw.values()]
        .filter((d) => d.device_sn !== stationId && this.ownerOf(d) === stationId)
        .map((d) => d.device_channel),
    );
  }
  /** ha-eufy-cam#275: the parameters of a hub notify update (1829). */
  private paramReport(stationId: string, reports: ParamReport[]): void {
    if (!this.accessories.hasStation(stationId)) return;
    const taken = this.cameraChannels(stationId),
      changed = new Set<string>();
    for (const report of reports) {
      const id = this.accessories.byChannel(stationId, report.channel, taken);
      if (id === undefined || id === 'ambiguous') {
        this.accessories.count('unknown_channel');
        continue;
      }
      this.accessories.parameter(id, 'hub_notify', report.type, report.value);
      const category = this.accessories.category(id)!;
      const name = readingName(category, report.type);
      const value = name && readingValue(category, name, report.value);
      if (!name || value === undefined) continue;
      this.accessories.count('hub_notify');
      if (this.accessories.observe(id, name, value, 'p2p') === 'changed') changed.add(id);
    }
    for (const id of changed) this.emitAccessory(id);
  }
  /**
   * ha-eufy-cam#275: entry sensor parameters of a CMD_CAMERA_INFO reply, which
   * the client already requests when a session opens. Entry sensors stay out of
   * the station wire, so the vendored Station cannot name them itself. The
   * keypad is in the wire and arrives through deviceParams. Other channels are
   * cameras, the HomeBase itself or unknown and are skipped without a count,
   * because one reply carries many parameters per channel.
   */
  private cameraInfoReport(stationId: string, reports: ParamReport[]): void {
    if (!this.accessories.hasStation(stationId)) return;
    const taken = this.cameraChannels(stationId),
      changed = new Set<string>();
    for (const report of reports) {
      const id = this.accessories.byChannel(stationId, report.channel, taken);
      if (id === undefined || id === 'ambiguous') continue;
      // ha-eufy-cam#286: only the types of a keypad. Its values and readings
      // arrive through deviceParams, where an encoded entry overrides a plain one.
      this.accessories.parameterType(id, 'camera_info', report.type);
      if (this.accessories.category(id) !== 'entry_sensor') continue;
      const name = readingName('entry_sensor', report.type);
      const value = name && readingValue('entry_sensor', name, report.value);
      if (!name || value === undefined) continue;
      this.accessories.count('camera_info');
      if (this.accessories.observe(id, name, value, 'p2p') === 'changed') changed.add(id);
    }
    for (const id of changed) this.emitAccessory(id);
  }
  /** ha-eufy-cam#275: the legacy entry sensor notification (1550), keyed by channel. */
  private sensorStatus(stationId: string, channel: number, status: unknown): void {
    if (!this.accessories.hasStation(stationId)) return;
    const id = this.accessories.byChannel(stationId, channel, this.cameraChannels(stationId));
    if (id === undefined || id === 'ambiguous' || this.accessories.category(id) !== 'entry_sensor')
      return this.accessories.count('unknown_channel');
    const value = readingValue('entry_sensor', 'open', status);
    if (value === undefined) return;
    this.accessories.count('sensor_status');
    if (this.accessories.observe(id, 'open', value, 'p2p') === 'changed') this.emitAccessory(id);
  }
  /** ha-eufy-cam#275: device information for an admitted keypad in this station's wire. */
  private deviceParams(stationId: string, id: string, params: RawValues): void {
    if (this.accessories.stationOf(id) !== stationId) return;
    const category = this.accessories.category(id)!;
    let changed = false;
    for (const [type, param] of Object.entries(params)) {
      // ha-eufy-cam#286: this path also carries the reply's encoded entries
      // and single parameter notifications, which cameraInfoReport never sees.
      if (param?.source === 'p2p') this.accessories.parameter(id, 'camera_info', type, param.value);
      const name = readingName(category, Number(type));
      if (!name || param?.source !== 'p2p') continue;
      const value = readingValue(category, name, param.value);
      if (value === undefined) continue;
      this.accessories.count('camera_info');
      if (this.accessories.observe(id, name, value, 'p2p') === 'changed') changed = true;
    }
    if (changed) this.emitAccessory(id);
  }
  /**
   * ha-eufy-cam#275: a push that names an admitted accessory never reaches
   * detections or the vendored handlers. Only a door sensor push for an entry
   * sensor from its own, available HomeBase sets a reading.
   */
  private accessoryPush(message: PushMessage): void {
    const id = message.device_sn,
      stationId = this.accessories.stationOf(id);
    if (
      this.accessories.category(id) !== 'entry_sensor' ||
      message.event_type !== CusPushEvent.DOOR_SENSOR ||
      !stationId ||
      message.station_sn !== stationId ||
      !this.stations.has(stationId) ||
      this.failures.has(stationId) ||
      typeof message.sensor_open !== 'boolean'
    )
      return;
    const outcome = this.accessories.observe(
      id,
      'open',
      message.sensor_open,
      'push',
      message.event_time,
    );
    this.accessories.count(outcome === 'late' ? 'conflicts' : 'push_door_sensor');
    if (outcome === 'changed') this.emitAccessory(id);
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
  /** ha-eufy-cam#229: an admitted T8170 under a HomeBase 3. Never the standalone route. */
  private presetCamera(id: string): ProtocolDevice {
    const camera = this.camera(id);
    const raw = this.raw.get(id);
    if (this.standalone.has(id) || !hasCameraPresets(raw, this.raw.get(this.ownerOf(raw) ?? '')))
      throw new EufyError('operation_outside_hardware_scope');
    return camera;
  }
  cameraCapabilities(id: string): import('./types.js').CameraCapabilities {
    const capability = (camera: () => ProtocolDevice) => {
      let reason: string | null = null;
      try {
        this.station(camera().getStationSerial());
      } catch (error) {
        reason = error instanceof EufyError ? error.code : 'device_initialization_failed';
      }
      return {
        available: reason === null,
        status: reason === null ? ('experimental' as const) : ('unsupported' as const),
        reason,
      };
    };
    const media = (feature: CameraMediaFeature) => capability(() => this.camera(id, feature));
    return {
      snapshot: media('snapshot'),
      live: media('live'),
      recordings: media('recordings'),
      presets: capability(() => this.presetCamera(id)),
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
    if (typeof message.device_sn === 'string' && this.accessories.has(message.device_sn)) {
      this.accessoryPush(message);
      return false;
    }
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
  /**
   * ha-eufy-cam#283: a camera detection push that names an admitted HomeBase
   * camera as its own station is routed to that camera's HomeBase, when the
   * camera's exact profile allows it. Every other push is returned unchanged,
   * so a camera's own mode or microSD push never reaches the HomeBase.
   */
  routePush(message: PushMessage): PushMessage {
    const id = serial(message.device_sn);
    if (
      id === '' ||
      message.station_sn !== id ||
      this.standalone.has(id) ||
      pushEventType(message) === 'notification'
    )
      return message;
    const raw = this.raw.get(id);
    const owner = this.ownerOf(raw);
    if (
      !raw ||
      isStation(raw) ||
      exactDeviceProfile(raw)?.selfNamedPushes !== true ||
      owner === undefined ||
      owner === id ||
      !this.stations.has(owner)
    )
      return message;
    return { ...message, station_sn: owner };
  }
  /**
   * ha-eufy-cam#283: the numbers-only record of a push that produced no
   * detection event. Undefined for a push that needs none: an accessory or
   * standalone push, which its own path reports, and a station push without a
   * camera detection code, such as a Guard Mode change.
   */
  unroutedPush(message: PushMessage, source: StandalonePushSource): UnroutedPush | undefined {
    const device = serial(message.device_sn),
      station = serial(message.station_sn);
    if (this.accessories.has(device) || this.standaloneOwner(message)) return undefined;
    const raw = device === '' ? undefined : this.raw.get(device);
    const camera = raw && !isStation(raw) ? raw : undefined;
    const owner = this.ownerOf(camera);
    let reason: UnroutedPushReason;
    if (device === '' && station === '') reason = 'no_serial';
    else if (camera) {
      if (
        !this.cameras.has(device) ||
        this.failures.has(device) ||
        !owner ||
        this.failures.has(owner) ||
        !this.stations.has(owner)
      )
        reason = 'camera_unavailable';
      else reason = owner === station ? 'unsupported_event' : 'owner_mismatch';
    } else if ((device === '' || device === station) && this.stations.has(station)) {
      if (pushEventType(message) === 'notification') return undefined;
      reason = 'station_detection';
    } else reason = 'unknown_device';
    return {
      reason,
      source,
      model: camera?.device_model ?? null,
      station:
        station === ''
          ? 'missing'
          : camera && station === owner
            ? 'owner'
            : station === device
              ? 'device'
              : this.stations.has(station)
                ? 'station'
                : 'unknown',
      pushType: pushInteger(message.type),
      eventCode: pushInteger(message.event_type),
      msgType: pushInteger(message.msg_type),
    };
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
      // A query sent on a closed session gets no reply.
      this.latestQueries.delete(id);
      this.finishLive(id, { confirmed: false, reason: 'connection_lost' });
      this.emit('station', this.state(id));
      for (const accessory of this.accessories.close(id)) this.emitAccessory(accessory);
    });
    station.on('connection error', () =>
      this.emit('fault', new EufyError('device_connection_failed')),
    );
    station.on('property changed', () => this.emit('station', this.state(id)));
    station.on('parameter observed', (_s, type, value, source) => {
      // A standalone camera's own arming state is not admitted on its route.
      if (this.standalone.has(id)) return;
      // ha-eufy-cam#275: 6 (Off) is read on every HomeBase.
      if (source !== 'p2p' || !observedGuardModes.has(Number(value))) return;
      const state = this.observedModes.get(id) ?? {},
        mode = Number(value);
      const field =
        type === CommandType.CMD_SET_ARMING
          ? 'guard'
          : type === CommandType.CMD_GET_ALARM_MODE
            ? 'current'
            : undefined;
      if (!field || state[field] === mode) return;
      state[field] = mode;
      this.observedModes.set(id, state);
      this.emit('station', this.state(id));
    });
    station.on('param report', (_s, reports) => this.paramReport(id, reports));
    station.on('camera info params', (_s, reports) => this.cameraInfoReport(id, reports));
    station.on('sensor status', (_s, channel, status) => this.sensorStatus(id, channel, status));
    station.on('raw device property changed', (serial, params) => {
      if (this.accessories.has(serial)) return this.deviceParams(id, serial, params);
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
    // ha-eufy-cam#293: the protocol layer asks for the latest rows itself when a
    // session opens. Counting only, so a failure here never touches the connection.
    station.on('connect', () => {
      try {
        if (station.hasCommand(CommandName.StationDatabaseQueryLatestInfo))
          this.rememberQuery(id, 'connect');
      } catch {
        /* ignored */
      }
    });
    station.on('database query latest', (_s, code, rows) => {
      const trigger = this.replyTrigger(id);
      this.snapshotRefresh.reply(trigger, code === 0);
      if (code === 0) this.latest(id, rows, trigger);
    });
    station.on('image download', (_s, path, data) => {
      this.settleImages(id, path, data);
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
  /** An admitted camera of this station with snapshot media, whose rows are read and counted. */
  private refreshable(id: string, stationId: string): boolean {
    return (
      this.cameras.has(id) &&
      this.ownerOf(this.raw.get(id)) === stationId &&
      this.hasMedia(id, 'snapshot')
    );
  }
  private latest(
    stationId: string,
    rows: DatabaseQueryLatestInfo[],
    trigger: SnapshotQueryTrigger,
  ): void {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!this.refreshable(row.device_sn, stationId)) continue;
      const id = row.device_sn,
        model = this.raw.get(id)?.device_model;
      seen.add(id);
      // ha-eufy-cam#293: counted, never acted on. Only a HomeBase path is fetched.
      const change = eventCountChange(this.eventCounts.get(id), row.event_count);
      if (change !== 'unavailable') this.eventCounts.set(id, row.event_count);
      if (!('crop_local_path' in row)) {
        const cloud = typeof row.crop_cloud_path === 'string' && row.crop_cloud_path !== '';
        this.snapshotRefresh.row(model, trigger, cloud ? 'cloud_path_only' : 'no_path', change);
        continue;
      }
      const path = row.crop_local_path as unknown;
      // The protocol layer makes a row without a crop_hb3_path field a HomeBase
      // row without a path, and drops its cloud path.
      if (path === undefined || path === null) {
        this.snapshotRefresh.row(model, trigger, 'path_absent', change);
        continue;
      }
      if (typeof path !== 'string' || !path || path.length > 2048) {
        this.snapshotRefresh.row(model, trigger, 'invalid_path', change);
        continue;
      }
      if (this.covers.get(id) === path && this.snapshots.has(id)) {
        this.snapshotRefresh.row(model, trigger, 'unchanged_path', change);
        continue;
      }
      this.snapshotRefresh.row(model, trigger, 'homebase_path', change);
      this.covers.set(id, path);
      // Before the request, because a reply may arrive while it is sent.
      this.expectImage(id, path);
      try {
        this.station(stationId).downloadImage(path);
      } catch (error) {
        this.forgetImage(id);
        throw error;
      }
    }
    for (const id of this.cameras.keys())
      if (!seen.has(id) && this.refreshable(id, stationId))
        this.snapshotRefresh.row(this.raw.get(id)?.device_model, trigger, 'no_row', 'unavailable');
  }
  /** ha-eufy-cam#293: count the camera's picture download once, by reply or after 15 seconds. */
  private expectImage(id: string, path: string): void {
    const model = this.raw.get(id)?.device_model;
    const current = this.pendingImages.get(id);
    if (current && current.path !== path) {
      this.forgetImage(id);
      this.snapshotRefresh.download(model, 'superseded');
    }
    // A repeated request for the same path waits for one reply, 15 seconds from the last request.
    const pending: { path: string; timer?: NodeJS.Timeout } =
      current?.path === path ? current : { path };
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (this.pendingImages.get(id) !== pending || this.lifetime.signal.aborted) return;
      this.pendingImages.delete(id);
      this.snapshotRefresh.download(model, 'no_reply');
    }, IMAGE_REPLY_MS);
    pending.timer.unref();
    this.pendingImages.set(id, pending);
  }
  private forgetImage(id: string): void {
    const pending = this.pendingImages.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingImages.delete(id);
  }
  /** ha-eufy-cam#293: the outcome of each requested download this reply answers. Counts only. */
  private settleImages(stationId: string, path: unknown, data: unknown): void {
    for (const [id, pending] of this.pendingImages) {
      if (pending.path !== path || this.ownerOf(this.raw.get(id)) !== stationId) continue;
      this.forgetImage(id);
      const image = Buffer.isBuffer(data) ? data : undefined;
      let outcome: SnapshotDownloadOutcome;
      if (!image || image.length < 3 || image[0] !== 255 || image[1] !== 216 || image[2] !== 255)
        outcome = 'not_jpeg';
      else if (image.length > 5_000_000) outcome = 'too_large';
      else outcome = this.covers.get(id) === path ? 'kept' : 'superseded';
      this.snapshotRefresh.download(this.raw.get(id)?.device_model, outcome);
    }
  }
  /** ha-eufy-cam#293: synchronous, no I/O. Counts since this transport was created. */
  snapshotRefreshStatus(): SnapshotRefreshObservation {
    return this.snapshotRefresh.snapshot();
  }
  /** Ask a station for its latest event rows and remember why, for the reply's counts. */
  private queryLatest(id: string, station: Station, trigger: SnapshotQueryTrigger): void {
    const entry = this.rememberQuery(id, trigger);
    try {
      station.databaseQueryLatestInfo();
    } catch (error) {
      const queue = this.latestQueries.get(id);
      queue?.splice(queue.indexOf(entry) >>> 0, 1);
      throw error;
    }
  }
  private rememberQuery(id: string, trigger: SnapshotQueryTrigger) {
    const queue = this.latestQueries.get(id) ?? [];
    const entry = { trigger, at: performance.now() };
    queue.push(entry);
    if (queue.length > LATEST_QUERIES) queue.shift();
    this.latestQueries.set(id, queue);
    return entry;
  }
  /** The oldest query still waiting for its reply. Queries without a reply after 15 seconds are dropped. */
  private replyTrigger(id: string): SnapshotQueryTrigger {
    const queue = this.latestQueries.get(id) ?? [];
    const now = performance.now();
    for (let head = queue[0]; head && now - head.at > LATEST_REPLY_MS; head = queue[0])
      queue.shift();
    return queue.shift()?.trigger ?? 'connect';
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
      () => {
        const owner = camera.getStationSerial();
        this.queryLatest(owner, this.station(owner), 'request');
      },
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
      // connect() closes its own failed attempt. connection_busy leaves the other attempt alone.
      await this.connect(stationId, abort);
      try {
        await this.confirmStop(station, camera, abort);
      } catch (error) {
        await station.close();
        throw error;
      }
      // Lost UDP packets can leave the media sequence out of sync even when
      // commands work again. End that session after its STOP acknowledgement
      // and establish a fresh encrypted connection before releasing ownership.
      await station.close();
      await this.connect(stationId, abort);
      return { confirmed: true, reason: 'device' };
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
      devices: [
        ...[...this.raw.values()]
          .filter((d) => this.cameras.has(d.device_sn) && this.ownerOf(d) === device.device_sn)
          .map((d) => this.cameraWire(d)),
        // ha-eufy-cam#275: only an admitted keypad joins the wire, so the vendored
        // Station accepts guard mode 6. Entry sensors and chimes never do.
        ...this.accessories
          .keypads(device.device_sn)
          .map((id) => ({ ...this.accessoryRows.get(id)!.raw, station_sn: device.device_sn })),
      ],
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
      this.queryLatest(id, station, 'push');
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
    if (!Number.isInteger(mode) || !this.guardModesFor(id).includes(mode))
      throw new EufyError('invalid_guard_mode');
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
      // connect() closes its own failed attempt. connection_busy leaves the other attempt alone.
      await this.connect(id, abort);
      try {
        const before = await readGuardMode(station, abort);
        if (before === mode) return { confirmed: true, commandSent: false, state: this.state(id) };
        await changeGuardMode(station, mode, abort);
        return { confirmed: true, commandSent: true, state: this.state(id) };
      } catch (error) {
        await station.close();
        throw error;
      }
    } finally {
      this.commands.delete(id);
    }
  }
  /**
   * ha-eufy-cam#229: one move to a saved preset on the primary session, refused
   * rather than queued while the HomeBase is busy. Never retried.
   */
  async moveToPreset(id: string, preset: number, signal?: AbortSignal): Promise<PresetMoveResult> {
    const camera = this.presetCamera(id);
    if (!Number.isInteger(preset) || preset < 0 || preset > 3)
      throw new EufyError('invalid_preset');
    const stationId = camera.getStationSerial(),
      station = this.station(stationId);
    // The guard mode rule. Streams on extra sessions leave the primary session free.
    if (
      this.commands.has(stationId) ||
      this.lives.has(stationId) ||
      this.starting.has(stationId) ||
      this.recordings.busy(stationId)
    )
      throw new EufyError('station_busy');
    const abort = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    this.commands.add(stationId);
    try {
      // connect() closes its own failed attempt. connection_busy leaves the other attempt alone.
      await this.connect(stationId, abort);
      try {
        return { preset, elapsedMs: await movePreset(station, camera, preset, abort) };
      } catch (error) {
        // No result arrived for this move. Closing drops any queued copy, so none is sent late.
        if (
          error instanceof EufyError &&
          error.code === 'preset_move_unconfirmed' &&
          error.remoteCode === undefined
        )
          await station.close();
        throw error;
      }
    } finally {
      this.commands.delete(stationId);
    }
  }
  async close(): Promise<void> {
    this.lifetime.abort();
    await this.recordings.close();
    await Promise.allSettled([...this.pendingStarts]);
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    for (const id of [...this.pendingImages.keys()]) this.forgetImage(id);
    this.latestQueries.clear();
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
    this.accessories.clear();
    this.accessoryRows.clear();
    this.snapshots.clear();
    this.removeAllListeners();
  }
}
