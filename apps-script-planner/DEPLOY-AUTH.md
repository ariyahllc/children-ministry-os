# CI deploy auth

## Durable path (target — no clasp, non-expiring)
CI deploys via the **Apps Script REST API** using `ci/deploy.mjs`, authed by a long-lived
OAuth **refresh token** from the `clasp-ci` Desktop OAuth client (Internal consent) with the
management scopes `script.projects` + `script.deployments`. No clasp, no npm install
(Node built-in `fetch`). This does not suffer the clasp token expiry.

**Secrets used:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
`CLASP_DEPLOYMENT_ID` (the live deployment id). `SCRIPT_ID` is read from
`apps-script-planner/.clasp.json` in the workflow.

### One-time setup
1. Prereqs (already done): `clasp-ci` **Desktop** OAuth client created; OAuth consent screen
   **Internal**; **Apps Script API** enabled.
2. Mint the token + set the three secrets automatically:
   ```bash
   node ci/mint-token.mjs ~/Downloads/client_secret_XXXX.json
   ```
   Sign in as children-ministry@acfi.cc, approve. It stores GOOGLE_CLIENT_ID /
   GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN as GitHub secrets via `gh`.
3. The workflow (`.github/workflows/deploy.yml`) runs `node ci/deploy.mjs` on push to
   `apps-script-planner/**`. Deploys just work — no periodic re-login.

### If the durable deploy ever fails
- `invalid_grant` on refresh: the refresh token was revoked (e.g. consent screen flipped
  back to External/Testing, or the client deleted). Re-run `ci/mint-token.mjs`.
- `403 / PERMISSION_DENIED`: the token is missing a management scope, or the Apps Script API
  is off — re-check step 1, then re-mint.

---

## Legacy path (clasp) — fallback only
The old workflow used clasp with a `CLASPRC_JSON` secret from a plain global `clasp login`.
It works but the token **expires fast** on this Workspace (recurring `invalid_grant`), which
is why we moved to the durable path above. If you ever revert:
- `npx @google/clasp@2.4.2 login` (plain — NOT `--creds`, which grants the script's runtime
  scopes, missing `script.projects`/`script.deployments` so deploy fails "Insufficient
  Permission"), then `gh secret set CLASPRC_JSON -R ariyahllc/children-ministry-os < ~/.clasprc.json`.
- Verify scopes: `node -e "console.log(require(require('os').homedir()+'/.clasprc.json').token.scope)"`.
