# Deploying with clasp (no copy-paste)

`clasp` is Google's official Apps Script CLI. You authenticate it to
`children-ministry@acfi.cc`; it pushes **code only** — it never reads the sheet data.
Claude never touches the account.

Run everything from this folder:
`/Users/dinesh/repos/children-ministry-os/apps-script-planner`

We pin clasp v2 (stable, well-known commands) and use `npx` so there's no global install.

---

## One-time account prep (in a browser, signed in as children-ministry@acfi.cc)

1. **Enable the Apps Script API** for the account:
   https://script.google.com/home/usersettings → turn **Apps Script API** ON.
2. **Create a NEW, empty backend spreadsheet** in the correct existing Drive folder.
   Name it `CM Planner DB`. This holds only the app's 5 planning tabs
   (Members/Epics/Tasks/Budget/Feedback) — **no student data**. Your existing
   `CM -2026` / `Student List` files stay untouched and out of the app's path.
   Copy the new file's ID from the URL: `docs.google.com/spreadsheets/d/`**`THIS_IS_THE_ID`**`/edit`.

## CLI steps

```bash
# 1. Sign clasp in to the ministry account (opens a browser — YOU approve)
npx @google/clasp@2.4.2 login

# 2. Create a standalone Apps Script project (writes .clasp.json here)
npx @google/clasp@2.4.2 create --type standalone --title "CM Planner" --rootDir .
#    If it warns that appsscript.json exists, keep the existing one.

# 3. Push the local code up (force overwrites the starter files)
npx @google/clasp@2.4.2 push -f

# 4. Open the project to set config values + authorize
npx @google/clasp@2.4.2 open
```

> **Grab the Script ID now.** After step 2 it's in `.clasp.json` (and in the editor under
> **Project Settings → IDs**). You need it for the Google Sign-In redirect URL — do the
> **`SIGNIN-SETUP.md`** Console steps in parallel; they produce the two client properties below.

## In the editor tab that opens (one-time config)

5. **Project Settings (gear) → Script Properties → Add** four properties:
   - `SPREADSHEET_ID` = the backend sheet ID you copied above.
   - `SCRIPT_ID` = this project's Script ID (Project Settings → IDs, or `.clasp.json`).
     The sign-in flow builds its OAuth redirect URL from this.
   - `GOOGLE_CLIENT_ID` = from `SIGNIN-SETUP.md` step C.
   - `GOOGLE_CLIENT_SECRET` = from `SIGNIN-SETUP.md` step C (sensitive — properties only, never the repo).
6. **Editor → select `seedSampleData` → Run.** Approve the authorization prompt
   (this is where the app gets permission to read/write *its own* sheet, as the owner).
   It fills the tabs with fake sample data — never real records.

## Deploy the web app

```bash
# 7. Create a web-app deployment and print the URL
npx @google/clasp@2.4.2 deploy --description "v1"
```

The web-app URL is `https://script.google.com/a/macros/acfi.cc/s/<DEPLOY_ID>/exec`.
(You can also get an instant URL without deploying via the editor:
**Deploy → Test deployments → Web app**.)

Open that URL:
- as an `@acfi.cc` account → straight into the app (auto-identified);
- as a personal Gmail → you get a **Sign in with Google** button (that Gmail must be a
  Member *and* a test user per `SIGNIN-SETUP.md` step 7).

---

## After code changes

Just `npx @google/clasp@2.4.2 push -f`. For a new version:
`npx @google/clasp@2.4.2 deploy --description "v2"`.

## Important: who can sign in

The manifest is `access: ANYONE`, `executeAs: USER_DEPLOYING`. The app always runs as
`children-ministry@acfi.cc`, so **the sheet is shared with no one** — data stays in that one
account. ✅  Identity works two ways:

- **`@acfi.cc` members** (admin, co-leaders, board reps): auto-identified by Google. Open the
  URL, done — no link, no button.
- **Personal-Gmail members** (teachers, co-teachers): **Sign in with Google** (verified). Add
  their email to `Members` and as a test user (`SIGNIN-SETUP.md` step 7); they open the URL,
  click the button, pick their Gmail, and land in their role. Any device, no link.
- Anyone not a Member (and not signed in on `@acfi.cc`) hits an "Access needed" screen.

Sign-In requires the one-time Console setup in **`SIGNIN-SETUP.md`** plus the
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` Script Properties above.

> **Switchover note:** the older per-member **invite-link** path (`?k=…`, Members → Copy link)
> stays in the code as a fallback until Sign-In is confirmed working end to end, then it's
> removed.

**PII note:** today's tabs are planning logistics only (no children's records). Sign-In is the
verified-identity model we required before any child PII is added — see the spec.
