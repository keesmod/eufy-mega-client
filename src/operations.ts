import type { EventEmitter } from 'node:events';
import { EufyError } from './types.js';
/** A single response owner. Callers close the connection after a timed-out command. */
export function awaitEvent<T>(
  source: EventEmitter,
  event: string,
  issue: () => void,
  accept: (...args: any[]) => T | undefined,
  signal: AbortSignal,
  timeout = 15000,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new EufyError('cancelled'));
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      source.off(event, receive);
      source.off('close', closed);
      source.off('connection error', closed);
      signal.removeEventListener('abort', cancel);
    };
    const closed = () => {
      clean();
      reject(new EufyError('device_disconnected'));
    };
    const cancel = () => {
      clean();
      reject(new EufyError('cancelled'));
    };
    const receive = (...args: any[]) => {
      try {
        const result = accept(...args);
        if (result !== undefined) {
          clean();
          resolve(result);
        }
      } catch (e) {
        clean();
        reject(e instanceof EufyError ? e : new EufyError('invalid_device_response'));
      }
    };
    const timer = setTimeout(() => {
      clean();
      reject(new EufyError('device_request_timeout'));
    }, timeout);
    source.on(event, receive);
    source.on('close', closed);
    source.on('connection error', closed);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      issue();
    } catch {
      clean();
      reject(new EufyError('device_request_failed'));
    }
  });
}
