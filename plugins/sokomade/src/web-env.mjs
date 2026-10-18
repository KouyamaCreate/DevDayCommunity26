import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { AppError } from './errors.mjs';

// A workspace-specific key must take priority over a stale inherited shell key.
// Only these app settings are read; the file is never evaluated or sent to the UI.
export async function webEnvironment({ file = new URL('../../../.env.local', import.meta.url), env = process.env } = {}) {
  let local;
  try { local = parseEnv(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { ...env };
    throw new AppError('ENV_UNREADABLE', 'ローカルのAPI設定ファイルを読み取れません。');
  }
  const settings = Object.fromEntries(['OPENAI_API_KEY', 'SOKOMADE_MODEL'].filter(name => Object.hasOwn(local, name)).map(name => [name, local[name]]));
  return { ...env, ...settings };
}
