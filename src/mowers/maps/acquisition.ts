import { EufyError } from '../../types.js';
import { FILES } from './framing.js';
import { MapLifetime } from './lifetime.js';
import { runMapSession, validateInputs } from './session.js';
import type {
  MapSessionProvisioning,
  MapAcquisitionDemand,
  MapAcquisitionSnapshot,
  MapAcquisitionResult,
  MapAcquisitionEnd,
  MapStreamName,
} from './types.js';

function copy(snapshot: MapAcquisitionSnapshot | undefined): MapAcquisitionSnapshot | undefined {
  if (!snapshot) return undefined;
  return {
    revision: snapshot.revision,
    receivedAt: snapshot.receivedAt,
    files: Object.fromEntries(
      FILES.map((name) => [name, new Uint8Array(snapshot.files[name])]),
    ) as MapAcquisitionSnapshot['files'],
  };
}

/** One bound mower, one active read-only demand. No retry, movement or automatic polling. */
export class PortableMapAcquisition {
  #inputs?: MapSessionProvisioning;
  #last?: MapAcquisitionSnapshot;
  #revision = 0;
  #active?: { owner: MapLifetime; result: Promise<MapAcquisitionResult> };
  #shutdown?: Promise<void>;

  constructor(provisioning: MapSessionProvisioning) {
    try {
      if (JSON.stringify(provisioning).length > 65536) throw new Error();
      const inputs = structuredClone(provisioning);
      validateInputs(inputs);
      this.#inputs = inputs;
    } catch {
      throw new EufyError('mower_map_invalid_provisioning');
    }
  }

  get lastComplete(): MapAcquisitionSnapshot | undefined {
    return copy(this.#last);
  }
  get active(): boolean {
    return !!this.#active;
  }

  acquire(demand: MapAcquisitionDemand = {}): Promise<MapAcquisitionResult> {
    if (!this.#inputs || this.#shutdown) return Promise.reject(new EufyError('client_closed'));
    if (this.#active) return Promise.reject(new EufyError('mower_map_busy'));
    const duration = demand.demandMs ?? 30000;
    if (!Number.isInteger(duration) || duration < 1 || duration > 60000)
      return Promise.reject(new EufyError('mower_map_invalid_demand'));
    try {
      validateInputs(this.#inputs);
    } catch {
      return Promise.reject(new EufyError('mower_map_invalid_provisioning'));
    }
    const owner = new MapLifetime();
    const abort = () => owner.stop('aborted');
    demand.signal?.addEventListener('abort', abort, { once: true });
    if (demand.signal?.aborted) abort();
    owner.timer(() => owner.stop('demand_expired'), duration);
    const inputs = this.#inputs;
    const result = Promise.resolve()
      .then(() => this.#run(inputs, owner))
      .finally(() => {
        demand.signal?.removeEventListener('abort', abort);
        this.#active = undefined;
      });
    this.#active = { owner, result };
    return result;
  }

  async #run(inputs: MapSessionProvisioning, owner: MapLifetime): Promise<MapAcquisitionResult> {
    const files = new Map<MapStreamName, Buffer>();
    let cancellationConfirmed = false;
    let failure: MapAcquisitionEnd | undefined;
    try {
      if (!owner.reason)
        cancellationConfirmed = await runMapSession(inputs, owner, (completed) => {
          if (owner.reason || owner.signal.aborted) return;
          for (const file of completed) {
            files.get(file.name)?.fill(0);
            files.set(file.name, file.data);
          }
          if (!completed.length || !FILES.every((name) => files.has(name))) return;
          const next: MapAcquisitionSnapshot = {
            revision: ++this.#revision,
            receivedAt: Date.now(),
            files: Object.fromEntries(
              FILES.map((name) => [name, new Uint8Array(files.get(name)!)]),
            ) as MapAcquisitionSnapshot['files'],
          };
          this.#eraseSnapshot();
          this.#last = next;
        });
    } catch (error) {
      // Never propagate network payloads, hostnames, keys or arbitrary exception messages.
      const message = error instanceof Error ? error.message : '';
      if (owner.signal.aborted || (owner.reason && message !== 'session-stopped'))
        failure = 'cancel_unconfirmed';
      else if (!owner.reason)
        failure = ['socket-closed', 'socket-failed'].includes(message)
          ? 'connection_failed'
          : 'protocol_error';
    }
    const cleanupConfirmed = await owner.close();
    if (!cleanupConfirmed) this.#inputs = undefined;
    for (const bytes of files.values()) bytes.fill(0);
    files.clear();
    return {
      reason: !cleanupConfirmed
        ? 'cleanup_unconfirmed'
        : (failure ?? owner.reason ?? 'protocol_error'),
      cancellationConfirmed,
      cleanupConfirmed,
      lastComplete: this.lastComplete,
    };
  }

  async disconnect(): Promise<void> {
    this.#active?.owner.stop('disconnected');
    const result = await this.#active?.result;
    if (result && !result.cleanupConfirmed) throw new EufyError('shutdown_incomplete');
  }

  shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    this.#active?.owner.stop('shutdown');
    this.#inputs = undefined;
    this.#shutdown = (async () => {
      const result = await this.#active?.result;
      if (result && !result.cleanupConfirmed) throw new EufyError('shutdown_incomplete');
    })();
    return this.#shutdown;
  }

  /** Explicitly release retained private bytes when no demand is active. */
  clearLastComplete(): void {
    if (this.#active) throw new EufyError('mower_map_busy');
    this.#eraseSnapshot();
  }
  #eraseSnapshot(): void {
    if (this.#last) for (const bytes of Object.values(this.#last.files)) bytes.fill(0);
    this.#last = undefined;
  }
}
