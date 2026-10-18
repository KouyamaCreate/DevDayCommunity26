import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webEnvironment } from '../src/web-env.mjs';

test('confirmed workspace key takes precedence over an inherited key without changing the parent environment', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'sokomade-env-')); t.after(() => rm(directory, { recursive:true, force:true }));
 const file = join(directory, '.env.local');
 await writeFile(file, 'OPENAI_API_KEY=workspace-test-key\nSOKOMADE_MODEL=test-model\nPATH=unrelated-value\n');
 const original = { OPENAI_API_KEY:'inherited-test-key', PATH:'original-path' };
 const env = await webEnvironment({ file, env:original });
 assert.equal(env.OPENAI_API_KEY,'workspace-test-key');assert.equal(env.SOKOMADE_MODEL,'test-model');assert.equal(env.PATH,'original-path');assert.equal(original.OPENAI_API_KEY,'inherited-test-key');
 const fallback = await webEnvironment({ file:join(directory, 'missing'), env:original });assert.equal(fallback.OPENAI_API_KEY,'inherited-test-key');
});
