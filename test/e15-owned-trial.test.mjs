import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { ownedTrial } from '../scripts/research/e15-owned-trial.mjs';
const budget = { negotiationMs: 80, totalMs: 180, cleanupMs: 100 };
function stall(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}
test('negotiation deadline actually closes an owned TCP socket', async () => {
  const accepted = [];
  const server = net.createServer((s) => accepted.push(s));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let closed = false;
  try {
    const result = await ownedTrial(async (owner) => {
      const socket = new net.Socket();
      socket.on('error', () => {});
      const closing = once(socket, 'close').then(() => {
        closed = true;
        return true;
      });
      owner.own({
        close: () => {
          socket.destroy();
          return closing;
        },
      });
      await owner.track(async (signal) => {
        socket.connect(server.address().port, '127.0.0.1');
        await once(socket, 'connect', { signal });
        await stall(signal);
      });
    }, budget);
    assert.equal(result.reason, 'negotiation-deadline');
    assert.equal(result.success, false);
    assert.equal(result.cleanupConfirmed, true);
    assert.equal(closed, true);
  } finally {
    for (const s of accepted) s.destroy();
    await new Promise((r) => server.close(r));
  }
});
test('total deadline cancels an authenticated but unreadable session', async () => {
  const result = await ownedTrial(async (owner) => {
    owner.negotiated();
    return owner.track(stall);
  }, budget);
  assert.equal(result.reason, 'total-deadline');
  assert.equal(result.success, false);
  assert.equal(result.cleanupConfirmed, true);
});
test('uncooperative producers prevent successful cleanup', async () => {
  const result = await ownedTrial(async (owner) => {
    owner.negotiated();
    owner.track(() => new Promise(() => {}));
    return { authenticatedReadOnly: true };
  }, budget);
  assert.equal(result.reason, 'cleanup-unconfirmed');
  assert.equal(result.success, false);
});
test('external cancellation during cleanup overrides a positive candidate', async () => {
  const abort = new AbortController();
  const result = await ownedTrial(
    async (owner) => {
      owner.own({
        close: async () => {
          abort.abort();
          return true;
        },
      });
      owner.negotiated();
      return { authenticatedReadOnly: true };
    },
    { ...budget, signal: abort.signal },
  );
  assert.equal(result.reason, 'cancelled');
  assert.equal(result.success, false);
});
test('positive proof requires actual confirmed resource closure', async () => {
  for (const confirmed of [true, false]) {
    const result = await ownedTrial(async (owner) => {
      owner.own({ close: async () => confirmed });
      owner.negotiated();
      return { authenticatedReadOnly: true };
    }, budget);
    assert.equal(result.success, confirmed);
    assert.equal(result.cleanupConfirmed, confirmed);
  }
});
