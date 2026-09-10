import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
await mkdir('dist/vendor', { recursive: true });
await writeFile('dist/vendor/package.json', '{"type":"commonjs"}\n');
async function copy(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await copy(path);
    else if (/\.(proto|crt)$/.test(path))
      await cp(path, path.replace('vendor/src/', 'dist/vendor/'));
  }
}
await copy('vendor/src');
