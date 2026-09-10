import { EventEmitter } from 'node:events';
import { PushNotificationService } from './vendor/push/service.js';
import type { PushMessage, Credentials as PushCredentials } from './vendor/push/models.js';
import { Detections } from './detections.js';
import { MegaCloud } from './cloud.js';
import { EufyError, type DetectionEvent, type EventSession } from './types.js';

export class EventTransport extends EventEmitter {
  private service?: PushNotificationService;
  private registration?: PushCredentials;
  private readonly detections: Detections;
  private saving: Promise<void> = Promise.resolve();
  private connected = false;
  private closed = false;
  private readonly lifetime = new AbortController();
  constructor(
    private readonly cloud: MegaCloud,
    known: (id: string) => boolean,
    private readonly devicePush: (message: PushMessage) => void,
  ) {
    super();
    this.detections = new Detections(
      known,
      (n) => {
        const event: DetectionEvent = {
          id: n.id,
          deviceId: n.serial,
          type: n.event_type,
          receivedAt: n.received_at,
          occurredAt: n.occurred_at,
          source: n.source,
          personName: n.person_name,
          recognition: n.recognition,
          ...(n.eufy_event_type === undefined ? {} : { vendorEventType: n.eufy_event_type }),
        };
        this.emit('event', event);
      },
      () => {
        void this.persist().catch(() =>
          this.emit('fault', new EufyError('event_session_write_failed')),
        );
      },
    );
  }
  get active(): boolean {
    return this.connected;
  }
  get status() {
    const m = this.detections.metrics;
    return {
      connected: this.connected,
      received: m.received,
      duplicates: m.duplicates,
      lastReceivedAt: m.last_received_at,
    };
  }
  device(id: string, type: string, name?: string, stranger = false): void {
    if (!this.closed) this.detections.device(id, type, name, stranger);
  }
  push(message: PushMessage): void {
    if (this.closed) return;
    try {
      this.detections.push(message);
      this.devicePush(message);
    } catch {
      this.emit('fault', new EufyError('invalid_event'));
    }
  }
  private persist(): Promise<void> {
    if (!this.registration) return Promise.resolve();
    const state: EventSession = {
      version: 1,
      registration: JSON.stringify(this.registration),
      persistentIds: (this.service?.getPersistentIds() ?? []).slice(-2048),
      seen: this.detections.exportSeen(),
    };
    const saving = this.saving.catch(() => {}).then(() => this.cloud.saveEventSession(state));
    this.saving = saving;
    return saving;
  }
  async open(signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new EufyError('event_transport_closed');
    if (this.service) throw new EufyError('events_already_started');
    const service = (this.service = await PushNotificationService.initialize());
    if (this.closed) {
      service.close();
      throw new EufyError('cancelled');
    }
    const saved = this.cloud.getEventSession();
    if (saved?.version === 1) {
      try {
        const r = JSON.parse(saved.registration) as PushCredentials;
        if (
          !r.checkinResponse?.androidId ||
          !r.checkinResponse?.securityToken ||
          !r.fidResponse?.authToken ||
          !r.gcmResponse?.token
        )
          throw new Error();
        this.registration = r;
        service.setCredentials(r);
        service.setPersistentIds(saved.persistentIds.slice(-2048));
        this.detections.restoreSeen(saved.seen);
      } catch {
        await this.close().catch(() => {});
        throw new EufyError('invalid_event_session');
      }
    }
    let success!: () => void, failed!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      success = resolve;
      failed = reject;
    });
    const abort = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    const timer = setTimeout(() => failed(new EufyError('event_connection_timeout')), 30000);
    const cancel = () => failed(new EufyError('cancelled'));
    abort.addEventListener('abort', cancel, { once: true });
    service.on('credential', (registration) => {
      this.registration = registration;
      void this.persist().catch(() => failed(new EufyError('event_session_write_failed')));
    });
    service.on('connect', (token) => {
      void (async () => {
        if (this.closed) return;
        await this.persist();
        await this.cloud.call(
          'push',
          '/app/push/register_push_token',
          { token, is_notification_enable: true, voip_token: '' },
          this.lifetime.signal,
        );
        if (this.closed) return;
        this.connected = true;
        this.emit('connection', true);
        success();
      })().catch(() => {
        this.connected = false;
        failed(new EufyError('event_registration_failed'));
        this.emit('fault', new EufyError('event_registration_failed'));
      });
    });
    service.on('close', () => {
      this.connected = false;
      this.emit('connection', false);
    });
    service.on('message', (message) => {
      this.push(message);
      void this.persist().catch(() =>
        this.emit('fault', new EufyError('event_session_write_failed')),
      );
    });
    try {
      if (abort.aborted) cancel();
      await Promise.all([
        ready,
        service.open().then((credentials) => {
          if (!credentials) throw new EufyError('event_registration_failed');
        }),
      ]);
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      abort.removeEventListener('abort', cancel);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;
    this.lifetime.abort();
    this.service?.close();
    try {
      await this.persist();
      await this.saving;
    } finally {
      this.detections.close();
      this.removeAllListeners();
    }
  }
}
