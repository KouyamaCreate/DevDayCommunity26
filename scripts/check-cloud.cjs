const assert = require('node:assert/strict');
const path = require('node:path');

const resolved = require.resolve('picocolors');
const localModules = path.resolve(__dirname, '../node_modules') + path.sep;
assert.ok(resolved.startsWith(localModules), `Expected a local dependency: ${resolved}`);

const colors = require('picocolors').createColors(true);
assert.equal(colors.green('Cloud dependency check OK'), '\u001b[32mCloud dependency check OK\u001b[39m');

console.log('Cloud dependency check OK');
console.log(`picocolors resolved from: ${resolved}`);
