import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRuntime } from './runtime.mjs';
import { createMCP } from './mcp.mjs';

const runtime = await createRuntime();
const server = createMCP({ ...runtime, localURL: runtime.http.baseURL });
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await runtime.close(); await server.close();
}
process.once('SIGTERM', () => close().finally(() => process.exit(0)));
process.once('SIGINT', () => close().finally(() => process.exit(0)));
process.stdin.once('end', () => close().finally(() => process.exit(0)));
await server.connect(new StdioServerTransport());
