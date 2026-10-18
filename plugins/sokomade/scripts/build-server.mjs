import { build } from 'esbuild';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await build({
  entryPoints: { server: `${root}/src/stdio.mjs`, preview: `${root}/src/preview.mjs` },
  outdir: `${root}/dist`, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', target: 'node22', format: 'esm',
  banner: { js: "import { createRequire as __createRequire } from 'node:module';const require=__createRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log('Built self-contained local MCP server.');
