/** Raw upstream log arguments contain keys, tokens, media paths and identities.
 * Keep this private compatibility logger disabled. The library emits its own
 * allowlisted diagnostics at operation boundaries instead.
 */
export type LoggingCategories = 'all' | 'main' | 'http' | 'p2p' | 'push' | 'mqtt';
const discard = (_message: unknown, ..._args: unknown[]): void => {};
const logger = Object.freeze({ trace: discard, debug: discard, info: discard,
  warn: discard, error: discard, fatal: discard });
export const rootMainLogger = logger;
export const rootHTTPLogger = logger;
export const rootMQTTLogger = logger;
export const rootPushLogger = logger;
export const rootP2PLogger = logger;

export type ProtocolLogger = typeof logger;
