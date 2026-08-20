# CI deploy auth for clasp

GitHub Actions deploys via clasp using the token in the `CLASPRC_JSON` secret.

## Current setup (works)
- Auth = a plain **global `clasp login`** token (has the management scopes
  `script.projects` + `script.deployments` that `clasp deploy` needs).
- The secret `CLASPRC_JSON` holds `~/.clasprc.json`; `CLASP_DEPLOYMENT_ID` holds the live
  deployment id. The workflow writes the token and runs `clasp push` + `clasp deploy`.
- **Only CI runs clasp.** Do NOT run `clasp` locally (push/deploy/login) — doing so can
  rotate/invalidate the shared refresh token and break CI (`invalid_grant`).

## If CI fails with `invalid_grant` (token died)
1. Locally: `npx @google/clasp@2.4.2 login` — a **plain** login, signed in as
   children-ministry@acfi.cc.
   - Do NOT use `clasp login --creds`: that grants the *script's* runtime scopes (drive,
     forms, spreadsheets…) for `clasp run`, NOT clasp's management scopes — so `push` limps
     and `deploy` fails with **"Insufficient Permission."**
2. Verify scopes include `script.projects` and `script.deployments`:
   ```bash
   node -e "console.log(require(require('os').homedir()+'/.clasprc.json').token.scope)"
   ```
3. Update the secret + re-run:
   ```bash
   gh secret set CLASPRC_JSON -R ariyahllc/children-ministry-os < ~/.clasprc.json
   gh workflow run deploy.yml -R ariyahllc/children-ministry-os
   ```

## Truly durable option (only if the above keeps dying)
Bypass clasp: a small Node deploy script hitting the Apps Script API directly, authed by a
**service account with Google Workspace domain-wide delegation** (impersonating
children-ministry@acfi.cc) or a custom OAuth client granted the management scopes. Non-
expiring, but more moving parts — not built yet.
