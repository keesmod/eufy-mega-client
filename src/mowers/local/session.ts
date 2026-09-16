// Read-only local Tuya 3.5 session owner for one E15. Protocol facts and their permitted
// sources: docs/MOWER_TRANSPORT_PROVENANCE.md. No DP writes, commands or settings exist here.
import net from 'node:net';
import { once } from 'node:events';
import { EufyError } from '../../types.js';
import type {
  MowerDpSnapshot,
  MowerLocalSession,
  MowerLocalSessionEnd,
  MowerLocalSessionOptions,
} from '../../modular-types.js';
import {
  Command,
  FrameReader,
  LOCAL_PORT,
  decodeFrame,
  decodeStatus,
  deriveSessionKey,
  encodeFrame,
  localKeyBytes,
  sessionKeyFinish,
  sessionKeyStart,
  sha256,
  splitReturnCode,
  verifySessionKeyResponse,
  type DecodedFrame,
} from './frame.js';

/** Private binding lent by the cloud owner for key negotiation only. Never retained. */
export interface LocalBinding {
  readonly deviceId: string;
  readonly localKey: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
/** Unsolicited reports and heartbeat replies may precede a query response. */
const MAX_SKIPPED_FRAMES = 32;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

function validateOptions(options: MowerLocalSessionOptions) {
  const host = options?.host;
  if (
    typeof host !== 'string' ||
    host.length === 0 ||
    host.length > 253 ||
    !(net.isIP(host) || HOSTNAME.test(host))
  )
    throw new EufyError('mower_invalid_options');
  const port = options.port ?? LOCAL_PORT;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new EufyError('mower_invalid_options');
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60_000)
    throw new EufyError('mower_invalid_options');
  return { host, port, timeout };
}

/** One TCP connection, one operation at a time, no retry and no automatic reconnect. */
export class LocalMowerSession implements MowerLocalSession {
  readonly closed: Promise<MowerLocalSessionEnd>;
  readonly #host: string;
  readonly #port: number;
  readonly #timeout: number;
  readonly #lifetime: AbortSignal;
  #socket?: net.Socket;
  #socketConnected = false;
  #socketClosed = false;
  #failure?: MowerLocalSessionEnd;
  #reader = new FrameReader();
  #key?: Buffer;
  #deviceHash?: string;
  #sequence = 1;
  #busy = false;
  #end?: MowerLocalSessionEnd;
  #resolveClosed!: (end: MowerLocalSessionEnd) => void;
  #wake?: () => void;
  readonly #onLifetimeAbort = () => this.#finish('shutdown');

  constructor(options: MowerLocalSessionOptions, lifetime: AbortSignal) {
    const valid = validateOptions(options);
    this.#host = valid.host;
    this.#port = valid.port;
    this.#timeout = valid.timeout;
    this.#lifetime = lifetime;
    this.closed = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
    if (lifetime.aborted) throw new EufyError('client_closed');
    lifetime.addEventListener('abort', this.#onLifetimeAbort, { once: true });
  }

  get connected(): boolean {
    return !!this.#key && !this.#end && !this.#socketClosed;
  }

  /** Connect and negotiate the session key. The local key bytes are erased afterwards. */
  async connect(binding: LocalBinding, lease: AbortSignal): Promise<void> {
    if (this.#socket) throw new EufyError('mower_local_busy');
    const localKey = localKeyBytes(binding.localKey);
    const clientNonce = sessionKeyStart();
    let deviceNonce: Buffer | undefined;
    try {
      await this.#operation(lease, async (signal) => {
        this.#deviceHash = sha256(binding.deviceId);
        const socket = new net.Socket();
        this.#socket = socket;
        this.#attach(socket);
        socket.connect({ host: this.#host, port: this.#port });
        await once(socket, 'connect', { signal });
        socket.setNoDelay(true);
        this.#send(localKey, Command.SESSION_KEY_START, clientNonce);
        const response = await this.#receive(localKey, signal, Command.SESSION_KEY_RESPONSE, false);
        deviceNonce = verifySessionKeyResponse(
          localKey,
          clientNonce,
          splitReturnCode(response.plaintext).data,
        );
        this.#send(localKey, Command.SESSION_KEY_FINISH, sessionKeyFinish(localKey, deviceNonce));
        this.#key = deriveSessionKey(localKey, clientNonce, deviceNonce);
      });
    } finally {
      localKey.fill(0);
      clientNonce.fill(0);
      deviceNonce?.fill(0);
    }
  }

  queryStatus(signal?: AbortSignal): Promise<MowerDpSnapshot> {
    return this.#operation(signal, async (abort) => {
      const key = this.#key;
      if (!key) throw new EufyError('mower_local_disconnected');
      this.#send(key, Command.DP_QUERY_NEW, Buffer.from('{}'));
      const frame = await this.#receive(key, abort, Command.DP_QUERY_NEW, true);
      const observedAt = new Date().toISOString();
      const { accepted, data } = splitReturnCode(frame.plaintext);
      if (!accepted) throw new EufyError('mower_local_rejected');
      const status = decodeStatus(data);
      if (status.deviceId !== undefined && sha256(status.deviceId) !== this.#deviceHash)
        throw new EufyError('mower_local_binding_mismatch');
      return { source: 'local-tuya-3.5', observedAt, dps: status.dps };
    });
  }

  async disconnect(): Promise<void> {
    this.#finish('disconnected');
    await this.closed;
  }

  async #operation<T>(
    external: AbortSignal | undefined,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.#end)
      throw new EufyError(this.#end === 'shutdown' ? 'client_closed' : 'mower_local_disconnected');
    if (this.#busy) throw new EufyError('mower_local_busy');
    this.#busy = true;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.#timeout);
    const signal = AbortSignal.any([
      deadline.signal,
      this.#lifetime,
      ...(external ? [external] : []),
    ]);
    try {
      const result = await task(signal);
      if (signal.aborted) throw new Error('aborted');
      return result;
    } catch (error) {
      // Classify without exposing socket errors, hosts, payloads or keys.
      if (this.#lifetime.aborted) {
        this.#finish('shutdown');
        throw new EufyError('client_closed');
      }
      if (external?.aborted) {
        this.#finish('aborted');
        throw new EufyError('request_aborted');
      }
      if (deadline.signal.aborted) {
        this.#finish('timeout');
        throw new EufyError('request_timeout');
      }
      if (error instanceof EufyError) {
        if (error.code === 'mower_local_rejected') throw error;
        if (error.code === 'mower_local_disconnected') this.#finish(this.#failure ?? 'peer_closed');
        else if (error.code === 'mower_local_authentication_failed')
          this.#finish('authentication_failed');
        else this.#finish('protocol_error');
        throw error;
      }
      const connected = !!this.#key;
      this.#finish(this.#failure ?? (connected ? 'peer_closed' : 'connection_failed'));
      throw new EufyError(connected ? 'mower_local_disconnected' : 'mower_local_unreachable');
    } finally {
      clearTimeout(timer);
      this.#busy = false;
    }
  }

  #attach(socket: net.Socket): void {
    socket.on('connect', () => {
      this.#socketConnected = true;
    });
    socket.on('error', () => {
      this.#failure ??= this.#socketConnected ? 'peer_closed' : 'connection_failed';
      this.#wake?.();
    });
    socket.on('data', (chunk: Buffer) => {
      if (this.#end) return;
      try {
        this.#reader.push(chunk);
      } catch {
        this.#failure ??= 'protocol_error';
        socket.destroy();
      }
      this.#wake?.();
    });
    socket.on('close', () => {
      this.#socketClosed = true;
      this.#failure ??= this.#socketConnected ? 'peer_closed' : 'connection_failed';
      if (this.#end) this.#resolveClosed(this.#end);
      else this.#finish(this.#failure);
      this.#wake?.();
    });
  }

  #send(key: Buffer, command: number, plaintext: Buffer): void {
    const socket = this.#socket;
    if (!socket || this.#socketClosed || socket.destroyed)
      throw new EufyError('mower_local_disconnected');
    socket.write(encodeFrame(key, this.#sequence++, command, plaintext));
  }

  async #receive(
    key: Buffer,
    signal: AbortSignal,
    command: number,
    skipOthers: boolean,
  ): Promise<DecodedFrame> {
    let skipped = 0;
    while (true) {
      if (this.#end || this.#socketClosed) throw new EufyError('mower_local_disconnected');
      if (signal.aborted) throw new Error('aborted');
      const raw = this.#reader.next();
      if (raw) {
        const frame = decodeFrame(key, raw);
        raw.fill(0);
        if (frame.command === command) return frame;
        frame.plaintext.fill(0);
        if (!skipOthers || ++skipped > MAX_SKIPPED_FRAMES)
          throw new EufyError('mower_local_protocol_error');
        continue;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          signal.removeEventListener('abort', done);
          this.#wake = undefined;
          resolve();
        };
        this.#wake = done;
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }

  #finish(end: MowerLocalSessionEnd): void {
    if (this.#end) return;
    this.#end = end;
    this.#lifetime.removeEventListener('abort', this.#onLifetimeAbort);
    this.#key?.fill(0);
    this.#key = undefined;
    this.#reader.clear();
    const socket = this.#socket;
    if (!socket || this.#socketClosed) this.#resolveClosed(end);
    else socket.destroy();
    this.#wake?.();
  }
}
