// Opt-in command classes over the device's declared boolean points. Every fact, its permitted
// source and the owned-device evidence: docs/MOWER_COMMANDS.md. The session writes nothing else.
import { EufyError } from '../../types.js';
import type {
  MowerActivity,
  MowerCommandKind,
  MowerCommandOptions,
  MowerCommandRequest,
  MowerCommandWrite,
  MowerDpSchemaEntry,
  MowerDpSnapshot,
} from '../../modular-types.js';

export interface CommandClass {
  readonly write: MowerCommandWrite;
  /** Declared raw control point that reported within milliseconds of every app press. */
  readonly control: string;
  /** Confirmed DP 107 activity that must be reported before the lifecycle reads `reflected`. */
  readonly activity?: MowerActivity;
  /**
   * DP 107 wire records that must be reported before the lifecycle reads `reflected`, for a
   * class whose reflection is not a confirmed activity. Compared exactly, no other varint record.
   */
  readonly payload?: {
    readonly name: 'map_saving';
    readonly fields: Readonly<Record<number, number>>;
  };
  /** Extra precondition on the fresh query: the task must be stopped (DP 1 false, DP 118 at 100). */
  readonly requires?: 'stopped';
}

/** The only writes the library can ever make. Rain, child protection and settings are absent. */
export const COMMANDS: Readonly<Record<MowerCommandKind, CommandClass>> = Object.freeze({
  start: Object.freeze({
    write: Object.freeze({ dp: '1', code: 'switch_go', value: true }),
    control: '103',
    activity: 'mowing',
  }),
  pause: Object.freeze({
    write: Object.freeze({ dp: '2', code: 'pause', value: true }),
    control: '105',
    activity: 'paused',
  }),
  resume: Object.freeze({
    write: Object.freeze({ dp: '2', code: 'pause', value: false }),
    control: '106',
    activity: 'mowing',
  }),
  stop: Object.freeze({
    write: Object.freeze({ dp: '1', code: 'switch_go', value: false }),
    control: '104',
    payload: Object.freeze({ name: 'map_saving', fields: Object.freeze({ 2: 5, 3: 1 }) }),
  }),
  return: Object.freeze({
    write: Object.freeze({ dp: '3', code: 'switch_charge', value: true }),
    control: '103',
    activity: 'returning',
    requires: 'stopped',
  }),
});

export const DEFAULT_READ_BACK_MS = 10_000;
export const MIN_READ_BACK_MS = 1000;
export const MAX_READ_BACK_MS = 60_000;
/** Reports kept per read-back. Beyond this the lifecycle ends as `report_limit`. */
export const MAX_COMMAND_REPORTS = 64;
/** Declared `save_map_process` percentage. A value strictly between 0 and 100 is a running save. */
export const MAP_SAVE_DP = '118';
const MAX_STOP_ROUTE = 200;
const STOP_ROUTE = /^[^\p{C}]+$/u;
const KINDS = new Set<MowerCommandKind>(['start', 'pause', 'resume', 'stop', 'return']);
/** Declared `switch_go`. False on the fresh query is the stopped task the app requires before Charge. */
export const TASK_DP = '1';

function bound(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_READ_BACK_MS &&
    value <= MAX_READ_BACK_MS
  );
}

/** Accept the opt-in only when it is explicit and names a stop route. */
export function validateCommandOptions(options: unknown): MowerCommandOptions | undefined {
  if (options === undefined) return undefined;
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new EufyError('mower_invalid_options');
  const { enabled, stopRoute, readBackMs } = options as Record<string, unknown>;
  if (enabled !== true) throw new EufyError('mower_invalid_options');
  if (
    typeof stopRoute !== 'string' ||
    stopRoute.trim().length === 0 ||
    stopRoute.length > MAX_STOP_ROUTE ||
    !STOP_ROUTE.test(stopRoute)
  )
    throw new EufyError('mower_invalid_options');
  if (readBackMs !== undefined && !bound(readBackMs)) throw new EufyError('mower_invalid_options');
  return {
    enabled: true,
    stopRoute: stopRoute.trim(),
    ...(readBackMs === undefined ? {} : { readBackMs }),
  };
}

export function validateCommandRequest(
  request: unknown,
  options: MowerCommandOptions,
): { kind: MowerCommandKind; readBackMs: number } {
  if (!request || typeof request !== 'object' || Array.isArray(request))
    throw new EufyError('mower_command_invalid');
  const { kind, readBackMs } = request as Record<string, unknown>;
  if (typeof kind !== 'string' || !KINDS.has(kind as MowerCommandKind))
    throw new EufyError('mower_command_invalid');
  if (readBackMs !== undefined && !bound(readBackMs)) throw new EufyError('mower_command_invalid');
  return {
    kind: kind as MowerCommandKind,
    readBackMs: readBackMs ?? options.readBackMs ?? DEFAULT_READ_BACK_MS,
  };
}

/** The device itself must declare the point as a writable boolean with the expected code. */
export function requireDeclaredWrite(
  write: MowerCommandWrite,
  schema: readonly MowerDpSchemaEntry[] | undefined,
): void {
  const entry = schema?.find((item) => item.id === write.dp);
  if (
    !entry ||
    entry.type !== 'bool' ||
    entry.mode === 'ro' ||
    (entry.code !== undefined && entry.code !== write.code)
  )
    throw new EufyError('mower_command_undeclared');
}

/**
 * Typed refusals decided on the fresh query taken right before the write. A running map save
 * refuses every command, a point already at the written value cannot produce a fresh change, and
 * a class that requires the stopped task refuses while DP 1 is true or the map save has not
 * reached 100, because the app offers Charge only in that state.
 */
export function requireWritable(before: MowerDpSnapshot, command: CommandClass): void {
  const { write } = command;
  const progress = before.dps[MAP_SAVE_DP];
  if (typeof progress !== 'number' || !Number.isInteger(progress) || progress < 0 || progress > 100)
    throw new EufyError('mower_command_evidence_missing');
  if (progress > 0 && progress < 100) throw new EufyError('mower_command_map_saving');
  if (command.requires === 'stopped') {
    if (before.dps[TASK_DP] !== false) throw new EufyError('mower_command_task_active');
    if (progress !== 100) throw new EufyError('mower_command_map_saving');
  }
  if (before.dps[write.dp] === write.value) throw new EufyError('mower_command_already_set');
}

/** JSON document of the 3.5 LAN control command. The frame codec adds the version header. */
export function controlDocument(write: MowerCommandWrite, now = Date.now()): string {
  return JSON.stringify({
    protocol: 5,
    t: Math.floor(now / 1000),
    data: { dps: { [write.dp]: write.value } },
  });
}
