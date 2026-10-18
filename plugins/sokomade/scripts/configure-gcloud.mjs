import { execFileSync } from 'node:child_process';
import { Config } from '../src/config.mjs';

const project = process.argv[2];
if (!project || !/^[a-z][a-z0-9-]{5,29}$/.test(project)) throw new Error('Pass the dedicated Google Cloud project ID.');
const env = { ...process.env, CLOUDSDK_CORE_DISABLE_FILE_LOGGING: 'true' };
function gcloud(args, json = true) {
  try {
    const output = execFileSync('gcloud', [...args, `--project=${project}`, '--quiet', `--format=${json ? 'json' : 'value(keyString)'}`], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    return json ? JSON.parse(output || '{}') : output.trim();
  } catch {
    throw new Error(`Google Cloud configuration failed at ${args.slice(0, 3).join(' ')}. Inspect project/API permissions without printing key strings.`);
  }
}
const existing = gcloud(['services', 'api-keys', 'list']);
function key(id, displayName, services, referrers) {
  let resource = existing.find(k => k.displayName === displayName);
  if (!resource) {
    const args = ['services', 'api-keys', 'create', `--key-id=${id}`, `--display-name=${displayName}`, ...services.map(service => `--api-target=service=${service}`)];
    if (referrers) args.push(`--allowed-referrers=${referrers.join(',')}`);
    gcloud(args);
    resource = gcloud(['services', 'api-keys', 'list']).find(k => k.displayName === displayName);
  }
  if (!resource?.name) throw new Error('API key resource was not created.');
  const restrictions = ['services', 'api-keys', 'update', resource.name, ...services.map(service => `--api-target=service=${service}`)];
  if (referrers) restrictions.push(`--allowed-referrers=${referrers.join(',')}`);
  gcloud(restrictions);
  return gcloud(['services', 'api-keys', 'get-key-string', resource.name], false);
}
const serverKey = key('sokomade-server', 'Sokomade server', ['places.googleapis.com', 'routes.googleapis.com', 'geocoding-backend.googleapis.com']);
const browserKey = key('sokomade-browser', 'Sokomade browser', ['maps-backend.googleapis.com'], [
  'http://127.0.0.1', 'http://127.0.0.1/*', 'http://localhost', 'http://localhost/*', 'https://*.oaiusercontent.com/*', 'https://chatgpt.com/*', 'https://*.openai.com/*',
]);
const config = new Config();
await config.save({ serverKey, browserKey });
console.log(JSON.stringify({ project, configuration: await config.status(), keysSaved: true }));
