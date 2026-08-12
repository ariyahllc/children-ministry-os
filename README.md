# Children's Ministry OS

Planning & operations app for the Austin Christian Fellowship of India (ACFI)
Children's Ministry — role-based dashboards, events & tasks, calendar, children
roster (with field-level PII protection), finances/budget, media, and the
"Ask Dorothy" AI assistant.

The app is a **Google Apps Script web app** in [`apps-script-planner/`](apps-script-planner/):

- `Code.gs` — backend (auth/RBAC, CRUD, finances, media, AI)
- `Index.html` — single-page frontend
- `appsscript.json` — manifest
- `DEPLOY-CLASP.md` / `SIGNIN-SETUP.md` — deploy & Google Sign-In setup

It runs entirely inside the `children-ministry@acfi.cc` Google account; child PII
never leaves Google Drive. See `apps-script-planner/README.md` for details.

> The previous Base44/React prototype was removed on 2026-08-12 — it was
> superseded by the Apps Script app and is recoverable from git history.
