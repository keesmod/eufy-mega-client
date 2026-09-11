import { hasCameraMedia } from './camera-media.js';
import { observedDeviceState, observedInteger } from './device-state.js';
import { isFloodlightCamera, isSoloCamera, isStation, type Inventory } from './discovery.js';
import { lanAddress } from './network.js';
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
  FloodlightCamera,
  BatteryDoorbellCamera,
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
  EufyError,
  type Device,
  type WireDevice,
  type StationState,
  type Snapshot,
  type LiveStream,
  type StreamStop,
  type MediaMetadata,
} from './types.js';

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
const fail = (): never => {
  throw new EufyError('operation_outside_hardware_scope');
};

/** Private adapter: protocol objects never cross the public library boundary. */
export class DeviceTransport extends EventEmitter {
  private failures = new Map<string, string>();
  private raw = new Map<string, WireDevice>();
  private stations = new Map<string, Station>();
  private cameras = new Map<string, ProtocolDevice>();
  private encryption = new Map<string, 'lan-derived' | 'cipher'>();
  private connecting = new Map<string, Promise<void>>();
  private snapshots = new Map<string, Snapshot>();
  private covers = new Map<string, string>();
  private lives = new Map<string, ActiveLive>();
  private starting = new Set<string>();
  private pendingStarts = new Set<Promise<LiveStream>>();
  private commands = new Set<string>();
  private observedModes = new Map<string, { guard?: number; current?: number }>();
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly lifetime = new AbortController();
  readonly recordings = new RecordingAccess(
    {
      station: async (id, signal) => {
        await this.connect(id, signal);
        return this.station(id);
      },
      camera: (id) => this.camera(id, true),
      knownCamera: (id, station) => this.raw.get(id)?.parent_sn === station,
      busy: (id) => this.lives.has(id) || this.starting.has(id) || this.commands.has(id),
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
  private cameraWire(raw: WireDevice): DeviceListResponse {
    return { ...raw, station_sn: raw.parent_sn } as unknown as DeviceListResponse;
  }
  async load(raw: Map<string, WireDevice>, inventory?: Inventory): Promise<void> {
    if (this.lifetime.signal.aborted) throw new EufyError('client_closed');
    // Never replace a transport in the middle of a device operation.
    if (
      this.lives.size ||
      this.starting.size ||
      this.commands.size ||
      this.recordings.active ||
      this.connecting.size
    )
      throw new EufyError('devices_busy');
    this.failures.clear();
    if (inventory) {
      for (const issue of inventory.result.issues)
        if (issue.deviceId) this.failures.set(issue.deviceId, issue.code);
      raw = new Map([...raw].filter(([id]) => !this.failures.has(id)));
    }
    const previous = this.raw;
    const changed = (id: string) => {
      const before = previous.get(id),
        after = raw.get(id);
      return (
        !after ||
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
          const factory = Camera.isBatteryDoorbell(device.device_type)
            ? BatteryDoorbellCamera
            : isFloodlightCamera(device)
              ? FloodlightCamera
              : isSoloCamera(device)
                ? SoloCamera
                : Camera;
          const camera = await factory.getInstance(this.provider, this.cameraWire(device), {
            simultaneousDetections: false,
          });
          this.cameras.set(device.device_sn, camera);
          for (const [key, type] of Object.entries(detectionEvents)) {
            camera.on(key.replace(/^device /, '') as 'person detected', (_device, active, name) => {
              if (active && this.supportsEvent(device.device_sn, type))
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
      if (isStation(device)) {
        try {
          if (
            typeof device.p2p_did !== 'string' ||
            !device.p2p_did ||
            !device.member?.admin_user_id
          )
            throw new EufyError('invalid_connection_credentials');
          const stationWire = {
            ...device,
            station_sn: device.device_sn,
            station_name: device.device_name,
            station_model: device.device_model,
            devices: [...raw.values()]
              .filter((d) => this.cameras.has(d.device_sn) && d.parent_sn === device.device_sn)
              .map((d) => this.cameraWire(d)),
          } as unknown as StationListResponse;
          const existing = this.stations.get(device.device_sn);
          if (existing) {
            existing.update(stationWire);
            continue;
          }
          const station = await Station.getInstance(this.provider, stationWire, lanAddress(device));
          station.setConnectionType(P2PConnectionType.ONLY_LOCAL);
          this.stations.set(device.device_sn, station);
          this.bind(station);
          station.initialize();
        } catch (error) {
          const station = this.stations.get(device.device_sn);
          if (station) {
            station.removeAllListeners();
            await station.dispose();
          }
          this.stations.delete(device.device_sn);
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
    return {
      id,
      connected: station.isConnected() && this.encryption.has(id),
      guardMode: this.observedModes.get(id)?.guard ?? null,
      currentMode: this.observedModes.get(id)?.current ?? null,
      alarm: value(PropertyName.StationAlarm) === true,
      alarmDelay: number(PropertyName.StationAlarmDelay) ?? 0,
      armDelay: number(PropertyName.StationAlarmArmDelay) ?? 0,
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
  private camera(id: string, media = false): ProtocolDevice {
    const failure = this.failures.get(id);
    if (failure) throw new EufyError(failure);
    const camera = this.cameras.get(id);
    if (!camera) throw new EufyError('unknown_camera');
    if (media && !hasCameraMedia(this.raw.get(id), this.raw.get(camera.getStationSerial())))
      throw new EufyError('camera_media_unverified');
    return camera;
  }
  cameraCapabilities(id: string): import('./types.js').CameraCapabilities {
    let reason: string | null = null;
    try {
      const camera = this.camera(id, true);
      this.station(camera.getStationSerial());
    } catch (error) {
      reason = error instanceof EufyError ? error.code : 'device_initialization_failed';
    }
    const capability = () => ({
      available: reason === null,
      status: reason === null ? ('experimental' as const) : ('unsupported' as const),
      reason,
    });
    return { snapshot: capability(), live: capability(), recordings: capability() };
  }
  supportsEvent(id: string, type: string): boolean {
    const camera = this.cameras.get(id);
    if (!camera || this.failures.has(id) || this.failures.has(camera.getStationSerial()))
      return false;
    if (type === 'notification') return true;
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
  acceptPush(message: PushMessage): boolean {
    if (
      (!message.device_sn || message.device_sn === message.station_sn) &&
      this.stations.has(message.station_sn) &&
      !this.failures.has(message.station_sn)
    )
      return true;
    return (
      this.raw.get(message.device_sn)?.parent_sn === message.station_sn &&
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
        if (cover === path && this.raw.get(cameraId)?.parent_sn === id) {
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
        this.raw.get(row.device_sn)?.parent_sn !== stationId ||
        !hasCameraMedia(this.raw.get(row.device_sn), this.raw.get(stationId)) ||
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
  async connect(id: string, signal?: AbortSignal): Promise<void> {
    if (this.state(id).connected) return;
    if (this.connecting.has(id)) throw new EufyError('connection_busy');
    const station = this.station(id);
    const operation = this.wait(
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
    ).then(() => {});
    this.connecting.set(id, operation);
    try {
      await operation;
    } catch (error) {
      await station.close();
      throw error;
    } finally {
      this.connecting.delete(id);
    }
  }
  async snapshot(id: string, signal?: AbortSignal): Promise<Snapshot> {
    const camera = this.camera(id, true);
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
  async startLive(id: string, signal?: AbortSignal): Promise<LiveStream> {
    const camera = this.camera(id, true),
      stationId = camera.getStationSerial(),
      station = this.station(stationId);
    if (
      this.lives.has(stationId) ||
      this.starting.has(stationId) ||
      this.commands.has(stationId) ||
      this.recordings.busy(stationId)
    )
      throw new EufyError('station_busy');
    this.starting.add(stationId);
    const operation = this.openLive(id, camera, stationId, station, signal);
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
    signal?: AbortSignal,
  ): Promise<LiveStream> {
    let issued = false;
    try {
      await this.connect(stationId, signal);
      return await this.wait(
        station,
        'livestream start',
        () => {
          issued = true;
          station.startLivestream(camera);
        },
        (_s, channel, metadata: StreamMetadata, video: Readable, audio: Readable) => {
          if (channel !== camera.getChannel()) return undefined;
          let finish!: (result: StreamStop) => void;
          const ended = new Promise<StreamStop>((resolve) => {
            finish = resolve;
          });
          const handle: LiveStream = {
            id: randomUUID(),
            deviceId: id,
            metadata: mediaMetadata(metadata),
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
            timer: setTimeout(() => void this.stopLive(id), 120000),
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
    if (!live || live.handle.deviceId !== id) throw new EufyError('live_session_not_found');
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
    if (
      live ||
      this.starting.has(stationId) ||
      this.commands.has(stationId) ||
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
  processPush(message: PushMessage): void {
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
  async refreshStationState(id: string, signal?: AbortSignal): Promise<StationState> {
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
    if (!guardModes.has(mode)) throw new EufyError('invalid_guard_mode');
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
    await Promise.allSettled(
      [...this.lives.values()].map((live) => this.stopLive(live.handle.deviceId)),
    );
    await Promise.allSettled([...this.stations.values()].map((station) => station.dispose()));
    for (const camera of this.cameras.values()) {
      camera.destroy();
      camera.removeAllListeners();
    }
    this.stations.clear();
    this.cameras.clear();
    this.raw.clear();
    this.snapshots.clear();
    this.removeAllListeners();
  }
}
