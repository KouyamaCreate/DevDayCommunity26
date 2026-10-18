import { join } from 'node:path';
import { Config } from './config.mjs';
import { Sessions } from './state.mjs';
import { Google } from './google.mjs';
import { Reports } from './reports.mjs';
import { MapService } from './service.mjs';
import { ChatAgent } from './chat.mjs';
import { startHTTP } from './http.mjs';

export async function createRuntime({ port = 0, config = new Config(), google, reports, sessions = new Sessions(), chat } = {}) {
  const service = new MapService({ sessions, config, google: google || new Google(config), reports: reports || new Reports({ cacheDirectory: join(config.directory, 'public-reports') }) });
  chat ||= new ChatAgent({ service, sessions, env: config.env });
  const http = await startHTTP({ service, config, sessions, port, chat });
  return { service, sessions, config, http, chat, async close() { sessions.close(); await http.close(); } };
}
