// One-time: mint a long-lived refresh token for the durable CI deploy, and store the
// three secrets in GitHub. Run locally, signed in as children-ministry@acfi.cc.
//
//   node ci/mint-token.mjs ~/Downloads/client_secret_XXXX.json
//
// Uses your "clasp-ci" Desktop OAuth client (Internal consent) and requests the Apps
// Script MANAGEMENT scopes (script.projects + script.deployments) — the scopes clasp's
// --creds login was missing. Sets GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
// GOOGLE_REFRESH_TOKEN via `gh` automatically.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';

const REPO = 'ariyahllc/children-ministry-os';
const credPath = process.argv[2];
if (!credPath) { console.error('usage: node ci/mint-token.mjs <client_secret.json>'); process.exit(1); }
const c = (JSON.parse(readFileSync(credPath, 'utf8')).installed) || (JSON.parse(readFileSync(credPath, 'utf8')).web);
const CLIENT_ID = c.client_id, CLIENT_SECRET = c.client_secret;
const SCOPES = ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/script.deployments'].join(' ');
const PORT = 4321, REDIRECT = `http://localhost:${PORT}`;
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.end('no code'); return; }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: REDIRECT }),
  });
  const j = await r.json();
  res.end('Done — you can close this tab and return to the terminal.');
  server.close();
  if (!j.refresh_token) { console.error('\nNo refresh_token returned:', JSON.stringify(j, null, 2)); process.exit(1); }
  const set = (name, val) => execFileSync('gh', ['secret', 'set', name, '-R', REPO, '-b', val], { stdio: 'inherit' });
  set('GOOGLE_CLIENT_ID', CLIENT_ID);
  set('GOOGLE_CLIENT_SECRET', CLIENT_SECRET);
  set('GOOGLE_REFRESH_TOKEN', j.refresh_token);
  console.log('\n✓ Secrets set: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.');
  console.log('  Push any change (or: gh workflow run deploy.yml -R ' + REPO + ') to deploy via the durable path.');
  process.exit(0);
});
server.listen(PORT, () => {
  console.log('Opening consent — sign in as children-ministry@acfi.cc and approve:\n\n' + authUrl + '\n');
  spawn('open', [authUrl]);
});
