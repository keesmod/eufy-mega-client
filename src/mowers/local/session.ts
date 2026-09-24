// Local Tuya 3.5 session owner for one E15. Protocol facts and their permitted sources:
// docs/MOWER_TRANSPORT_PROVENANCE.md and docs/MOWER_COMMANDS.md. Reads never write. The only
// writes are the opt-in command classes in commands.ts, one declared boolean point each.
import net from 'node:net';
import { once } from 'node:events';
import { EufyError } from '../../types.js';
import type {
  MowerCommandOptions,
  MowerCommandOutcome,
  MowerCommandProgress,
  MowerCommandRequest,
  MowerDpSchemaEntry,
  MowerDpSnapshot,
  MowerDpReport,
  MowerLocalSession,
  MowerLocalSessionEnd,
  MowerLocalSessionOptions,
  MowerTelemetry,
} from '../../modular-types.js';
import { decodeMowerTelemetry } from '../telemetry/decode.js';
import { parseMowerWirePayload, wireVarints } from '../telemetry/wire.js';
import { copySchema } from '../telemetry/schema.js';
import {
  COMMANDS,
  MAX_COMMAND_REPORTS,
  controlDocument,
  requireDeclaredWrite,
  requireWritable,
  validateCommandRequest,
} from './commands.js';
import {
  Command,
  FrameReader,
  LOCAL_PORT,
  MAX_FRAME_LENGTH,
  controlPayload,
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
  readonly schema?: readonly MowerDpSchemaEntry[];
}

const DEFAULT_TIMEOUT_MS = 5000;
/** Unsolicited reports and heartbeat replies may precede a query response. */
const MAX_SKIPPED_FRAMES = 32;
const HEARTBEAT_INTERVAL_MS = 10_000;
interface ReceivedFrame extends DecodedFrame {
  observedAt: string;
}
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
  readonly #commands?: MowerCommandOptions;
  #socket?: net.Socket;
  #socketConnected = false;
  #socketClosed = false;
  #failure?: MowerLocalSessionEnd;
  #reader = new FrameReader();
  #frames: { raw: Buffer; observedAt: string }[] = [];
  #frameBytes = 0;
  #readError?: EufyError;
  #key?: Buffer;
  #deviceHash?: string;
  #schema?: MowerDpSchemaEntry[];
  #sequence = 1;
  #lastSentAt = 0;
  #busy = false;
  #end?: MowerLocalSessionEnd;
  #resolveClosed!: (end: MowerLocalSessionEnd) => void;
  #wake?: () => void;
  readonly #onLifetimeAbort = () => this.#finish('shutdown');

  constructor(
    options: MowerLocalSessionOptions,
    lifetime: AbortSignal,
    commands?: MowerCommandOptions,
  ) {
    const valid = validateOptions(options);
    this.#host = valid.host;
    this.#port = valid.port;
    this.#timeout = valid.timeout;
    this.#lifetime = lifetime;
    if (commands) this.#commands = { ...commands };
    this.closed = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
    if (lifetime.aborted) throw new EufyError('client_closed');
    lifetime.addEventListener('abort', this.#onLifetimeAbort, { once: true });
  }

  get connected(): boolean {
    return !!this.#key && !this.#end && !this.#socketClosed;
  }

  get commandsEnabled(): boolean {
    return !!this.#commands;
  }

  get schema(): MowerDpSchemaEntry[] | undefined {
    return copySchema(this.#schema);
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
        this.#schema = copySchema(binding.schema);
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
      return this.#query(key, abort);
    });
  }

  async queryTelemetry(signal?: AbortSignal): Promise<MowerTelemetry> {
    const snapshot = await this.queryStatus(signal);
    return decodeMowerTelemetry(snapshot, { schema: this.#schema });
  }

  receiveReport(signal?: AbortSignal): Promise<MowerDpReport> {
    return this.#operation(signal, async (abort) => {
      const key = this.#key;
      if (!key) throw new EufyError('mower_local_disconnected');
      return this.#withHeartbeat(key, async () => {
        const frame = await this.#receive(key, abort, Command.STATUS_REPORT, true);
        return this.#report(frame);
      });
    });
  }

  sendCommand(request: MowerCommandRequest, signal?: AbortSignal): Promise<MowerCommandOutcome> {
    const commands = this.#commands;
    if (!commands) return Promise.reject(new EufyError('mower_commands_disabled'));
    let valid: ReturnType<typeof validateCommandRequest>;
    try {
      valid = validateCommandRequest(request, commands);
    } catch (error) {
      return Promise.reject(error);
    }
    const command = COMMANDS[valid.kind];
    // The hard deadline covers the fresh query and the bounded read-back after the write.
    return this.#operation(
      signal,
      async (abort) => {
        const key = this.#key;
        if (!key) throw new EufyError('mower_local_disconnected');
        requireDeclaredWrite(command.write, this.#schema);
        const before = await this.#query(key, abort);
        requireWritable(before, command);
        const outcome: MowerCommandOutcome = {
          command: valid.kind,
          write: { ...command.write },
          before,
          sentAt: new Date().toISOString(),
          stage: 'sent',
          end: 'timed_out',
          reports: [],
        };
        // A consumer's progress callback sees private copies and can never change the command.
        const progress = (event: MowerCommandProgress): void => {
          if (!valid.onProgress) return;
          try {
            valid.onProgress(Object.freeze({ ...event }));
          } catch {
            // Ignored: the outcome stays the only result.
          }
        };
        this.#send(key, Command.CONTROL_NEW, controlPayload(controlDocument(command.write)));
        const bound = AbortSignal.timeout(valid.readBackMs);
        const readSignal = AbortSignal.any([abort, bound]);
        const wanted = new Set([Command.CONTROL_NEW, Command.STATUS_REPORT]);
        await this.#withHeartbeat(key, async () => {
          while (true) {
            let frame: ReceivedFrame;
            try {
              frame = await this.#next(key, readSignal, wanted, true);
            } catch (error) {
              if (bound.aborted && !abort.aborted) return;
              throw error;
            }
            if (frame.command === Command.CONTROL_NEW) {
              const { accepted, data } = splitReturnCode(frame.plaintext);
              const rejected = data.length > 0;
              frame.plaintext.fill(0);
              outcome.reply ??= {
                observedAt: frame.observedAt,
                returnCodeZero: accepted,
                rejected,
              };
              if (rejected) {
                outcome.end = 'rejected';
                return;
              }
              continue;
            }
            const report = this.#report(frame);
            if (outcome.reports.length >= MAX_COMMAND_REPORTS) {
              outcome.end = 'report_limit';
              return;
            }
            outcome.reports.push(report);
            // Frames queued before the write are kept as context but are not fresh evidence.
            if (report.observedAt < outcome.sentAt) continue;
            const dps = report.dps;
            if (
              !outcome.acknowledgement &&
              (Object.hasOwn(dps, command.control) || dps[command.write.dp] === command.write.value)
            ) {
              outcome.acknowledgement = {
                observedAt: report.observedAt,
                sequence: report.sequence,
                dp: Object.hasOwn(dps, command.control) ? command.control : command.write.dp,
              };
              outcome.stage = 'acknowledged';
              progress({ kind: 'acknowledged', ...outcome.acknowledgement });
            }
            if (!Object.hasOwn(dps, '107')) continue;
            const status = decodeMowerTelemetry(report, { schema: this.#schema }).status;
            if (status.state === 'reported')
              progress({
                kind: 'activity',
                observedAt: report.observedAt,
                sequence: report.sequence,
                value: status.value,
              });
            if (command.payload) {
              // Exact wire match of the expected records, no activity decoding involved.
              if (matchesPayload(dps['107'], command.payload.fields)) {
                outcome.payload = {
                  observedAt: report.observedAt,
                  sequence: report.sequence,
                  name: command.payload.name,
                };
                outcome.stage = 'reflected';
                outcome.end = 'reflected';
                return;
              }
              continue;
            }
            if (status.state === 'reported' && status.value === command.activity) {
              outcome.activity = {
                observedAt: report.observedAt,
                sequence: report.sequence,
                value: status.value,
              };
              outcome.stage = 'reflected';
              outcome.end = 'reflected';
              return;
            }
          }
        });
        return outcome;
      },
      this.#timeout + valid.readBackMs,
    );
  }

  async #query(key: Buffer, abort: AbortSignal): Promise<MowerDpSnapshot> {
    this.#send(key, Command.DP_QUERY_NEW, Buffer.from('{}'));
    const frame = await this.#receive(key, abort, Command.DP_QUERY_NEW, true);
    return this.#snapshot(frame);
  }

  #report(frame: ReceivedFrame): MowerDpReport {
    return { ...this.#snapshot(frame), kind: 'device-report', sequence: frame.sequence };
  }

  /**
   * Tuya's LAN owner expires a connection after 30 seconds without incoming traffic. An empty
   * command-9 frame maintains transport only, never refreshes or writes a DP, and is sent only
   * while a read is pending.
   */
  async #withHeartbeat<T>(key: Buffer, task: () => Promise<T>): Promise<T> {
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    const keepAlive = () => {
      try {
        if (performance.now() - this.#lastSentAt >= HEARTBEAT_INTERVAL_MS)
          this.#send(key, Command.HEARTBEAT, Buffer.alloc(0));
        heartbeat = setTimeout(
          keepAlive,
          Math.max(1, HEARTBEAT_INTERVAL_MS - (performance.now() - this.#lastSentAt)),
        );
      } catch {
        this.#finish('peer_closed');
      }
    };
    try {
      keepAlive();
      return await task();
    } finally {
      clearTimeout(heartbeat);
    }
  }

  #snapshot(frame: ReceivedFrame): MowerDpSnapshot {
    try {
      const { accepted, data } = splitReturnCode(frame.plaintext);
      if (!accepted) throw new EufyError('mower_local_rejected');
      const status = decodeStatus(data);
      if (status.deviceId !== undefined && sha256(status.deviceId) !== this.#deviceHash)
        throw new EufyError('mower_local_binding_mismatch');
      return { source: 'local-tuya-3.5', observedAt: frame.observedAt, dps: status.dps };
    } finally {
      frame.plaintext.fill(0);
    }
  }

  async disconnect(): Promise<void> {
    this.#finish('disconnected');
    await this.closed;
  }

  async #operation<T>(
    external: AbortSignal | undefined,
    task: (signal: AbortSignal) => Promise<T>,
    deadlineMs = this.#timeout,
  ): Promise<T> {
    if (this.#end)
      throw new EufyError(this.#end === 'shutdown' ? 'client_closed' : 'mower_local_disconnected');
    if (this.#busy) throw new EufyError('mower_local_busy');
    this.#busy = true;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), deadlineMs);
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
        if (error.code === 'mower_local_rejected' || error.code.startsWith('mower_command_'))
          throw error;
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
        if (this.#frameBytes + this.#reader.pending + chunk.length > 2 * MAX_FRAME_LENGTH)
          throw new EufyError('mower_local_protocol_error');
        this.#reader.push(chunk);
        let raw;
        while ((raw = this.#reader.next())) {
          if (this.#frames.length >= MAX_SKIPPED_FRAMES) {
            raw.fill(0);
            throw new EufyError('mower_local_protocol_error');
          }
          this.#frames.push({ raw, observedAt: new Date().toISOString() });
          this.#frameBytes += raw.length;
        }
      } catch {
        this.#readError = new EufyError('mower_local_protocol_error');
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
    this.#lastSentAt = performance.now();
  }

  #receive(
    key: Buffer,
    signal: AbortSignal,
    command: number,
    skipOthers: boolean,
  ): Promise<ReceivedFrame> {
    return this.#next(key, signal, new Set([command]), skipOthers);
  }

  /** Return the next frame whose command is wanted. Other frames are skipped within a bound. */
  async #next(
    key: Buffer,
    signal: AbortSignal,
    wanted: ReadonlySet<number>,
    skipOthers: boolean,
  ): Promise<ReceivedFrame> {
    let skipped = 0;
    while (true) {
      if (this.#readError) throw this.#readError;
      if (this.#end || this.#socketClosed) throw new EufyError('mower_local_disconnected');
      if (signal.aborted) throw new Error('aborted');
      const received = this.#frames.shift();
      if (received) {
        const { raw, observedAt } = received;
        this.#frameBytes -= raw.length;
        let frame: ReceivedFrame;
        try {
          frame = { ...decodeFrame(key, raw), observedAt };
        } finally {
          raw.fill(0);
        }
        if (wanted.has(frame.command)) return frame;
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
    for (const frame of this.#frames) frame.raw.fill(0);
    this.#frames = [];
    this.#frameBytes = 0;
    const socket = this.#socket;
    if (!socket || this.#socketClosed) this.#resolveClosed(end);
    else socket.destroy();
    this.#wake?.();
  }
}

/** True when the DP 107 value holds exactly the expected varint records and nothing else. */
function matchesPayload(value: unknown, expected: Readonly<Record<number, number>>): boolean {
  const varints = wireVarints(parseMowerWirePayload(value));
  if (!varints) return false;
  const wanted = Object.entries(expected);
  if (varints.size !== wanted.length) return false;
  return wanted.every(([number, want]) => varints.get(Number(number)) === want);
}
