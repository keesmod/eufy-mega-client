// Independently authored experiment policy. Synthetic events are not E15 wire messages.
// This module has no network or vendor dependency and is not a public client API.
export class SessionTrial {
  #state = 'idle';
  #started;
  #cleanupStarted;
  #identity;
  #seen = new Set();
  #pending = new Set();
  #secret;
  #events = [];
  #lastTime = -Infinity;
  #reason;

  constructor(identity, secret) {
    // Copy only opaque synthetic correlation roles. Do not derive one from another.
    this.#identity = { attempt: identity.attempt, peer: identity.peer, session: identity.session };
    this.#secret = Buffer.from(secret);
  }

  #record(event) {
    if (this.#events.length < 256) this.#events.push(event);
  }
  #time(now) {
    if (!Number.isFinite(now) || now < this.#lastTime) throw new Error('invalid clock');
    this.#lastTime = now;
  }

  start(now, evidence) {
    this.#time(now);
    if (this.#state !== 'idle') throw new Error('attempt already consumed');
    this.#started = now;
    // Evidence flags model prerequisites, never establish actual protocol evidence.
    const missing = ['accountBinding', 'identifierBinding', 'wireTransport', 'peerResponse'].find(
      (key) => evidence[key] !== true,
    );
    if (missing) {
      this.#record(`blocked:${missing}`);
      this.#finish('blocked');
      return;
    }
    this.#state = 'negotiating';
    this.#record('attempt-started');
  }

  advance(now) {
    this.#time(now);
    if (this.#state === 'closing' && now - this.#cleanupStarted >= 5000) {
      this.#finish('cleanup-unconfirmed');
    } else if (['negotiating', 'connected', 'authenticated', 'readable'].includes(this.#state)) {
      if (now - this.#started >= 60000) this.#close(now, 'total-deadline');
      else if (this.#state === 'negotiating' && now - this.#started >= 15000)
        this.#close(now, 'negotiation-deadline');
    }
  }

  receive(now, message) {
    this.advance(now);
    if (!['negotiating', 'connected', 'authenticated', 'readable'].includes(this.#state)) return;
    if (
      !message ||
      message.attempt !== this.#identity.attempt ||
      message.peer !== this.#identity.peer ||
      message.session !== this.#identity.session
    ) {
      this.#record('foreign-or-stale');
      return;
    }
    if (
      typeof message.id !== 'string' ||
      message.id.length > 128 ||
      !['candidate', 'answer', 'peer-authenticated', 'read-only-response'].includes(message.kind)
    ) {
      this.#record('invalid-event');
      return;
    }
    if (this.#seen.has(message.id)) {
      this.#record('duplicate');
      return;
    }
    if (this.#seen.size >= 64) {
      this.#close(now, 'event-limit');
      return;
    }
    this.#seen.add(message.id);
    if (message.kind === 'candidate' && this.#state === 'negotiating') {
      if (this.#pending.size >= 16) {
        this.#close(now, 'candidate-limit');
        return;
      }
      this.#pending.add(message.id);
      this.#record('candidate-buffered');
    } else if (message.kind === 'answer' && this.#state === 'negotiating') {
      this.#pending.clear();
      this.#state = 'connected';
      this.#record('synthetic-answer');
    } else if (message.kind === 'peer-authenticated' && this.#state === 'connected') {
      this.#state = 'authenticated';
      this.#record('synthetic-authentication');
    } else if (message.kind === 'read-only-response' && this.#state === 'authenticated') {
      this.#state = 'readable';
      this.#record('synthetic-read-only-response');
    } else this.#record('out-of-order');
  }

  cancel(now) {
    this.advance(now);
    if (this.#state === 'idle') this.#finish('cancelled-before-start');
    else if (['negotiating', 'connected', 'authenticated', 'readable'].includes(this.#state))
      this.#close(now, 'cancelled');
  }

  #close(now, reason) {
    this.#state = 'closing';
    this.#reason = reason;
    this.#cleanupStarted = now;
    this.#pending.clear();
    this.#secret.fill(0);
    this.#record('close-requested');
  }

  confirmClosed(now) {
    this.advance(now);
    if (this.#state === 'closing') this.#finish(this.#reason);
  }

  #finish(reason) {
    this.#state = 'closed';
    this.#reason = reason;
    this.#pending.clear();
    this.#seen.clear();
    this.#secret.fill(0);
    this.#identity = undefined;
    this.#record(reason === 'cleanup-unconfirmed' ? 'cleanup-unconfirmed' : 'closed');
  }

  inspect() {
    return {
      state: this.#state,
      reason: this.#reason,
      pending: this.#pending.size,
      retainedMessages: this.#seen.size,
      secretCleared: this.#secret.every((byte) => byte === 0),
      events: [...this.#events],
      portablePeerProven: false,
    };
  }
}
