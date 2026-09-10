import type { MapLifetime } from './lifetime.js';
import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';

export function openSocket(
  owner: MapLifetime,
  options: { host: string; port: number },
  encrypted = false,
) {
  let socket: net.Socket | undefined;
  let finishClose!: (value: boolean) => void;
  const closed = new Promise<boolean>((resolve) => {
    finishClose = resolve;
  });
  owner.own({
    close: () => {
      if (socket) socket!.destroy();
      else {
        owner.signal.removeEventListener('abort', aborted);
        finishClose(true);
      }
      return closed;
    },
  });
  const aborted = () => socket?.destroy();
  owner.signal.addEventListener('abort', aborted, { once: true });
  // Queue bytes immediately, before a connect consumer can miss a fast response.
  const chunks: Buffer[] = [];
  let length = 0,
    waiter: (() => void) | undefined,
    failure: Error | undefined;
  const attach = () => {
    socket!.on('error', () => {});
    socket!.once('close', () => {
      owner.signal.removeEventListener('abort', aborted);
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      length = 0;
      finishClose(true);
    });
    socket!.on('data', (b) => {
      length += b.length;
      if (length > 65536) {
        failure = new Error('socket-buffer-limit');
        socket!.destroy();
      } else chunks.push(b);
      waiter?.();
      waiter = undefined;
    });
    socket!.on('error', () => {
      failure = new Error('socket-failed');
      waiter?.();
      waiter = undefined;
    });
    socket!.on('close', () => {
      failure ??= new Error('socket-closed');
      waiter?.();
      waiter = undefined;
    });
  };
  return {
    async connect() {
      if (socket || owner.signal.aborted) throw new Error('socket-already-consumed');
      socket = encrypted
        ? tls.connect({ ...options, servername: options.host, rejectUnauthorized: true })
        : new net.Socket();
      attach();
      if (encrypted) {
        await once(socket, 'secureConnect', { signal: owner.signal });
        if (!(socket as tls.TLSSocket).authorized) throw new Error('tls-unverified');
      } else {
        socket.connect(options);
        await once(socket, 'connect', { signal: owner.signal });
      }
    },
    async read() {
      if (failure || owner.signal.aborted) throw failure ?? new Error('socket-closed');
      while (!chunks.length) {
        if (failure || owner.signal.aborted) throw failure ?? new Error('trial-aborted');
        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
      const b = chunks.shift()!;
      length -= b.length;
      return b;
    },
    write(bytes: Buffer) {
      if (failure || owner.signal.aborted || !socket || socket.destroyed)
        throw new Error('socket-closed');
      if (socket.writableLength + bytes.length > 65536) throw new Error('socket-write-limit');
      socket.write(bytes);
    },
  };
}
