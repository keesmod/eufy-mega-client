import type { MapAcquisitionEnd } from './types.js';

/** All sockets register before I/O. Soft stop permits one cancel before hard closure. */
export class MapLifetime {
  readonly hard = new AbortController();
  readonly stopped: Promise<void>;
  reason?: MapAcquisitionEnd;
  #resolve!: () => void;
  #resources = new Set<{ close(): Promise<boolean> }>();
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #closed?: Promise<boolean>;
  #pending = new Set<Promise<unknown>>();
  constructor() {
    this.stopped = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }
  get signal(): AbortSignal {
    return this.hard.signal;
  }
  stop(reason: MapAcquisitionEnd): void {
    if (this.reason) return;
    this.reason = reason;
    this.#resolve();
  }
  timer(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      callback();
    }, ms);
    this.#timers.add(timer);
    return timer;
  }
  clear(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer);
    this.#timers.delete(timer);
  }
  own<T extends { close(): Promise<boolean> }>(resource: T): T {
    if (this.signal.aborted || this.#resources.size >= 8) throw new Error('resource-limit');
    this.#resources.add(resource);
    return resource;
  }
  async negotiating<T>(task: Promise<T>): Promise<T> {
    this.#pending.add(task);
    task.finally(() => this.#pending.delete(task)).catch(() => {});
    if (this.reason) throw new Error('session-stopped');
    return Promise.race([
      task,
      this.stopped.then(() => {
        throw new Error('session-stopped');
      }),
    ]);
  }
  close(): Promise<boolean> {
    if (this.#closed) return this.#closed;
    this.hard.abort();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#closed = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          Promise.allSettled(
            [...this.#resources].map((resource) => Promise.resolve().then(() => resource.close())),
          ).then(async (results) => {
            await Promise.allSettled([...this.#pending]);
            return results.every((r) => r.status === 'fulfilled' && r.value);
          }),
          new Promise<false>((resolve) => {
            timeout = setTimeout(() => resolve(false), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        this.#resources.clear();
      }
    })();
    return this.#closed;
  }
}
