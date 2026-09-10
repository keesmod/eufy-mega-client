import { performance } from 'node:perf_hooks';

// Every asynchronous producer and socket must be owned before it starts I/O.
export async function ownedTrial(
  operation,
  { signal, negotiationMs = 15000, totalMs = 60000, cleanupMs = 5000 } = {},
) {
  if (
    ![negotiationMs, totalMs, cleanupMs].every(Number.isInteger) ||
    negotiationMs < 1 ||
    negotiationMs > 15000 ||
    totalMs < negotiationMs ||
    totalMs > 60000 ||
    cleanupMs < 1 ||
    cleanupMs > 5000
  )
    throw new Error('invalid-trial-budget');
  const start = performance.now(),
    abort = new AbortController(),
    resources = new Set(),
    pending = new Set();
  let reason,
    negotiated = false,
    candidate,
    cleanupConfirmed = false;
  const stop = (code) => {
    reason ??= code;
    abort.abort();
  };
  const external = () => stop('cancelled');
  signal?.addEventListener('abort', external, { once: true });
  const negotiation = setTimeout(() => stop('negotiation-deadline'), negotiationMs);
  const total = setTimeout(() => stop('total-deadline'), totalMs);
  const lifetime = {
    signal: abort.signal,
    own(resource) {
      // A close operation is idempotent and resolves only after actual I/O closure.
      if (abort.signal.aborted) throw new Error('trial-closed');
      if (resources.size >= 8 || typeof resource.close !== 'function')
        throw new Error('resource-limit');
      resources.add(resource);
      return resource;
    },
    track(make) {
      if (abort.signal.aborted) return Promise.reject(new Error('trial-closed'));
      const task = Promise.resolve().then(() => {
        if (abort.signal.aborted) throw new Error('trial-closed');
        return make(abort.signal);
      });
      pending.add(task);
      task.finally(() => pending.delete(task)).catch(() => {});
      return task;
    },
    negotiated() {
      if (abort.signal.aborted || negotiated) throw new Error('invalid-negotiation');
      negotiated = true;
      clearTimeout(negotiation);
    },
  };
  try {
    if (signal?.aborted) stop('cancelled');
    const aborted = new Promise((_, reject) => {
      if (abort.signal.aborted) reject(new Error('trial-aborted'));
      else
        abort.signal.addEventListener('abort', () => reject(new Error('trial-aborted')), {
          once: true,
        });
    });
    candidate = await Promise.race([lifetime.track(() => operation(lifetime)), aborted]);
    if (!negotiated || candidate?.authenticatedReadOnly !== true) reason ??= 'peer-proof-missing';
  } catch (error) {
    reason ??= /^[a-z][a-z0-9-]{0,79}$/.test(error?.message ?? '') ? error.message : 'trial-failed';
  } finally {
    clearTimeout(negotiation);
    clearTimeout(total);
    // Set abort first, then close every owner and wait for all producer promises.
    abort.abort();
    let timer;
    try {
      cleanupConfirmed = await Promise.race([
        Promise.allSettled([...resources].map((r) => Promise.resolve().then(() => r.close()))).then(
          async (results) => {
            await Promise.allSettled([...pending]);
            return results.every((r) => r.status === 'fulfilled' && r.value === true);
          },
        ),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), cleanupMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', external);
    }
  }
  return {
    success: !reason && cleanupConfirmed,
    reason: cleanupConfirmed ? (reason ?? 'authenticated-read-only') : 'cleanup-unconfirmed',
    cleanupConfirmed,
    elapsedMs: Math.round(performance.now() - start),
  };
}
