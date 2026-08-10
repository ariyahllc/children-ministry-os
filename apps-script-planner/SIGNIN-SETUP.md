# Google Sign-In setup (Console steps — you do these once)

These are the only steps that touch your Google account. `gcloud` can't create the OAuth
client, so this is a Console click-through. ~10 minutes. Do it signed in as
`children-ministry@acfi.cc`.

**Order matters:** run `clasp create` FIRST (from `DEPLOY-CLASP.md`) so you have the
**Script ID** — the OAuth redirect URL needs it. Find it in `.clasp.json` after create,
or in the Apps Script editor: **Project Settings → IDs → Script ID**.

---

## A. Pick/point a Cloud project

1. Go to https://console.cloud.google.com → top project picker → **New Project**
   (or pick an existing one). Name it e.g. `cm-planner`. Note the **Project number**.
2. Link it to the script so the consent screen applies: Apps Script editor →
   **Project Settings → Google Cloud Platform (GCP) Project → Change project** → paste the
   Project number → Set.

## B. Configure the OAuth consent screen

3. Console → **APIs & Services → OAuth consent screen**.
4. **User type: External** → Create. (External is required because teachers use personal Gmail.)
5. Fill: App name `Children's Ministry Planner`, user support email `children-ministry@acfi.cc`,
   developer contact `children-ministry@acfi.cc`. Save & continue.
6. **Scopes** → Add → select **`openid`** and **`.../auth/userinfo.email`** (email). These are
   non-sensitive; no Google verification needed. Save & continue.
7. **Test users** → **Add users** → add every member's email (the `@acfi.cc` ones AND each
   teacher/co-teacher's Gmail). Save.
   - Leave publishing status on **Testing**. Test users see no "unverified app" warning.
     (Cap is 100 users — plenty. This is effectively a second allowlist; the `Members` tab
     is still the real gate.)

## C. Create the OAuth client ID

8. Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
9. **Application type: Web application**. Name: `CM Planner Web`.
10. **Authorized redirect URIs → Add URI**, paste (swap in your Script ID):
    the app's own deployed **web-app `/exec` URL** (the same link people open):
    ```
    https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
    ```
    Google redirects back here after consent; the app handles it in `doGet`. It must be
    byte-identical to the `WEBAPP_URL` property below. (We do NOT use the `usercallback`
    path — that mechanism can't bind a third-party sign-in to an owner-run app.)
11. **Create.** Copy the **Client ID** and **Client secret**.

## D. Give them to the app (not the repo)

12. Apps Script editor → **Project Settings → Script Properties → Add**:
    - `GOOGLE_CLIENT_ID` = the Client ID
    - `GOOGLE_CLIENT_SECRET` = the Client secret
    - `WEBAPP_URL` = the exact `/exec` URL from step 10 (the app sends it in the token
      exchange; Google checks it matches the registered redirect URI exactly).
    These live only in the script's properties — never in code or git.

- **Client ID** is public — fine to paste in chat if you want me to sanity-check it.
- **Client secret** is sensitive — put it only in Script Properties, never share it.

---

## What happens after

Everyone signs in with Google (there is no domain auto-identify once the app is open to
"anyone" — Google withholds the visitor's email, so the button is the path for all):
- Open the `/exec` URL → **Sign in with Google** → pick account → in as your `Members` role.
- Adding someone = add their email to `Members` (+ as a test user in step 7 while in
  Testing mode).

The invite-link mechanism (`?k=…`) stays in the code as a fallback; remove it once you've
standardized on Sign-In (required before any child PII).
