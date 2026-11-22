import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function openStore(filename, initialState) {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });

  async function persist(value) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
      await rename(temporary, filename);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  let state;
  try {
    state = JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = structuredClone(initialState);
    await persist(state);
  }
  if (!Array.isArray(state.cases)) throw new Error('Nieprawidłowy plik danych ocen.');
  state.officeConfigs ??= {};
  state.signedFileKeys ??= {};

  let pending = Promise.resolve();
  return {
    read() {
      return structuredClone(state);
    },
    write(change) {
      const operation = pending.then(async () => {
        const next = structuredClone(state);
        const result = structuredClone(await change(next));
        await persist(next);
        state = next;
        return result;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
