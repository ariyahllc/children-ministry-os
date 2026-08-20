# Durable CI auth for clasp (stop the 7-day `invalid_grant`)

**Problem:** GitHub Actions deploys via clasp using the token in the `CLASPRC_JSON` secret.
That token comes from `clasp login`, which by default uses an OAuth client whose consent
screen is in **Testing** mode — and Google **expires those refresh tokens every 7 days**.
That's the recurring `Error retrieving access token: Error: invalid_grant`.

**Fix:** log in with **your own OAuth client** whose consent screen is **Internal**
(allowed because `children-ministry@acfi.cc` is a Google Workspace / `acfi.cc` account).
Internal-consent refresh tokens **do not expire**. Nothing in the workflow changes — the
`CLASPRC_JSON` secret just holds a long-lived token instead of a 7-day one.

> Why not a service account? Apps Script projects are user-owned; clasp can't authenticate
> as a service account. A true SA would need Workspace **domain-wide delegation** (super-admin)
> **and** a custom deploy script replacing clasp. The Internal-OAuth-client route below is far
> simpler and equally non-expiring.

---

## One-time setup (do this signed in as children-ministry@acfi.cc)

> ⚠️ **Use a SEPARATE new project — NOT the app's sign-in project.** The app's project has an
> **External** consent screen so teachers can sign in with personal Gmail. If you flip THAT
> project to Internal, every non-`@acfi.cc` user gets blocked. So make a fresh project just
> for clasp CI, and make only that one Internal.

### A. New project
1. Google Cloud Console → **New Project** → name it `clasp-ci`. (Leave the app's project alone.)

### B. Enable the Apps Script API for `clasp-ci`
2. In `clasp-ci`: **APIs & Services → Library → "Apps Script API" → Enable.**
   (Also make sure it's on at https://script.google.com/home/usersettings.)

### C. Consent screen = Internal (safe here — this project has no app users)
3. `clasp-ci` → **APIs & Services → OAuth consent screen** (newer UI: **Audience**) →
   **User type: Internal** → Save.

### D. Create an OAuth client for clasp
4. `clasp-ci` → **APIs & Services → Credentials → Create credentials → OAuth client ID.**
5. **Application type: Desktop app.** Name: `clasp-ci`. Create.
6. **Download JSON** for that client → save it as `creds.json` locally (keep it private; do
   NOT commit it).

### D. Log in with that client to mint a long-lived token
8. Locally:
   ```bash
   npx @google/clasp@2.4.2 login --creds creds.json
   ```
   Sign in as **children-ministry@acfi.cc**, approve. This writes `~/.clasprc.json` with a
   **non-expiring** refresh token.

### E. Put the long-lived token in the CI secret
9. ```bash
   gh secret set CLASPRC_JSON -R ariyahllc/children-ministry-os < ~/.clasprc.json
   ```
10. Re-run the deploy workflow (or push any change). CI should deploy green — and keep
    working without periodic re-login.

---

## Notes
- The GitHub Actions workflow (`.github/workflows/deploy.yml`) is unchanged — it still reads
  `CLASPRC_JSON` and `CLASP_DEPLOYMENT_ID`.
- If CI ever fails auth again after this, it's almost certainly because the OAuth client or
  its consent screen was changed back to External/Testing — re-check step A.
- Delete `creds.json` after step 8 if you like; it's only needed to mint the token. Keep it
  if you want to re-mint later.
