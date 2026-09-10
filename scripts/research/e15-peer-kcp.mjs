// Independently authored bounded KCP wire subset for the reliable TCP research trial.
// Protocol reference: https://github.com/skywind3000/kcp/blob/master/ikcp.c
// No application retry or retransmission is performed by this one-attempt trial.
export class TrialKcp {
  #channel;
  #sendLimit;
  #messageLimit;
  constructor({ channel = 0, sendLimit = 2, messageLimit = 16 } = {}) {
    if (
      ![0, 5].includes(channel) ||
      !Number.isInteger(sendLimit) ||
      sendLimit < 0 ||
      sendLimit > 5 ||
      !Number.isInteger(messageLimit) ||
      messageLimit < 1 ||
      messageLimit > 16384
    )
      throw new Error('invalid-kcp-budget');
    this.#channel = channel;
    this.#sendLimit = sendLimit;
    this.#messageLimit = messageLimit;
  }
  #sendNext = 0;
  #receiveNext = 0;
  #pending = new Map();
  #fragments = [];
  #remaining;
  #closed = false;
  #messages = 0;
  #packet(command, fragment, timestamp, sequence, payload = Buffer.alloc(0)) {
    const b = Buffer.alloc(24 + payload.length);
    b.writeUInt32LE(this.#channel);
    b[4] = command;
    b[5] = fragment;
    b.writeUInt16LE(128, 6);
    b.writeUInt32LE(timestamp >>> 0, 8);
    b.writeUInt32LE(sequence, 12);
    b.writeUInt32LE(this.#receiveNext, 16);
    b.writeUInt32LE(payload.length, 20);
    payload.copy(b, 24);
    return b;
  }
  send(payload, now) {
    if (
      this.#closed ||
      this.#sendNext >= this.#sendLimit ||
      payload.length > 1328 ||
      !payload.length
    )
      throw new Error('trial-send-limit');
    return this.#packet(81, 0, now, this.#sendNext++, payload);
  }
  receive(bytes) {
    if (this.#closed) throw new Error('trial-closed');
    const output = [],
      messages = [];
    while (bytes.length) {
      if (bytes.length < 24 || bytes.readUInt32LE() !== this.#channel)
        throw new Error('invalid-kcp-channel');
      const cmd = bytes[4],
        fragment = bytes[5],
        stamp = bytes.readUInt32LE(8),
        sn = bytes.readUInt32LE(12),
        una = bytes.readUInt32LE(16),
        length = bytes.readUInt32LE(20);
      if (
        ![81, 82, 83, 84].includes(cmd) ||
        length > 1376 ||
        length + 24 > bytes.length ||
        una > this.#sendNext ||
        fragment > 7 ||
        (cmd !== 81 && length !== 0)
      )
        throw new Error('invalid-kcp-segment');
      const payload = bytes.subarray(24, 24 + length);
      bytes = bytes.subarray(24 + length);
      if (cmd === 81) {
        if (!length || sn >= this.#receiveNext + 128) throw new Error('invalid-kcp-window');
        if (sn >= this.#receiveNext && !this.#pending.has(sn)) {
          if (this.#pending.size >= 16) throw new Error('trial-receive-limit');
          this.#pending.set(sn, { fragment, payload: Buffer.from(payload) });
        }
        while (this.#pending.has(this.#receiveNext)) {
          const part = this.#pending.get(this.#receiveNext);
          this.#pending.delete(this.#receiveNext++);
          if (this.#remaining !== undefined && part.fragment !== this.#remaining - 1)
            throw new Error('invalid-kcp-fragments');
          this.#remaining = part.fragment;
          this.#fragments.push(part.payload);
          if (part.fragment === 0) {
            if (++this.#messages > this.#messageLimit) throw new Error('trial-message-limit');
            messages.push(Buffer.concat(this.#fragments));
            this.#fragments = [];
            this.#remaining = undefined;
          }
        }
        output.push(this.#packet(82, 0, stamp, sn));
      } else if (cmd === 83) output.push(this.#packet(84, 0, 0, 0));
    }
    return { output, messages };
  }
  close() {
    this.#closed = true;
    for (const value of this.#pending.values()) value.payload.fill(0);
    for (const value of this.#fragments) value.fill(0);
    this.#pending.clear();
    this.#fragments = [];
  }
}
