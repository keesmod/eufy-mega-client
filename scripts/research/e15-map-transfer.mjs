// Independent wire research from the original 7.5.1 artifact, not mower-fork code.
const ALBUM = 'ipc_sweeper_robot';
const FILES = ['map.bin.stream', 'cleanPath.bin.stream', 'navPath.bin.stream'];
export function mapCommand(request, sub, payload) {
  const b = Buffer.alloc(20 + payload.length);
  b.writeUInt32LE(0x12345678);
  b.writeUInt32LE(request, 4);
  b.writeUInt16LE(100, 12);
  b.writeUInt16LE(sub, 14);
  b.writeUInt32LE(payload.length, 16);
  payload.copy(b, 20);
  return b;
}
export function albumRequest(request) {
  const b = Buffer.alloc(116);
  b.write(ALBUM, 4);
  return mapCommand(request, 12, b);
}
export function downloadRequest(request, files) {
  if (files.length !== 3 || !FILES.every((f, i) => files[i] === f))
    throw new Error('file-allowlist');
  const b = Buffer.alloc(64 + 48 * files.length);
  b.writeUInt32LE(5);
  b.write(ALBUM, 8);
  b.writeUInt32LE(files.length, 60);
  files.forEach((f, i) => b.write(f, 64 + i * 48));
  return mapCommand(request, 13, b);
}
export function cancelRequest(request) {
  const b = Buffer.alloc(72);
  b.writeUInt32LE(4, 4);
  return mapCommand(request, 13, b);
}
function zstring(b) {
  const end = b.indexOf(0);
  if (end < 0) throw new Error('unterminated-name');
  const s = b.subarray(0, end).toString('utf8');
  if (!/^[A-Za-z0-9_.]+$/.test(s)) throw new Error('invalid-name');
  return s;
}
export function albumFiles(b) {
  if (b.length < 520 || b.readUInt32LE(4) !== 3) throw new Error('album-not-complete');
  const n = b.readUInt32LE(516);
  if (n > 40 || b.length !== 520 + n * 80) throw new Error('album-size');
  const files = [];
  for (let i = 0; i < n; i++) {
    const item = b.subarray(520 + i * 80, 600 + i * 80);
    if (!item[4]) continue;
    const name = zstring(item.subarray(8, 56));
    if (FILES.includes(name)) {
      if (files.includes(name)) throw new Error('duplicate-file');
      files.push(name);
    }
  }
  if (!FILES.every((f) => files.includes(f))) throw new Error('required-map-files-missing');
  return [...FILES];
}
export class CommandReader {
  #closed = false;
  #buffer = Buffer.alloc(0);
  push(bytes) {
    if (this.#closed) throw new Error('reader-closed');
    this.#buffer = Buffer.concat([this.#buffer, bytes]);
    if (this.#buffer.length > 65536) throw new Error('command-limit');
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
  #buffer = Buffer.alloc(0);
  #current;
  #files = new Map();
  #task;
  #index;
  constructor(task) {
    this.#task = task;
  }
  push(bytes) {
    if (this.#closed) throw new Error('reader-closed');
    this.#buffer = Buffer.concat([this.#buffer, bytes]);
    if (this.#buffer.length > 2 * 1024 * 1024) throw new Error('file-buffer-limit');
    const out = [];
    while (this.#buffer.length >= 80) {
      const b = this.#buffer;
      if (b.readUInt32LE() !== 1 || b.readUInt32LE(4) !== 1000 || b.readUInt16LE(10) !== this.#task)
        throw new Error('file-header');
      const index = b.readInt32LE(12),
        count = b.readUInt32LE(16),
        size = b.readUInt32LE(68),
        total = b.readUInt32LE(72),
        end = b.readUInt32LE(76);
      if (index === -1) {
        this.#buffer = b.subarray(80);
        out.push({ complete: true });
        continue;
      }
      if (size > 1024 * 1024 || total > 8 * 1024 * 1024 || !total || end > 1)
        throw new Error('file-size');
      if (b.length < 80 + size) break;
      const name = zstring(b.subarray(20, 68));
      if (!FILES.includes(name)) throw new Error('unexpected-file');
      if (this.#index !== undefined && index !== this.#index + 1) throw new Error('file-order');
      this.#index = index;
      if (!this.#current) this.#current = { name, parts: [], bytes: 0, total };
      if (this.#current.name !== name || this.#current.total !== total)
        throw new Error('interleaved-file');
      this.#current.parts.push(Buffer.from(b.subarray(80, 80 + size)));
      this.#current.bytes += size;
      if (this.#current.bytes > 8 * 1024 * 1024) throw new Error('file-limit');
      if (end) {
        if (this.#current.bytes !== total) throw new Error('incomplete-file');
        const data = Buffer.concat(this.#current.parts);
        this.#files.set(name, data);
        out.push({ name, data, count, index, total });
        this.#current = undefined;
      }
      this.#buffer = b.subarray(80 + size);
    }
    return out;
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
  }
}
