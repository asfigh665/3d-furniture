import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DesignSchema } from '../shared/design.js';

const VersionSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(80), createdAt: z.string().datetime(), design: DesignSchema });

export function createVersionStore(directory) {
  const path = join(directory, 'versions.json');
  let pending = Promise.resolve();
  const read = async () => {
    try { return z.array(VersionSchema).parse(JSON.parse(await readFile(path, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return []; throw new Error('方案文件无法读取。请检查数据文件；系统不会覆盖已有数据。'); }
  };
  const write = async (versions) => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(versions, null, 2), 'utf8');
    await rename(temporary, path);
  };
  const mutate = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  return {
    list: async () => { await pending; return read(); },
    add: (name, design) => mutate(async () => {
      const versions = await read();
      const version = VersionSchema.parse({ id: randomUUID(), name, createdAt: new Date().toISOString(), design });
      await write([version, ...versions]);
      return version;
    }),
    remove: (id) => mutate(async () => {
      const versions = await read();
      const filtered = versions.filter((version) => version.id !== id);
      if (filtered.length === versions.length) return false;
      await write(filtered); return true;
    }),
  };
}
