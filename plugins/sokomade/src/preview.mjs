import { Config } from './config.mjs';
import { webEnvironment } from './web-env.mjs';
import { createRuntime } from './runtime.mjs';
const runtime = await createRuntime({ port: Number(process.env.PORT || 4184), config: new Config({ env: await webEnvironment() }) });
console.log(`Sokomade Web: ${runtime.http.baseURL}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.close().finally(() => process.exit(0)));
