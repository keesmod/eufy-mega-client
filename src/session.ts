import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Session, SessionStore } from './types.js';
import { EufyError } from './types.js';

/** Atomic, private session storage. Callers own the containing data directory. */
export class FileSessionStore implements SessionStore {
  constructor(private readonly path: string) {}
  async load(): Promise<Session | undefined> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Session;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new EufyError('session_unreadable');
    }
  }
  async save(session: Session): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(session), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
