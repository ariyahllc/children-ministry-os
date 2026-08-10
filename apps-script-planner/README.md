# Children's Ministry Planner — Apps Script web app

A role-based planner that lives entirely inside your Google account. Gmail sign-in,
invite-only, Google Sheet as the database. No data ever leaves Google Drive.

- `Code.gs` — server: auth, roles, all data operations
- `Index.html` — the web UI
- `appsscript.json` — web-app + auth config

**You do the deploy (≈10 min)** because it needs the `children-ministry@acfi.cc`
account. Claude never touches the account or your data.

---

## One-time setup

### 1. Create the database spreadsheet
1. Sign in as `children-ministry@acfi.cc`.
2. In the **existing Drive folder** where you want this to live, create a new Google Sheet.
   Name it something like **CM Planner DB**. (The app only ever adds *tabs* to this one
   file — it never creates other files, so your folder structure stays untouched.)

### 2. Add the code
1. In that sheet: **Extensions → Apps Script**.
2. Rename the project to **CM Planner**.
3. Replace the contents of `Code.gs` with this repo's `Code.gs`.
4. **File → + → HTML**, name it exactly **Index** (no `.html`), and paste this repo's
   `Index.html` into it.
5. Show the manifest: **Project Settings (gear) → check "Show appsscript.json"**. Open
   `appsscript.json` in the editor and replace it with this repo's version. Change
   `"timeZone"` to your local zone if it isn't `America/New_York`.

### 3. Seed test data + authorize
1. In the editor, pick the function **`seedSampleData`** and click **Run**.
2. Google will ask you to authorize — approve it (it needs to read your email and edit this
   sheet). This also adds **you as an admin** and creates fake sample data so you can try it.

### 4. Deploy as a web app
1. **Deploy → New deployment → gear → Web app**.
2. Set:
   - **Execute as:** *Me (children-ministry@acfi.cc)*  ← the app runs as the owner, so the sheet is shared with no one and PII stays in this account
   - **Who has access:** *Anyone with a Google account*  ← lets personal-Gmail members open their invite link; the token + Members tab are the real gate
3. **Deploy**, copy the **Web app URL**. That link is the app.

> The manifest (`appsscript.json`) already encodes these two settings, so a `clasp`
> deploy uses them automatically — see `DEPLOY-CLASP.md`.

### 5. Try it
Open the URL as `children-ministry@acfi.cc`. You should land on the **admin dashboard**
with the sample epic and tasks.

---

## Inviting people (invite-only)

- **@acfi.cc members** (admin, co-leaders, board reps): just add them in **Members → + Add
  member**. They sign in automatically — no link needed.
- **Personal-Gmail members** (teachers, co-teachers): add them, then **Members → Copy link**
  next to their name and send them that private link. It carries their identity and role.
  **Reset** rotates a link that leaked.

Anyone without a valid link and not on `@acfi.cc` sees an "Access needed" screen. Remove a
member's row (or reset their link) to revoke access.

**Roles:** `admin`, `co_leader`, `teacher`, `co_teacher`, `treasurer`, `board_rep`.

| Role | Sees | Can change |
|---|---|---|
| admin | everything + roster | everything |
| co_leader | everything | epics, tasks (create + assign) |
| teacher / co_teacher | all epics + tasks | status/notes on **their own** tasks |
| treasurer | epics + budget | budget/expenses |
| board_rep | epics, tasks, budget summary | nothing (read-only) |

**Tip — test other roles:** temporarily change your own `role` in the `Members` tab (e.g. to
`teacher`), refresh the app, and you'll see that role's dashboard. Set it back to `admin` after.

---

## Loading your real data

Once you're happy with the flow, delete the sample rows and enter real epics/tasks — either
in the app or straight into the tabs. Columns are fixed (don't rename the header row):

- `Epics`: id, name, type, event_date (YYYY-MM-DD), status, notes
- `Tasks`: id, epic_id, title, owner (must match a Members *name*), due_offset (e.g. `-6w`), due_date (auto), status, priority, notes
- `Members`, `Budget`, `Feedback`: see the header rows the script creates.

`due_offset` is the magic column: set the epic's `event_date` once and every task shows a real
date + countdown ("in 6 wk", "overdue 3d"). Formats: `-6w` (weeks), `-3d` (days), `-2m` (months).

## Redeploying after code changes

Paste new code, then **Deploy → Manage deployments → edit (pencil) → Version: New version →
Deploy**. Same URL stays valid.

## Embedding in Google Sites (optional)

In Google Sites: **Insert → Embed → By URL**, paste the web-app URL. It renders inside your
site, still enforcing Gmail sign-in and roles.

---

## Notes on data safety

- The spreadsheet is shared with **no one** but the account owner. Users never open it — they
  only use the web app, which enforces roles server-side.
- Identity is resolved server-side: `@acfi.cc` users via Google's verified domain identity,
  personal-Gmail users via their invite token. Roles can't be spoofed from the browser.
- Everything runs on Google's servers. Nothing is sent to any third party.
- Invite links are bearer credentials. Today's tabs hold planning logistics only (no
  children's records); before any child PII lands, auth upgrades to verified Google Sign-In.

## Roadmap (not in this MVP)

- WhatsApp/SMS reminders via time-based triggers + WhatsApp Business API (logistics only — no PII).
- Gemini generating Forms/Sheets/signups via `FormApp`/`SpreadsheetApp` (children's PII kept out of prompts).
