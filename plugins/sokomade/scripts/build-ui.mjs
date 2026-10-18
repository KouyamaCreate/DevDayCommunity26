import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
let html = await readFile(`${root}/dist/web/index.html`, 'utf8');
for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const js = await readFile(`${root}/dist/web${match[1]}`, 'utf8');
  html = html.replace(match[0], () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
}
for (const match of [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]) {
  const css = await readFile(`${root}/dist/web${match[1]}`, 'utf8');
  html = html.replace(match[0], () => `<style>${css}</style>`);
}
await writeFile(`${root}/dist/ui.html`, html);
console.log('Built self-contained MCP map UI.');
