// Durable deploy for the CM Planner Apps Script web app — no clasp.
// Pushes content + creates a version + points the live deployment at it, via the
// Apps Script REST API, authed by a long-lived OAuth refresh token (custom client,
// Internal consent). Uses only Node built-ins (global fetch) — no npm install.
//
// Required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
//               SCRIPT_ID, DEPLOYMENT_ID
import { readFileSync } from 'node:fs';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, SCRIPT_ID, DEPLOYMENT_ID } = process.env;
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'SCRIPT_ID', 'DEPLOYMENT_ID'])
  if (!process.env[k]) { console.error('Missing env ' + k); process.exit(1); }

const DIR = 'apps-script-planner';
const SHA = (process.env.GITHUB_SHA || 'local').slice(0, 7);

async function accessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(j));
  return j.access_token;
}
const src = (p) => readFileSync(`${DIR}/${p}`, 'utf8');

async function api(method, path, body) {
  const r = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}${path}`, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

let TOKEN;
(async () => {
  TOKEN = await accessToken();

  // 1) push content (replaces all files)
  const files = [
    { name: 'appsscript', type: 'JSON', source: src('appsscript.json') },
    { name: 'Code', type: 'SERVER_JS', source: src('Code.gs') },
    { name: 'Index', type: 'HTML', source: src('Index.html') },
  ];
  await api('PUT', '/content', { files });
  console.log('✓ pushed content');

  // 2) create a version
  const ver = (await api('POST', '/versions', { description: `CI ${SHA}` })).versionNumber;
  console.log('✓ created version', ver);

  // 3) point the live deployment at it
  await api('PUT', `/deployments/${DEPLOYMENT_ID}`, {
    deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: ver, manifestFileName: 'appsscript', description: `CI ${SHA}` },
  });
  console.log('✓ deployment updated to version', ver);
})().catch((e) => { console.error(e.message); process.exit(1); });
