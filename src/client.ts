import { EventEmitter } from 'node:events';
import { EventTransport } from './event-transport.js';
import { DeviceTransport } from './device-transport.js';
import { MegaCloud, responseObject } from './cloud.js';
import {
  EufyError,
  type ClientEvents,
  type AuthAnswer,
  type AuthState,
  type ClientOptions,
  type Device,
  type WireDevice,
  type StationState,
  type Snapshot,
  type LiveStream,
  type StreamStop,
} from './types.js';

export class EufyMegaClient extends EventEmitter<ClientEvents> {
  private readonly cloud: MegaCloud;
  private authOperation?: Promise<AuthState>;
  private transport?: DeviceTransport;
  private transportLoading?: Promise<DeviceTransport>;
  private events?: EventTransport;
  private eventsOperation?: Promise<void>;
  private closed = false;
  private closing?: Promise<void>;
  private loaded?: Map<string, WireDevice>;
  private devices = new Map<string, WireDevice>();
  constructor(options: ClientOptions) {
    super();
    this.cloud = new MegaCloud(options);
  }
  get connected(): boolean {
    return this.cloud.connected;
  }
  get eventStatus() {
    return (
      this.events?.status ?? { connected: false, received: 0, duplicates: 0, lastReceivedAt: null }
    );
  }
  connect(answer?: AuthAnswer, signal?: AbortSignal): Promise<AuthState> {
    if (this.closed) return Promise.reject(new EufyError('client_closed'));
    if (this.authOperation) return Promise.reject(new EufyError('authentication_busy'));
    const operation = this.cloud.connect(answer, signal).then((state) => {
      this.emit('auth', state);
      return state;
    });
    this.authOperation = operation;
    return operation.finally(() => {
      if (this.authOperation === operation) this.authOperation = undefined;
    });
  }
  async listDevices(signal?: AbortSignal): Promise<Device[]> {
    const result = responseObject(
      await this.cloud.call(
        'house',
        '/app/house/get_devs_list',
        { device_sn: '', num: 100, orderby: '' },
        signal,
      ),
    );
    if (!Array.isArray(result.devices)) throw new EufyError('invalid_inventory');
    // The initial hardware target has five devices. Do not claim completeness at a server cap.
    if (result.devices.length >= 100) throw new EufyError('inventory_completeness_unconfirmed');
    const devices = new Map<string, WireDevice>();
    for (const item of result.devices) {
      const raw = responseObject(item);
      if (
        raw.category !== 'eufy_security' ||
        !['T8030', 'T8160', 'T8213'].includes(String(raw.device_model))
      )
        continue;
      if (
        typeof raw.device_sn !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(raw.device_sn) ||
        devices.has(raw.device_sn)
      )
        throw new EufyError('invalid_device_identity');
      if (typeof raw.parent_sn !== 'string' || typeof raw.device_type !== 'number')
        throw new EufyError('invalid_device_relationship');
      devices.set(raw.device_sn, raw as unknown as WireDevice);
    }
    for (const device of devices.values()) {
      if (
        device.device_model !== 'T8030' &&
        devices.get(device.parent_sn)?.device_model !== 'T8030'
      )
        throw new EufyError('unsupported_station');
    }
    if (this.closed) throw new EufyError('client_closed');
    this.devices = devices;
    return [...devices.values()].map((device) => ({
      id: device.device_sn,
      stationId: device.parent_sn || device.device_sn,
      kind: device.device_model === 'T8030' ? 'station' : 'camera',
      model: device.device_model,
      name: (device.device_alias_name as string) || device.device_name,
      firmware:
        typeof device.main_sw_version === 'string' && device.main_sw_version
          ? device.main_sw_version
          : null,
      hardware: typeof device.main_hw_version === 'string' ? device.main_hw_version : null,
      battery: null,
    }));
  }
  private deviceTransport(): Promise<DeviceTransport> {
    if (this.closed) return Promise.reject(new EufyError('client_closed'));
    if (this.transportLoading) return this.transportLoading;
    const load = this.loadDeviceTransport();
    this.transportLoading = load;
    void load.then(
      () => {
        if (this.transportLoading === load) this.transportLoading = undefined;
      },
      () => {
        if (this.transportLoading === load) this.transportLoading = undefined;
      },
    );
    return load;
  }
  private async loadDeviceTransport(): Promise<DeviceTransport> {
    if (!this.connected) throw new EufyError('authentication_required');
    if (!this.devices.size) await this.listDevices();
    if (this.closed) throw new EufyError('client_closed');
    if (!this.transport) {
      this.transport = new DeviceTransport();
      this.transport.on('detection', (d) => this.events?.device(d.id, d.type, d.name, d.stranger));
      this.transport.on('push', (message) => this.events?.push(message));
      for (const event of ['device', 'station', 'snapshot', 'live-stop', 'fault'] as const)
        this.transport.on(event, (value) => this.emit(event, value));
    }
    if (this.loaded !== this.devices) {
      await this.transport.load(this.devices);
      this.loaded = this.devices;
    }
    return this.transport;
  }
  async startEvents(signal?: AbortSignal): Promise<void> {
    if (this.eventsOperation) throw new EufyError('events_busy');
    const operation = this.openEvents(signal);
    this.eventsOperation = operation;
    try {
      await operation;
    } finally {
      if (this.eventsOperation === operation) this.eventsOperation = undefined;
    }
  }
  private async openEvents(signal?: AbortSignal): Promise<void> {
    const transport = await this.deviceTransport();
    if (this.closed) throw new EufyError('client_closed');
    if (this.events?.active) return;
    if (this.events) await this.events.close();
    const events = (this.events = new EventTransport(
      this.cloud,
      (id) => this.devices.has(id),
      (message) => transport.processPush(message),
    ));
    for (const name of ['event', 'fault'] as const)
      events.on(name, (value) => this.emit(name, value));
    events.on('connection', (connected) => this.emit('events-connection', connected));
    await events.open(signal);
  }
  async connectStation(id: string, signal?: AbortSignal): Promise<StationState> {
    const t = await this.deviceTransport();
    await t.connect(id, signal);
    return t.state(id);
  }
  async getStationState(id: string): Promise<StationState> {
    return (await this.deviceTransport()).state(id);
  }
  async refreshStationState(id: string, signal?: AbortSignal): Promise<StationState> {
    return (await this.deviceTransport()).refreshStationState(id, signal);
  }
  async setGuardMode(id: string, mode: number, signal?: AbortSignal) {
    return (await this.deviceTransport()).setGuardMode(id, mode, signal);
  }
  async listRecordings(stationId: string, day: string, cameraIds?: string[], signal?: AbortSignal) {
    return (await this.deviceTransport()).recordings.list(stationId, day, cameraIds, signal);
  }
  async recordingCalendar(
    stationId: string,
    month: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    return (await this.deviceTransport()).recordings.calendar(stationId, month, signal);
  }
  async recordingThumbnail(id: string, signal?: AbortSignal): Promise<Buffer> {
    return (await this.deviceTransport()).recordings.thumbnail(id, signal);
  }
  async downloadRecording(id: string, signal?: AbortSignal) {
    return (await this.deviceTransport()).recordings.download(id, signal);
  }
  async snapshot(id: string, signal?: AbortSignal): Promise<Snapshot> {
    return (await this.deviceTransport()).snapshot(id, signal);
  }
  async startLive(id: string, signal?: AbortSignal): Promise<LiveStream> {
    return (await this.deviceTransport()).startLive(id, signal);
  }
  async stopLive(id: string): Promise<StreamStop> {
    if (!this.transport) throw new EufyError('live_session_not_found');
    return this.transport.stopLive(id);
  }
  async ensureLiveStopped(id: string, signal?: AbortSignal): Promise<StreamStop> {
    return (this.transport ?? (await this.deviceTransport())).ensureLiveStopped(id, signal);
  }
  shutdown(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = this.finishShutdown();
    return this.closing;
  }
  private async finishShutdown(): Promise<void> {
    this.cloud.close();
    const eventClose = Promise.allSettled([this.events?.close()]);
    // Cancel owners before waiting. Initialization cannot create new transports
    // after closed is set, and UDP stays available for pending device STOPs.
    await Promise.allSettled([this.authOperation, this.transportLoading, this.eventsOperation]);
    const results = [
      ...(await eventClose),
      ...(await Promise.allSettled([this.transport?.close()])),
    ];
    try {
      await this.cloud.flush();
    } finally {
      this.devices.clear();
      this.removeAllListeners();
    }
    if (results.some((result) => result.status === 'rejected'))
      throw new EufyError('shutdown_incomplete');
  }
  async close(): Promise<void> {
    await this.shutdown();
  }
}
