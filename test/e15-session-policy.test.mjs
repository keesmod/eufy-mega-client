import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionTrial } from '../scripts/research/e15-session-policy.mjs';

const identity = {
  attempt: 'synthetic-attempt',
  peer: 'synthetic-peer',
  session: 'synthetic-session',
};
const ready = {
  accountBinding: true,
  identifierBinding: true,
  wireTransport: true,
  peerResponse: true,
};
const event = (kind, id = kind, extra = {}) => ({ ...identity, kind, id, ...extra });
const make = () => new SessionTrial(identity, Buffer.from('synthetic-secret-never-log'));

test('every unproven prerequisite blocks before negotiation', () => {
  for (const key of Object.keys(ready)) {
    const trial = make();
    trial.start(0, { ...ready, [key]: false });
    assert.equal(trial.inspect().reason, 'blocked');
    assert.ok(trial.inspect().events.includes(`blocked:${key}`));
    assert.ok(trial.inspect().secretCleared);
    assert.throws(() => trial.start(1, ready), /consumed/);
  }
});

test('candidate ordering, stale/foreign input and duplicates cannot authenticate', () => {
  const trial = make();
  trial.start(0, ready);
  trial.receive(1, event('candidate'));
  trial.receive(2, event('candidate'));
  for (const role of Object.keys(identity))
    trial.receive(3, event('answer', role, { [role]: 'foreign' }));
  trial.receive(4, event('peer-authenticated'));
  trial.receive(5, event('read-only-response'));
  assert.equal(trial.inspect().state, 'negotiating');
  assert.equal(trial.inspect().pending, 1);
  trial.receive(6, event('answer'));
  assert.equal(trial.inspect().state, 'connected');
  assert.equal(trial.inspect().pending, 0);
  assert.equal(trial.inspect().portablePeerProven, false);
  trial.cancel(7);
  trial.confirmClosed(8);
});

test('synthetic read-only sequence remains explicitly synthetic and closes once', () => {
  const trial = make();
  trial.start(0, ready);
  trial.receive(1, event('answer'));
  trial.receive(2, event('peer-authenticated'));
  trial.receive(3, event('read-only-response'));
  assert.equal(trial.inspect().state, 'readable');
  assert.equal(trial.inspect().portablePeerProven, false);
  trial.cancel(4);
  trial.cancel(5);
  trial.confirmClosed(6);
  trial.confirmClosed(7);
  trial.receive(8, event('answer', 'late'));
  assert.equal(trial.inspect().events.filter((x) => x === 'close-requested').length, 1);
  assert.equal(trial.inspect().retainedMessages, 0);
  assert.equal(trial.inspect().state, 'closed');
  assert.ok(trial.inspect().secretCleared);
  assert.throws(() => trial.start(9, ready), /consumed/);
});

test('negotiation deadline includes the boundary, late answer cannot rescue it', () => {
  const trial = make();
  trial.start(100, ready);
  trial.advance(15099);
  assert.equal(trial.inspect().state, 'negotiating');
  trial.receive(15100, event('answer'));
  assert.equal(trial.inspect().state, 'closing');
  trial.confirmClosed(15101);
  assert.equal(trial.inspect().reason, 'negotiation-deadline');
});

test('total deadline is not reset by progress and cleanup timeout is not confirmation', () => {
  const trial = make();
  trial.start(0, ready);
  trial.receive(14999, event('answer'));
  trial.receive(59999, event('peer-authenticated'));
  trial.advance(60000);
  assert.equal(trial.inspect().state, 'closing');
  trial.advance(64999);
  assert.equal(trial.inspect().state, 'closing');
  trial.confirmClosed(65000);
  assert.equal(trial.inspect().reason, 'cleanup-unconfirmed');
  assert.ok(trial.inspect().secretCleared);
});

test('cancellation consumes the attempt before start or during every stage', () => {
  for (let stage = -1; stage <= 3; stage++) {
    const trial = make();
    if (stage >= 0) trial.start(0, ready);
    ['answer', 'peer-authenticated', 'read-only-response']
      .slice(0, Math.max(0, stage))
      .forEach((kind, i) => trial.receive(i + 1, event(kind)));
    trial.cancel(4);
    trial.confirmClosed(5);
    assert.equal(trial.inspect().state, 'closed');
    assert.ok(trial.inspect().secretCleared);
    assert.throws(() => trial.start(6, ready), /consumed/);
  }
});

test('bounded candidate and event storage stops floods', () => {
  for (const kind of ['candidate', 'read-only-response']) {
    const trial = make();
    trial.start(0, ready);
    for (let i = 0; i < 80; i++) trial.receive(i, event(kind, String(i)));
    assert.equal(trial.inspect().state, 'closing');
    trial.confirmClosed(81);
    assert.equal(trial.inspect().reason, kind === 'candidate' ? 'candidate-limit' : 'event-limit');
  }
});

test('structure-only diagnostics ignore secret-bearing fields and malformed input', () => {
  const trial = make();
  trial.start(0, ready);
  trial.receive(1, event('unknown-secret-event', 'private-message', { payload: 'raw-secret' }));
  trial.receive(2, null);
  trial.cancel(3);
  trial.confirmClosed(4);
  const output = JSON.stringify(trial.inspect());
  for (const value of [
    ...Object.values(identity),
    'synthetic-secret-never-log',
    'raw-secret',
    'private-message',
    'unknown-secret-event',
  ])
    assert.equal(output.includes(value), false);
});

test('invalid or backwards clocks cannot extend a trial', () => {
  const trial = make();
  trial.start(10, ready);
  for (const time of [9, NaN, Infinity]) assert.throws(() => trial.advance(time), /clock/);
  trial.cancel(11);
  trial.confirmClosed(12);
});

test('duplicate floods cannot grow diagnostics without bound', () => {
  const trial = make();
  trial.start(0, ready);
  for (let i = 0; i < 1000; i++) trial.receive(i, event('candidate'));
  assert.equal(trial.inspect().events.length, 256);
  assert.equal(trial.inspect().pending, 1);
  trial.cancel(1000);
  trial.confirmClosed(1001);
  assert.equal(trial.inspect().state, 'closed');
});
