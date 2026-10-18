import { discover, type Inventory } from './discovery.js';
import { EventEmitter } from 'node:events';
import { EventTransport } from './event-transport.js';
import { DeviceTransport } from './device-transport.js';
import { StandalonePushCounter } from './standalone-events.js';
import { MegaCloud, responseObject } from './cloud.js';
import {
  EufyError,
  type ClientEvents,
  type AuthAnswer,
  type AuthState,
  type ClientOptions,
  type Device,
  type DiscoveryResult,
  type WireDevice,
  type StationState,
  type Snapshot,
  type LiveStream,
  type LiveStartOptions,
  type RecordingObservation,
  type RecordingOperationOptions,
  type StationConnectOptions,
  type StreamStop,
  type StandalonePushObservation,
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
  private inventory?: Inventory;
  private loaded?: Map<string, WireDevice>;
  private devices = new Map<string, WireDevice>();
  private readonly liveLimit: number;
  private readonly liveUpperBound: number;
  private readonly experimentalStandalone: boolean;
  constructor(options: ClientOptions) {
    super();
    this.cloud = new MegaCloud(options);
    const limit = options.maxLiveStreamsPerStation ?? 1;
    if (!Number.isInteger(limit) || limit < 1 || limit > 4)
      throw new EufyError('invalid_live_stream_limit');
    this.liveLimit = limit;
    const bound = options.liveUpperBoundMs ?? 120000;
    if (!Number.isInteger(bound) || bound < 120000 || bound > 3_600_000)
      throw new EufyError('invalid_live_bound');
    this.liveUpperBound = bound;
    this.experimentalStandalone = options.experimentalStandalone === true;
  }
  get connected(): boolean {
    return this.cloud.connected;
  }
  get eventStatus() {
    return (
      this.events?.status ?? { connected: false, received: 0, duplicates: 0, lastReceivedAt: null }
    );
  }
  /**
   * ha-eufy-cam#185: numbers-only counts of the pushes that name an experimental
   * standalone owner. Synchronous, no I/O. Counts only pushes that reach running
   * events, kept across startEvents restarts, and zero before the device
   * transport exists. See docs/API.md, standalone events.
   */
  get standalonePushStatus(): StandalonePushObservation {
    return this.transport?.standalonePushStatus() ?? new StandalonePushCounter().snapshot();
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
    return (await this.discoverDevices(signal)).devices;
  }
  async discoverDevices(signal?: AbortSignal): Promise<DiscoveryResult> {
    const result = responseObject(
      await this.cloud.call(
        'house',
        '/app/house/get_devs_list',
        { device_sn: '', num: 100, orderby: '' },
        signal,
      ),
    );
    const inventory = discover(result.devices, {
      experimentalStandalone: this.experimentalStandalone,
    });
    if (this.closed) throw new EufyError('client_closed');
    this.inventory = inventory;
    this.devices = inventory.raw;
    return structuredClone(inventory.result);
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
    if (!this.inventory) await this.listDevices();
    if (this.closed) throw new EufyError('client_closed');
    if (!this.transport) {
      this.transport = new DeviceTransport({
        maxLiveStreamsPerStation: this.liveLimit,
        liveUpperBoundMs: this.liveUpperBound,
      });
      this.transport.on('detection', (d) => this.events?.device(d.id, d.type, d.name, d.stranger));
      // Camera push notifications over an open device session.
      this.transport.on('push', (message) => this.events?.push(message, 'local'));
      for (const event of ['device', 'station', 'snapshot', 'live-stop', 'fault'] as const)
        this.transport.on(event, (value) => this.emit(event, value));
    }
    if (this.loaded !== this.devices) {
      const devices = this.devices,
        inventory = this.inventory;
      await this.transport.load(devices, inventory);
      this.loaded = devices;
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
      (id) => {
        const relationship = this.inventory?.relationships.get(id);
        // ha-eufy-cam#185: a standalone owner whose exact profile allows events.
        return (
          ((relationship?.kind === 'station' &&
            this.devices.get(id)?.parent_sn === relationship.ownerId) ||
            transport.standaloneEvents(id)) &&
          transport.supportsEvent(id, 'notification')
        );
      },
      (message) => transport.processPush(message),
      (message, source) => transport.filterPush(message, source),
    ));
    for (const name of ['event', 'fault'] as const)
      events.on(name, (value) => this.emit(name, value));
    events.on('connection', (connected) => this.emit('events-connection', connected));
    await events.open(signal);
  }
  async connectStation(
    id: string,
    options?: AbortSignal | StationConnectOptions,
  ): Promise<StationState> {
    const { signal, onProgress, onLookup } =
      options instanceof AbortSignal ? { signal: options } : (options ?? {});
    const t = await this.deviceTransport();
    await t.connect(id, signal, onProgress, onLookup);
    return t.state(id);
  }
  async getDeviceState(id: string): Promise<Device> {
    return (await this.deviceTransport()).device(id);
  }
  /** Inspect the current software guards without opening a device connection. */
  async getCameraCapabilities(id: string) {
    return (await this.deviceTransport()).cameraCapabilities(id);
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
  /**
   * `options` is an abort signal or {@link RecordingOperationOptions}, which can
   * also observe the operation and its connection. The same holds for the
   * calendar, thumbnail and download below. See docs/API.md, recordings.
   */
  async listRecordings(
    stationId: string,
    day: string,
    cameraIds?: string[],
    options?: AbortSignal | RecordingOperationOptions,
  ) {
    return (await this.deviceTransport()).recordings.list(stationId, day, cameraIds, options);
  }
  async recordingCalendar(
    stationId: string,
    month: string,
    options?: AbortSignal | RecordingOperationOptions,
  ): Promise<string[]> {
    return (await this.deviceTransport()).recordings.calendar(stationId, month, options);
  }
  async recordingThumbnail(
    id: string,
    options?: AbortSignal | RecordingOperationOptions,
  ): Promise<Buffer> {
    return (await this.deviceTransport()).recordings.thumbnail(id, options);
  }
  async downloadRecording(id: string, options?: AbortSignal | RecordingOperationOptions) {
    return (await this.deviceTransport()).recordings.download(id, options);
  }
  /**
   * ha-eufy-cam#178, diagnostic only: sends one read-only 10017 request for the
   * newest page of today's records to an experimental standalone camera and
   * resolves with what it saw, for every outcome after admission. Any other ID
   * fails with `operation_outside_hardware_scope` before any connection. It
   * creates no recording ID and leaves the recordings capability unavailable.
   * See docs/API.md, standalone recording probe.
   */
  async probeStandaloneRecordings(
    id: string,
    options?: Omit<RecordingOperationOptions, 'onObservation'>,
  ): Promise<RecordingObservation> {
    return (await this.deviceTransport()).recordings.probe(id, options);
  }
  async snapshot(id: string, signal?: AbortSignal): Promise<Snapshot> {
    return (await this.deviceTransport()).snapshot(id, signal);
  }
  async startLive(id: string, options?: AbortSignal | LiveStartOptions): Promise<LiveStream> {
    const { signal, maxDurationMs, onProgress } =
      options instanceof AbortSignal ? { signal: options } : (options ?? {});
    return (await this.deviceTransport()).startLive(id, signal, maxDurationMs, onProgress);
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
