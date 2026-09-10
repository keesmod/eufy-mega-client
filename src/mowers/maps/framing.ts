import type { MapStreamName } from './types.js';
// Independent wire research from the original 7.5.1 artifact, not mower-fork code.
const ALBUM = 'ipc_sweeper_robot';
export const FILES: readonly MapStreamName[] = [
  'map.bin.stream',
  'cleanPath.bin.stream',
  'navPath.bin.stream',
];
export function mapCommand(request: number, sub: number, payload: Buffer) {
  const b = Buffer.alloc(20 + payload.length);
  b.writeUInt32LE(0x12345678);
  b.writeUInt32LE(request, 4);
  b.writeUInt16LE(100, 12);
  b.writeUInt16LE(sub, 14);
  b.writeUInt32LE(payload.length, 16);
  payload.copy(b, 20);
  return b;
}
export function albumRequest(request: number) {
  const b = Buffer.alloc(116);
  b.write(ALBUM, 4);
  return mapCommand(request, 12, b);
}
export function downloadRequest(request: number, files: readonly string[]) {
  if (files.length !== 3 || !FILES.every((f, i) => files[i] === f))
    throw new Error('file-allowlist');
  const b = Buffer.alloc(64 + 48 * files.length);
  b.writeUInt32LE(5);
  b.write(ALBUM, 8);
  b.writeUInt32LE(files.length, 60);
  files.forEach((f, i) => b.write(f, 64 + i * 48));
  return mapCommand(request, 13, b);
}
export function cancelRequest(request: number) {
  const b = Buffer.alloc(72);
  b.writeUInt32LE(4, 4);
  return mapCommand(request, 13, b);
}
function zstring(b: Buffer) {
  const end = b.indexOf(0);
  if (end < 0) throw new Error('unterminated-name');
  const s = b.subarray(0, end).toString('utf8');
  if (!/^[A-Za-z0-9_.]+$/.test(s)) throw new Error('invalid-name');
  return s;
}
export function albumFiles(b: Buffer) {
  if (b.length < 520 || b.readUInt32LE(4) !== 3) throw new Error('album-not-complete');
  const n = b.readUInt32LE(516);
  if (n > 40 || b.length !== 520 + n * 80) throw new Error('album-size');
  const files: string[] = [];
  for (let i = 0; i < n; i++) {
    const item = b.subarray(520 + i * 80, 600 + i * 80);
    if (!item[4]) continue;
    const name = zstring(item.subarray(8, 56));
    if (FILES.includes(name as MapStreamName)) {
      if (files.includes(name)) throw new Error('duplicate-file');
      files.push(name);
    }
  }
  if (!FILES.every((f) => files.includes(f))) throw new Error('required-map-files-missing');
  return [...FILES];
}
export class CommandReader {
  #closed = false;
  #buffer: Buffer = Buffer.alloc(0);
  push(bytes: Buffer) {
    if (this.#closed) throw new Error('reader-closed');
    if (bytes.length + this.#buffer.length > 65536) throw new Error('command-limit');
    this.#buffer = Buffer.concat([this.#buffer, bytes]);
    const out = [];
    while (this.#buffer.length >= 20) {
      const b = this.#buffer,
        len = b.readUInt32LE(16);
      if (b.readUInt32LE() !== 0x12345678 || b.readUInt32LE(8) !== 1 || len > 32768)
        throw new Error('command-header');
      if (b.length < 20 + len) break;
      out.push({
        request: b.readUInt32LE(4),
        main: b.readUInt16LE(12),
        sub: b.readUInt16LE(14),
        payload: Buffer.from(b.subarray(20, 20 + len)),
      });
      this.#buffer = b.subarray(20 + len);
    }
    return out;
  }
  close() {
    this.#closed = true;
    this.#buffer.fill(0);
    this.#buffer = Buffer.alloc(0);
  }
}
export class MapFileReader {
  #closed = false;
  #buffer: Buffer = Buffer.alloc(0);
  #current?: { name: MapStreamName; parts: Buffer[]; bytes: number; total: number };
  #files = new Set<MapStreamName>();
  #task: number;
  #index?: number;
  #terminal = false;
  constructor(task: number) {
    this.#task = task;
  }
  push(bytes: Buffer) {
    if (this.#closed) throw new Error('reader-closed');
    if (bytes.length + this.#buffer.length > 2 * 1024 * 1024) throw new Error('buffer-limit');
    this.#buffer = Buffer.concat([this.#buffer, bytes]);
    const out: Array<{ name: MapStreamName; data: Buffer }> = [];
    while (this.#buffer.length >= 80) {
      if (this.#terminal) throw new Error('data-after-terminal');
      const b = this.#buffer;
      if (b.readUInt32LE() !== 1 || b.readUInt32LE(4) !== 1000 || b.readUInt16LE(10) !== this.#task)
        throw new Error('file-header');
      const index = b.readInt32LE(12),
        size = b.readUInt32LE(68),
        total = b.readUInt32LE(72),
        end = b.readUInt32LE(76);
      if (index === -1) {
        if (this.#current || size !== 0 || total !== 0 || b.length !== 80)
          throw new Error('contradictory-terminal');
        this.#terminal = true;
        this.#buffer = Buffer.alloc(0);
        continue;
      }
      if (index < 0 || !size || size > 1024 * 1024 || total > 8 * 1024 * 1024 || !total || end > 1)
        throw new Error('file-size');
      if (b.length < 80 + size) break;
      const name = zstring(b.subarray(20, 68)) as MapStreamName;
      if (!FILES.includes(name as MapStreamName)) throw new Error('unexpected-file');
      if (this.#index !== undefined && index !== this.#index + 1) throw new Error('file-order');
      this.#index = index;
      if (!this.#current) this.#current = { name, parts: [], bytes: 0, total };
      if (this.#current.name !== name || this.#current.total !== total)
        throw new Error('interleaved-file');
      if (this.#current.parts.length >= 16384) throw new Error('file-chunk-limit');
      this.#current.parts.push(Buffer.from(b.subarray(80, 80 + size)));
      this.#current.bytes += size;
      if (this.#current.bytes > total) throw new Error('file-limit');
      if (end) {
        if (this.#current.bytes !== total) throw new Error('incomplete-file');
        const data = Buffer.concat(this.#current.parts);
        for (const part of this.#current.parts) part.fill(0);
        this.#files.add(name);
        out.push({ name, data });
        this.#current = undefined;
      }
      this.#buffer = b.subarray(80 + size);
    }
    return out;
  }
  get terminal() {
    return this.#terminal;
  }
  get ready() {
    return FILES.every((f) => this.#files.has(f));
  }
  get settled() {
    return this.ready && !this.#current && this.#buffer.length === 0;
  }
  close() {
    this.#closed = true;
    this.#buffer.fill(0);
    for (const b of this.#current?.parts ?? []) b.fill(0);
    this.#current = undefined;
    this.#files.clear();
    this.#buffer = Buffer.alloc(0);
  }
}
