/**
 * Children's Ministry Planner — Google Apps Script backend.
 *
 * Runs entirely inside the children-ministry@acfi.cc Google account.
 * Data (incl. children's PII) never leaves Google Drive: this script reads/writes
 * the bound spreadsheet directly and serves the UI via HtmlService (same origin).
 *
 * Auth: deployed to "execute as me (the owner)" so the sheet is shared with nobody.
 * Callers are identified two ways: personal-Gmail members by a per-member invite
 * token (?k=…); @acfi.cc members auto-identified via Session domain identity.
 * RBAC: the Members tab is the allowlist + role source of truth (server-enforced).
 */

// Standalone script: set a Script Property named SPREADSHEET_ID to the backend
// sheet's ID (Project Settings → Script Properties, or `clasp` / console).
// Bound script: leave the property unset and it uses the active spreadsheet.
const SPREADSHEET_ID =
  PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';

const TABS = {
  MEMBERS: 'Members',
  EPICS: 'Events',
  TASKS: 'Tasks',
  BUDGET: 'Expenses',
  FEEDBACK: 'Feedback',
  CHILDREN: 'Children',
  ATTENDANCE: 'Attendance',
  WEEKLY: 'Weekly',
  ASSIGNMENTS: 'Assignments',
  ANNOUNCEMENTS: 'Announcements',
  LESSONS: 'Lessons',
  BUDGETPLAN: 'Budgets',
};

const SCHEMA = {
  Members:  ['email', 'name', 'role', 'token', 'class'],
  Events:   ['id', 'name', 'type', 'event_date', 'status', 'notes', 'program', 'archived', 'no_school'],
  Tasks:    ['id', 'epic_id', 'title', 'owner', 'due_offset', 'due_date', 'status', 'priority', 'notes'],
  Expenses: ['id', 'epic_id', 'item', 'category', 'amount', 'status', 'notes', 'date', 'paid_by', 'reimbursed', 'receipt_url', 'budget_category'],
  Budgets: ['id', 'fy', 'category', 'amount', 'notes'],
  Feedback: ['id', 'epic_id', 'text', 'converted', 'converted_task_id'],
  // Column A is id (backfilled); columns B..N match the user's Children list; class is last.
  Children: ['id', 'name', 'age', 'grade', 'dob', 'father_name', 'father_contact', 'father_email',
             'mother_name', 'mother_contact', 'mother_email', 'language', 'allergies',
             'social_media_permission', 'class'],
  Attendance: ['id', 'date', 'class', 'child_id', 'child_name'], // one row per present child
  Weekly:     ['id', 'date', 'class', 'offertory', 'lesson', 'lesson_no', 'lesson_done', 'notes', 'substitute'], // one row per class per Sunday
  Announcements: ['date', 'slides_link', 'notes'], // one row per Sunday (ministry-wide), keyed by date
  Assignments: ['id', 'email', 'name', 'class', 'role', 'semester'], // who teaches which class each semester
  Lessons:    ['class', 'next_lesson'], // per-class pointer: the next lesson number to teach
};

// Fixed class list (grouping + teacher scoping). No separate Classes tab for now.
const CLASSES = ['Toddler', 'Elementary', 'Middle School', 'High School'];

/* --- semesters: academic year Jul–Jun, two halves. Internal key "YYYYF"/"YYYYS"
   (F=Jul–Dec, S=Jan–Jun of the next year), displayed as the calendar year. --- */
function semKeyFor_(dateStr) {
  var dt;
  if (dateStr) { var s = fmtDate_(dateStr); var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(); }
  else dt = new Date();
  var y = dt.getFullYear(), mo = dt.getMonth();
  var ay = (mo >= 6) ? y : y - 1;
  return ay + ((mo >= 6) ? 'F' : 'S');
}
function currentSemester_() { return semKeyFor_(null); }
function semLabel_(key) { var y = parseInt(key, 10); return (String(key).slice(-1) === 'F') ? String(y) : String(y + 1); }
function semDesc_(key) { var y = parseInt(key, 10); return (String(key).slice(-1) === 'F') ? ('Jul–Dec ' + y) : ('Jan–Jun ' + (y + 1)); }
function nextSem_(key) { var y = parseInt(key, 10); return (String(key).slice(-1) === 'F') ? (y + 'S') : ((y + 1) + 'F'); }
function prevSem_(key) { var y = parseInt(key, 10); return (String(key).slice(-1) === 'S') ? (y + 'F') : ((y - 1) + 'S'); }

// Programs group events (the "Epic → Event → Task" top level, labelled "Program").
const PROGRAMS = ["Children's Ministry", 'Outreach', 'Special Events', 'Fund Raisers', 'Church Events'];

// The ONLY child fields a teacher/co-teacher may receive (server-side allowlist).
// Parent contact, DOB, and language are never sent to doers.
const CHILD_DOER_FIELDS = ['id', 'name', 'age', 'grade', 'class', 'allergies', 'social_media_permission'];
// Board rep: roster overview only — NO contacts, DOB, allergies (medical PII).
const CHILD_BOARD_FIELDS = ['id', 'name', 'age', 'grade', 'class'];

const ROLES = ['admin', 'co_leader', 'teacher', 'co_teacher', 'treasurer', 'board_rep', 'chairman'];
const OBSERVERS = ['board_rep', 'chairman']; // read-only overview roles
const LEADERS = ['admin', 'co_leader'];
const DOERS = ['teacher', 'co_teacher'];

const EPIC_TYPES = ["Children's Sunday", 'VBS', 'ADC', 'Outreach', 'Conference', 'Special', 'Other'];
const TASK_STATUS = ['Pending', 'In Progress', 'Completed'];
const TASK_PRIORITY = ['Low', 'Medium', 'High', 'Urgent'];
const EPIC_STATUS = ['Planning', 'Upcoming', 'In Progress', 'Completed'];

/* ---------------------------------------------------------------- web entry */

function doGet(e) {
  if (e && e.parameter && e.parameter.code) return handleOAuth_(e); // Google sign-in redirect lands here
  const t = HtmlService.createTemplateFromFile('Index');
  // Personal invite token from the ?k=… link, injected into the page so the
  // sandboxed client can read it (the iframe can't see the top-level query).
  t.inviteToken = (e && e.parameter && e.parameter.k) ? String(e.parameter.k) : '';
  return t.evaluate()
    .setTitle("Children's Ministry Planner")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // allow Google Sites embed
}

/* ------------------------------------------------------------- spreadsheet */

// Cache the spreadsheet handle + table reads for the duration of ONE request.
// openById is slow, and getBootstrap opened it 6+ times per load — this is the
// single biggest speedup. Writes clear the table cache (see insert_/updateRow_).
var _ssCache = null, _tblCache = {};
function ss_() {
  if (_ssCache) return _ssCache;
  _ssCache = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return _ssCache;
}

function sheet_(tab) {
  const ss = ss_();
  let sh = ss.getSheetByName(tab);
  if (!sh) {
    sh = ss.insertSheet(tab);
    sh.appendRow(SCHEMA[tab]);
    return sh;
  }
  if (sh.getLastRow() === 0) { sh.appendRow(SCHEMA[tab]); return sh; }
  // Auto-provision any schema columns missing from the header (e.g. after adding a field).
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  var missing = (SCHEMA[tab] || []).filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
  return sh;
}

function readTable_(tab) {
  if (Object.prototype.hasOwnProperty.call(_tblCache, tab)) return _tblCache[tab];
  const sh = sheet_(tab);
  const values = sh.getDataRange().getValues();
  const head = values.shift() || SCHEMA[tab];
  const out = values
    .filter(r => String(r[0]).trim() !== '')
    .map(r => {
      const o = {};
      head.forEach((h, i) => { o[h] = r[i]; });
      return o;
    });
  _tblCache[tab] = out;
  return out;
}

function findRowNum_(tab, keyVal) {
  const sh = sheet_(tab);
  const last = Math.max(sh.getLastRow(), 1);
  const ids = sh.getRange(1, 1, last, 1).getValues().map(r => String(r[0]));
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] === String(keyVal)) return i + 1;
  }
  return -1;
}

// The sheet's actual header row is the single source of column order for BOTH
// reads and writes, so a migration that appends columns can never misalign data.
function headerOf_(sh) {
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
}

// Convert Date cell values to strings so google.script.run can serialize the row.
// A raw Date makes it drop the WHOLE payload (client receives null).
function sanitizeRow_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { var v = r[k]; o[k] = (v instanceof Date) ? fmtDate_(v) : v; });
  return o;
}

function insert_(tab, obj) {
  _tblCache = {}; // writes invalidate the per-request read cache
  const sh = sheet_(tab);
  const header = headerOf_(sh);
  const row = header.map(h => (obj[h] !== undefined && obj[h] !== null) ? obj[h] : '');
  sh.appendRow(row);
  return obj;
}

function updateRow_(tab, keyVal, obj) {
  _tblCache = {};
  const sh = sheet_(tab);
  const rn = findRowNum_(tab, keyVal);
  if (rn < 0) throw new Error('Record not found: ' + keyVal);
  const header = headerOf_(sh);
  const cols = header.length;
  const existing = sh.getRange(rn, 1, 1, cols).getValues()[0];
  const row = header.map((h, i) => (obj[h] !== undefined) ? obj[h] : existing[i]);
  sh.getRange(rn, 1, 1, cols).setValues([row]);
  const o = {};
  header.forEach((h, i) => { o[h] = row[i]; });
  return o;
}

function deleteRow_(tab, keyVal) {
  _tblCache = {};
  const rn = findRowNum_(tab, keyVal);
  if (rn > 0) sheet_(tab).deleteRow(rn);
  return { ok: true };
}

function uuid_() { return Utilities.getUuid(); }

/* -------------------------------------------------------------------- auth */

// Identity model:
//  - Personal-Gmail members are identified by a per-member invite token (?k=…).
//  - Domain (@acfi.cc) members are also auto-identified by Google via Session,
//    so admins / co-leaders / board-reps on the org domain need no link.
// The script always runs as the owner (executeAs USER_DEPLOYING), so the sheet
// is shared with nobody and PII stays in the one account.

function domainEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

// Gmail ignores dots and +suffixes in the local part, so normalize before matching.
function normEmail_(e) {
  var s = String(e || '').trim().toLowerCase();
  var at = s.indexOf('@');
  if (at < 0) return s;
  var local = s.slice(0, at), domain = s.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '').split('+')[0];
  return local + '@' + domain;
}

// Accept labels / capitalization / spacing from the sheet and map to a role key.
function normRole_(r) {
  var s = String(r || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (ROLES.indexOf(s) >= 0) return s;
  var map = {
    administrator: 'admin', admin: 'admin',
    coleader: 'co_leader', co_leader: 'co_leader', co_lead: 'co_leader',
    teacher: 'teacher', coteacher: 'co_teacher', co_teacher: 'co_teacher',
    sub_teacher: 'co_teacher', subteacher: 'co_teacher', substitute: 'co_teacher',
    volunteer: 'co_teacher', volunteers: 'co_teacher',
    treasurer: 'treasurer',
    board: 'board_rep', board_rep: 'board_rep', board_representative: 'board_rep',
  };
  return map[s] || '';
}

function memberObj_(m) {
  if (!m) return null;
  const role = normRole_(m.role);
  if (!role) return null;
  return {
    email: String(m.email || '').trim().toLowerCase(),
    name: String(m.name || m.email || ''),
    role: role,
    token: String(m.token || '').trim(),
    class: String(m['class'] || '').trim(),
  };
}

function memberByToken_(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  return memberObj_(readTable_(TABS.MEMBERS).find(x => String(x.token || '').trim() === t));
}

function memberByEmail_(email) {
  const e = normEmail_(email);
  if (!e) return null;
  return memberObj_(readTable_(TABS.MEMBERS).find(x => normEmail_(x.email) === e));
}

// Identity resolution order (invite-link auth is DISABLED — Sign-In only):
//  1. Google Sign-In session token (verified email, any account incl. Gmail)
//  2. @acfi.cc domain identity (auto — owner/editor only)
function resolveMember_(token) {
  var t = String(token || '').trim();
  var m = null;
  if (t) {
    var email = CacheService.getScriptCache().get('sess_' + t);
    if (email) m = memberByEmail_(email);
  }
  if (!m) m = memberByEmail_(domainEmail_());
  return withCurrentClass_(m);
}

// For teachers/co-teachers, their class = this semester's assignment (falls back
// to the Members.class field if no assignment exists yet).
function withCurrentClass_(m) {
  if (!m || DOERS.indexOf(m.role) < 0) return m;
  var cur = currentSemester_();
  var a = readTable_(TABS.ASSIGNMENTS).find(function (x) {
    return String(x.email || '').trim().toLowerCase() === m.email && String(x.semester || '').trim() === cur;
  });
  if (a) m.class = String(a['class'] || '').trim();
  return m;
}

function requireMember_(token) {
  const m = resolveMember_(token);
  if (!m) throw new Error('ACCESS_DENIED');
  return m;
}

function requireLeader_(token) {
  const m = requireMember_(token);
  if (LEADERS.indexOf(m.role) < 0) throw new Error('NOT_ALLOWED');
  return m;
}

function requireAdmin_(token) {
  const m = requireMember_(token);
  if (m.role !== 'admin') throw new Error('NOT_ALLOWED');
  return m;
}

function shortToken_() { return Utilities.getUuid().replace(/-/g, ''); }

// Build a member's personal invite link from their token.
function inviteLink_(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  let base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (err) { base = ''; }
  return base ? (base + '?k=' + encodeURIComponent(t)) : '';
}

/* ---------------------------------------------------------- google sign-in */
// Verified Google Sign-In for personal-Gmail members. The script runs as the
// owner, so it can't read a consumer visitor's email directly. Instead the
// visitor completes a normal Google OAuth in a popup; we exchange the code
// server-side, read the verified email from the id_token, and hand the client
// our own short-lived session token (CacheService). No Google token is stored.

// The OAuth redirect is the app's own /exec URL; Google lands back on doGet with ?code=.
function webappUrl_() {
  return PropertiesService.getScriptProperties().getProperty('WEBAPP_URL')
    || (function () { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } })();
}

function sessionEmail_(token) {
  var t = String(token || '').trim();
  return t ? (CacheService.getScriptCache().get('sess_' + t) || '') : '';
}

// Client calls this (leading token arg is ignored — user isn't signed in yet).
// `nonce` is our own random state; we validate it via CacheService, not Google's
// state-token mechanism (which can't bind a third-party sign-in to an owner-run app).
function getAuthUrl(token, nonce) {
  var clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('Sign-in is not configured (missing GOOGLE_CLIENT_ID).');
  var p = {
    client_id: clientId,
    redirect_uri: webappUrl_(),
    response_type: 'code',
    scope: 'openid email',
    state: String(nonce || ''),
    prompt: 'select_account',
    access_type: 'online',
  };
  var q = Object.keys(p).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&');
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

// Google redirects the popup back to the app's /exec URL with ?code=; doGet routes
// here. Runs as the owner, so the token exchange and email read are trusted.
function handleOAuth_(e) {
  try {
    var code = e.parameter.code;
    var nonce = e.parameter.state;
    var props = PropertiesService.getScriptProperties();
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post', muteHttpExceptions: true,
      payload: {
        code: code,
        client_id: props.getProperty('GOOGLE_CLIENT_ID'),
        client_secret: props.getProperty('GOOGLE_CLIENT_SECRET'),
        redirect_uri: webappUrl_(),
        grant_type: 'authorization_code',
      },
    });
    var body = JSON.parse(res.getContentText());
    if (!body.id_token) throw new Error('token exchange failed');
    // id_token came straight from Google over TLS, so its claims are trusted.
    var payload = decodeJwt_(body.id_token);
    var email = String(payload.email || '').trim().toLowerCase();
    if (!email || payload.email_verified === false) throw new Error('email not verified');
    var session = Utilities.getUuid().replace(/-/g, '');
    var cache = CacheService.getScriptCache();
    cache.put('sess_' + session, email, 21600);           // 6h session
    if (nonce) cache.put('nonce_' + nonce, session, 600); // client picks it up
    return signinPage_('Signed in as ' + email + '. You can close this window.', true);
  } catch (err) {
    return signinPage_('Sign-in failed. Please close this window and try again.');
  }
}

// Client polls this after opening the popup; returns the session token once set.
function pollSignIn(token, nonce) {
  return CacheService.getScriptCache().get('nonce_' + String(nonce || '')) || '';
}

// Invalidate the caller's Google Sign-In session (no-op for invite tokens).
function signOut(token) {
  var t = String(token || '').trim();
  if (t) { try { CacheService.getScriptCache().remove('sess_' + t); } catch (e) {} }
  return { ok: true };
}

function decodeJwt_(jwt) {
  var parts = String(jwt).split('.');
  var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString();
  return JSON.parse(json);
}

function signinPage_(msg, ok) {
  var safe = String(msg).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#1f2937;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;padding:20px}'
    + '.c{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;max-width:340px}</style></head>'
    + '<body><div class="c"><p>' + safe + '</p></div>'
    + '<script>setTimeout(function(){try{window.close();}catch(e){}},' + (ok ? '1200' : '3000') + ');<\/script></body></html>';
  return HtmlService.createHtmlOutput(html);
}

/* ---------------------------------------------------------------- helpers */

function tz_() {
  return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'UTC';
}

// Normalize any cell value (Date object or string) to a 'yyyy-MM-dd' string,
// avoiding UTC/local drift by preferring the literal date parts when present.
function fmtDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

// Compute due date = event date + offset, all in UTC so no timezone shifts a day.
function computeDueDate_(eventDate, offset) {
  const s = fmtDate_(eventDate);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const off = String(offset || '').match(/^\s*([+-]?\d+)\s*([dwm])\s*$/i);
  if (off) {
    const n = parseInt(off[1], 10);
    const unit = off[2].toLowerCase();
    if (unit === 'd') d.setUTCDate(d.getUTCDate() + n);
    else if (unit === 'w') d.setUTCDate(d.getUTCDate() + n * 7);
    else if (unit === 'm') d.setUTCMonth(d.getUTCMonth() + n);
  }
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function enrichTask_(t, epicsById) {
  const epic = epicsById[t.epic_id];
  const eventDate = epic ? fmtDate_(epic.event_date) : '';
  const off = String(t.due_offset || '').trim();
  // With an offset, compute from the event date; otherwise use the task's own
  // absolute date (falling back to the event day when neither is set).
  const due = off ? computeDueDate_(eventDate, off) : (fmtDate_(t.due_date) || eventDate);
  return Object.assign({}, t, { due_date: due, epic_name: epic ? epic.name : '' });
}

/* ------------------------------------------------------------ read: bootstrap */

/**
 * Single round-trip the client calls on load. Returns everything the caller's
 * role is allowed to see. Open-book model: all members see all epics + tasks;
 * budget is visible to leaders / treasurer / board-rep; roster only to admin.
 */
function getBootstrap(token) {
  const me = resolveMember_(token);
  if (!me) {
    return { access: false, email: sessionEmail_(token) || domainEmail_(), roles: ROLES };
  }

  const epics = readTable_(TABS.EPICS).map(e => Object.assign({}, e, { event_date: fmtDate_(e.event_date) }));
  const epicsById = {};
  epics.forEach(e => { epicsById[e.id] = e; });

  // Tasks under archived events (e.g. the imported per-year history buckets) stay in
  // the sheet for the AI + records, but are excluded here so they don't bloat every load.
  const activeEpicIds = {};
  epics.forEach(e => { if (!String(e.archived || '').trim()) activeEpicIds[e.id] = true; });
  const tasks = readTable_(TABS.TASKS)
    .filter(t => !t.epic_id || activeEpicIds[t.epic_id])
    .map(t => enrichTask_(t, epicsById));

  const memberRows = readTable_(TABS.MEMBERS);
  // Compute the web-app base URL ONCE (getUrl() per member was the main slowdown).
  var webBase = ''; try { webBase = ScriptApp.getService().getUrl() || ''; } catch (e) { webBase = ''; }
  const isObserver = OBSERVERS.indexOf(me.role) >= 0;
  const members = (me.role === 'admin') ? memberRows.map(m => ({
    email: m.email, name: m.name, role: m.role, class: m['class'] || '',
    token: m.token || '', link: (webBase && m.token) ? (webBase + '?k=' + encodeURIComponent(m.token)) : '',
  })) : isObserver ? memberRows.map(m => ({ // board rep: read-only, no tokens/links
    email: m.email, name: m.name, role: m.role, class: m['class'] || '', token: '', link: '',
  })) : [];
  const showBudget = LEADERS.indexOf(me.role) >= 0 || me.role === 'treasurer' || OBSERVERS.indexOf(me.role) >= 0;
  const budget = showBudget ? readTable_(TABS.BUDGET).map(sanitizeRow_) : [];
  const budgetPlan = showBudget ? readTable_(TABS.BUDGETPLAN).map(sanitizeRow_) : [];
  const feedback = readTable_(TABS.FEEDBACK).map(sanitizeRow_);

  return {
    access: true,
    me: me,
    epics: epics,
    tasks: tasks,
    members: members,
    memberOptions: memberRows.map(m => m.name).filter(Boolean), // for owner dropdowns
    budget: budget,
    budgetPlan: budgetPlan,
    feedback: feedback,
    meta: {
      epicTypes: EPIC_TYPES, taskStatus: TASK_STATUS, taskPriority: TASK_PRIORITY,
      epicStatus: EPIC_STATUS, roles: ROLES, leaders: LEADERS, doers: DOERS,
      classes: CLASSES, programs: PROGRAMS,
      currentSemester: currentSemester_(), currentSemesterLabel: semLabel_(currentSemester_()),
      canManageAssignments: LEADERS.indexOf(me.role) >= 0,
      canManageMembers: me.role === 'admin',
      canViewMembers: me.role === 'admin' || OBSERVERS.indexOf(me.role) >= 0,
      canManageEpics: LEADERS.indexOf(me.role) >= 0,
      canManageBudget: LEADERS.indexOf(me.role) >= 0 || me.role === 'treasurer',
      canViewFinances: LEADERS.indexOf(me.role) >= 0 || me.role === 'treasurer' || OBSERVERS.indexOf(me.role) >= 0,
      canViewChildren: LEADERS.indexOf(me.role) >= 0 || DOERS.indexOf(me.role) >= 0, // "This Sunday" + full roster
      canViewRoster: LEADERS.indexOf(me.role) >= 0 || DOERS.indexOf(me.role) >= 0 || OBSERVERS.indexOf(me.role) >= 0, // + board rep read-only roster
      canManageChildren: LEADERS.indexOf(me.role) >= 0,
      isBoardRep: OBSERVERS.indexOf(me.role) >= 0,
    },
  };
}

/* ------------------------------------------------------------- write: epics */

function saveEpic(token, data) {
  requireLeader_(token);
  const clean = {
    name: String(data.name || '').trim(),
    program: data.program || '',
    type: data.type || 'Other',
    event_date: fmtDate_(data.event_date),
    status: data.status || 'Planning',
    notes: data.notes || '',
    no_school: data.no_school ? 'yes' : '',
  };
  if (!clean.name) throw new Error('Event name is required');
  if (data.id) return updateRow_(TABS.EPICS, data.id, clean);
  clean.id = uuid_();
  clean.archived = '';
  return insert_(TABS.EPICS, clean);
}

// Open (or, for a leader, create) the "Sunday School" task bucket for one Sunday.
function openSundaySchool(token, date) {
  var me = requireMember_(token);
  date = fmtDate_(date);
  if (!date) throw new Error('Bad date');
  var ex = readTable_(TABS.EPICS).find(function (e) {
    return String(e.name || '').trim().toLowerCase() === 'sunday school' && fmtDate_(e.event_date) === date;
  });
  if (ex) return ex.id;
  if (LEADERS.indexOf(me.role) < 0) return ''; // only leaders create the bucket
  var ev = insert_(TABS.EPICS, { id: uuid_(), name: 'Sunday School', type: '', event_date: date, status: '', notes: '', program: "Children's Ministry", archived: '' });
  return ev.id;
}

// Mark a Sunday School bucket as "no class this week" (calendar hides that Sunday's row).
function setSundayNoSchool(token, id, on) {
  requireLeader_(token);
  return updateRow_(TABS.EPICS, id, { status: on ? 'No School' : '' });
}
function callGemini_(prompt, temperature) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('AI is not configured — set GEMINI_API_KEY in Script Properties.');
  var model = props.getProperty('GEMINI_MODEL') || 'gemini-flash-latest';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: (temperature == null ? 0.4 : temperature), responseMimeType: 'application/json' } }),
  });
  var body = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('AI error: ' + String((body.error && body.error.message) || res.getContentText()).slice(0, 200));
  var text = body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts[0].text;
  if (!text) throw new Error('AI returned no content');
  return JSON.parse(text);
}

// Strip years/numbers so "Children's Sunday 2027" and "Children's Sunday 2028" match.
function normalizeName_(n) {
  return String(n || '').toLowerCase().replace(/[0-9]+/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function suggestTasks(token, epicId) {
  requireLeader_(token);
  var epics = readTable_(TABS.EPICS);
  var ev = epics.find(function (e) { return String(e.id) === String(epicId); });
  if (!ev) throw new Error('Event not found');
  var base = normalizeName_(ev.name);
  var tasks = readTable_(TABS.TASKS);
  var history = epics
    .filter(function (e) { return String(e.id) !== String(epicId) && (normalizeName_(e.name) === base || (ev.program && e.program === ev.program)); })
    .map(function (e) {
      var ts = tasks.filter(function (t) { return String(t.epic_id) === String(e.id); });
      return { event: e.name, program: e.program, tasks: ts.map(function (t) { return { title: t.title, owner: t.owner, due_offset: t.due_offset, priority: t.priority, notes: t.notes }; }) };
    })
    .filter(function (h) { return h.tasks.length; });
  if (!history.length) throw new Error('No past events with tasks to learn from for "' + ev.name + '" yet.');
  var prompt = 'You help a children\'s ministry plan events. Using the task lists from PAST similar events below, propose the task list for the NEW event. '
    + 'Return ONLY JSON: {"tasks":[{"title":"...","owner":"","due_offset":"-6w","priority":"Medium","notes":""}]}. '
    + 'Rules: base tasks on what RECURRED across past events; due_offset is relative to event day (e.g. "-6w","-3d"); set owner to a name that recurs for that task or "" if unclear; add anything usually needed that is missing; keep titles concise.\n'
    + 'NEW EVENT: ' + JSON.stringify({ name: ev.name, program: ev.program, notes: ev.notes }) + '\n'
    + 'PAST EVENTS: ' + JSON.stringify(history);
  return callGemini_(prompt);
}

/* =========================== Ask Dorothy (admin-only) ======================
 * Natural-language Q&A over LOGISTICS ONLY. The context is built to contain NO
 * child personal information — the Children and Attendance PII tabs are never read
 * here, so nothing about a child can reach the model. Data leaving to Gemini is
 * limited to events, tasks, adult members/assignments, lesson pointers, and
 * aggregate offertory totals.
 * ========================================================================== */
function askDorothy(token, question, history) {
  var me = requireMember_(token);
  if (me.role !== 'admin') throw new Error('NOT_ALLOWED'); // phase 1: admin only
  question = String(question || '').trim();
  if (!question) throw new Error('Ask a question');
  var ctx = dorothyContext_();
  var convo = (history && history.length)
    ? 'RECENT CONVERSATION (oldest first, for context):\n' + history.slice(-6).map(function (m) { return (m.role === 'user' ? 'User: ' : 'Dorothy: ') + String(m.text || '').slice(0, 300); }).join('\n') + '\n\n'
    : '';
  var prompt = "You are Dorothy, a warm, concise assistant for the leaders of a children's ministry. "
    + "Answer the QUESTION using ONLY the DATA provided.\n"
    + "OUTPUT RULES — follow exactly:\n"
    + "- Give ONLY the final answer. Do NOT show your reasoning or thinking. Never write 'let me check', 'wait', 'actually', or correct yourself mid-answer.\n"
    + "- Be brief. Use short lines starting with '- ' for lists. No preamble like 'Here are'.\n"
    + "- Relative dates ('next month', 'this week', 'upcoming') are computed from TODAY = " + fmtDate_(new Date()) + " (dates are ISO YYYY-MM-DD). List matching events sorted by date. If none match, reply in ONE short sentence that there are none in the data.\n"
    + "- Offertory: 'offertoryRecentSundays' is per-Sunday totals (newest first, in $), 'offertoryByYear' is per-class yearly totals. If the exact week/period asked has no entry, give the MOST RECENT recorded Sunday's offertory with its date instead of saying you have nothing.\n"
    + "- If the DATA doesn't contain the answer, say so in one sentence — don't guess.\n"
    + "- Never claim you changed anything. For any create/edit, PROPOSE it: set 'answer' to a one-line confirmation question that names the task, and include an 'action' object. Wait for the user to confirm.\n"
    + "- CREATE/ADD a task: action {\"type\":\"create_task\",\"title\":\"...\",\"owner\":\"\",\"due\":\"\",\"event\":\"\"}. 'event' = best-matching event name from DATA (or ''). 'owner' = a member name if named, else ''. 'due' = ISO date or ''.\n"
    + "- EDIT/ASSIGN/RESCHEDULE/COMPLETE an existing task: action {\"type\":\"update_task\",\"id\":\"<exact id from a DATA task>\",\"taskTitle\":\"<that task's current title>\",\"changes\":{\"owner\":\"\",\"status\":\"\",\"due\":\"\",\"title\":\"\",\"priority\":\"\"}}. Include ONLY the fields being changed; use the exact 'id' from DATA. status is one of Pending / In Progress / Completed. If you can't tell which task is meant, ASK which one — do not guess. Only live tasks have an id; history items can't be edited.\n"
    + "- These two are the ONLY changes you can make. For anything else (delete, send messages, etc.) say you can't do that yet.\n"
    + "PRIVACY: this data intentionally contains NO child personal information. Never invent or infer any child's name, birthday, contact, or allergy; if asked for a child's personal details, say that information isn't available here for privacy.\n"
    + 'Return ONLY JSON: {"answer":"...","action":<the action object or null>}. answer is the final plain text (use \\n for line breaks); include "action" ONLY when proposing a task, otherwise set it to null.\n'
    + convo + "DATA: " + JSON.stringify(ctx) + "\nQUESTION: " + question;
  return callGemini_(prompt, 0.2); // low temperature for factual answers -> { answer, action }
}

// Execute a Dorothy-proposed action after the admin confirms in the UI. Task creation only.
function dorothyAct(token, action) {
  var me = requireMember_(token);
  if (me.role !== 'admin') throw new Error('NOT_ALLOWED');
  action = action || {};

  if (action.type === 'update_task') {
    var uid = String(action.id || '').trim();
    if (!uid) throw new Error('I could not tell which task to change — please say which one.');
    var t = readTable_(TABS.TASKS).find(function (x) { return String(x.id) === uid; });
    if (!t) throw new Error('That task no longer exists.');
    var ch = action.changes || {}, patch = {};
    if (ch.owner !== undefined && ch.owner !== '') patch.owner = String(ch.owner).trim();
    if (ch.title) patch.title = String(ch.title).trim();
    if (ch.priority) patch.priority = String(ch.priority).trim();
    if (ch.due !== undefined && ch.due !== '') patch.due_date = fmtDate_(ch.due);
    if (ch.status) { var st = canonStatus_(ch.status); if (st) patch.status = st; }
    if (!Object.keys(patch).length) throw new Error('No changes were specified.');
    updateRow_(TABS.TASKS, uid, patch);
    return { ok: true, message: 'Updated "' + (patch.title || t.title) + '"' + (patch.owner ? ' → ' + patch.owner : '') + (patch.status ? ' [' + patch.status + ']' : '') + (patch.due_date ? ' due ' + patch.due_date : '') + '.' };
  }

  if (action.type !== 'create_task') throw new Error('Unsupported action');
  var title = String(action.title || '').trim();
  if (!title) throw new Error('No task title');
  var epics = readTable_(TABS.EPICS);
  var want = String(action.event || '').trim().toLowerCase();
  var ev = null;
  if (want) {
    ev = epics.find(function (e) { return String(e.name).trim().toLowerCase() === want; })
      || epics.find(function (e) { var n = String(e.name).trim().toLowerCase(); return n.indexOf(want) >= 0 || want.indexOf(n) >= 0; });
  }
  if (!ev) { // fall back to the general planning bucket (create if missing)
    ev = epics.find(function (e) { return String(e.name).trim().toLowerCase() === 'sunday school planning'; });
    if (!ev) { var id = uuid_(); insert_(TABS.EPICS, { id: id, name: 'Sunday School Planning', type: '', event_date: '', status: '', notes: '', program: "Children's Ministry", archived: '', no_school: '' }); ev = { id: id, name: 'Sunday School Planning' }; }
  }
  var owner = String(action.owner || '').trim();
  var due = fmtDate_(action.due || '');
  insert_(TABS.TASKS, { id: uuid_(), epic_id: ev.id, title: title, owner: owner, due_offset: '', due_date: due, status: 'Pending', priority: 'Medium', notes: 'Added via Ask Dorothy' });
  return { ok: true, message: 'Created "' + title + '"' + (owner ? ' for ' + owner : '') + ' under ' + ev.name + (due ? ' (due ' + due + ')' : '') + '.' };
}

function canonStatus_(s) {
  s = String(s || '').trim().toLowerCase();
  if (/complet|done|finish|closed/.test(s)) return 'Completed';
  if (/progress|wip|ongoing|started/.test(s)) return 'In Progress';
  if (/pending|todo|to do|open|not\s*start/.test(s)) return 'Pending';
  return '';
}

// Recent per-Sunday offertory (total + per-class), newest first, last N Sundays.
function recentOffertory_(limit) {
  limit = limit || 20;
  var byDate = {};
  readTable_(TABS.WEEKLY).forEach(function (r) {
    var amt = Number(r.offertory) || 0; if (!amt) return;
    var d = fmtDate_(r.date); if (!d) return;
    byDate[d] = byDate[d] || { total: 0 };
    var cls = String(r.class || '').trim() || '?';
    byDate[d][cls] = (byDate[d][cls] || 0) + amt; byDate[d].total += amt;
  });
  var out = {};
  Object.keys(byDate).sort().reverse().slice(0, limit).forEach(function (d) { out[d] = byDate[d]; });
  return out;
}

// Aggregate offertory per class per academic year (no per-Sunday or per-child detail).
function offertoryRollup_() {
  var out = {};
  readTable_(TABS.WEEKLY).forEach(function (r) {
    var amt = Number(r.offertory) || 0; if (!amt) return;
    var m = fmtDate_(r.date).match(/^(\d{4})-(\d{2})/); if (!m) return;
    var y = +m[1], mo = +m[2], ay = (mo >= 7) ? y : y - 1, label = ay + '-' + String(ay + 1).slice(2);
    var cls = String(r.class || '').trim() || '?';
    out[label] = out[label] || {}; out[label][cls] = (out[label][cls] || 0) + amt;
  });
  return out;
}

// PII-SAFE snapshot. NEVER reads TABS.CHILDREN or TABS.ATTENDANCE.
function dorothyContext_() {
  var epics = readTable_(TABS.EPICS);
  var byId = {}; epics.forEach(function (e) { byId[e.id] = e; });
  function trim(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) : s; }
  return {
    today: fmtDate_(new Date()),
    events: epics.filter(function (e) { return !/^action items /i.test(String(e.name || '')); }).map(function (e) {
      return { name: e.name, date: fmtDate_(e.event_date), program: e.program, status: e.status,
        no_school: String(e.no_school || '') === 'yes' ? true : undefined,
        archived: String(e.archived || '').trim() ? true : undefined };
    }),
    tasks: readTable_(TABS.TASKS).map(function (t) {
      var ev = byId[t.epic_id], evName = (ev && ev.name) || '', hist = /^action items /i.test(evName);
      var o = { title: trim(t.title, 140), owner: t.owner || '', status: t.status, event: evName };
      if (!hist) { o.id = t.id; o.due = fmtDate_(t.due_date) || t.due_offset || ''; o.notes = trim(t.notes, 120); } // id only on live tasks (editable)
      return o;
    }),
    members: readTable_(TABS.MEMBERS).map(function (m) { return { name: m.name, role: m.role, class: m['class'] || '' }; }),
    assignments: readTable_(TABS.ASSIGNMENTS).map(function (a) { return { name: a.name, class: a['class'], role: a.role, semester: a.semester }; }),
    lessons: readTable_(TABS.LESSONS).map(function (l) { return { class: l['class'], next_lesson: l.next_lesson, unit: unitOf_(l.next_lesson) }; }),
    offertoryByYear: offertoryRollup_(),
    offertoryRecentSundays: recentOffertory_(20), // date -> {total, <class>:amt}, newest first
  };
}
function addSuggestedTasks(token, epicId, tasks) {
  requireLeader_(token);
  var n = 0;
  (tasks || []).forEach(function (t) {
    if (!String(t.title || '').trim()) return;
    insert_(TABS.TASKS, { id: uuid_(), epic_id: epicId, title: String(t.title).trim(), owner: t.owner || '', due_offset: String(t.due_offset || '').trim(), due_date: '', status: 'Pending', priority: t.priority || 'Medium', notes: t.notes || '' });
    n++;
  });
  return { added: n };
}

// Extract action items from pasted meeting notes (e.g. Zoom AI notes) and route
// each to the most relevant event. Only logistics text is sent to Gemini.
function extractTasksFromNotes(token, notes) {
  requireLeader_(token);
  notes = String(notes || '').trim();
  if (!notes) throw new Error('Paste the meeting notes first.');
  if (notes.length > 20000) notes = notes.slice(0, 20000);
  var eventNames = readTable_(TABS.EPICS).filter(function (e) { return String(e.archived || '').trim() === ''; }).map(function (e) { return e.name; });
  var today = fmtDate_(new Date());
  var prompt = 'Today is ' + today + '. Extract concrete ACTION ITEMS (tasks) from these children\'s ministry meeting notes. '
    + 'Return ONLY JSON: {"tasks":[{"title":"","owner":"","due":"","event":"","notes":""}]}. '
    + 'Rules: title = a short imperative task; owner = a person\'s name only if the notes assign one, else ""; '
    + 'due = an absolute date "YYYY-MM-DD" if the notes state or imply a deadline (resolve "next Thursday", "by end of month", "before Sunday" using today\'s date), else ""; '
    + 'event = the single most relevant event name from the list (exact match) or "General" if none fits; '
    + 'notes = any useful detail. Ignore general discussion that is not an action.\n'
    + 'EVENTS: ' + JSON.stringify(eventNames) + '\n\nMEETING NOTES:\n' + notes;
  return callGemini_(prompt);
}

// Add tasks that each carry an "event" name; route to that event (or the Planning bucket).
function addRoutedTasks(token, tasks) {
  requireLeader_(token);
  var epics = readTable_(TABS.EPICS);
  function eid(name) {
    var n = String(name || '').trim().toLowerCase();
    if (!n || n === 'general') { var g = epics.find(function (e) { return String(e.name).toLowerCase().indexOf('planning') >= 0; }); return g ? g.id : ''; }
    var e = epics.find(function (x) { return String(x.name).trim().toLowerCase() === n; });
    if (e) return e.id;
    var g2 = epics.find(function (x) { return String(x.name).toLowerCase().indexOf('planning') >= 0; });
    return g2 ? g2.id : '';
  }
  var added = 0;
  (tasks || []).forEach(function (t) {
    if (!String(t.title || '').trim()) return;
    insert_(TABS.TASKS, { id: uuid_(), epic_id: eid(t.event), title: String(t.title).trim(), owner: t.owner || '', due_offset: '', due_date: fmtDate_(t.due || ''), status: 'Pending', priority: 'Medium', notes: t.notes || '' });
    added++;
  });
  return { added: added };
}

// Archive / unarchive an event (leaders). Archived events drop out of the
// active list but stay intact for cloning next year.
function setEventArchived(token, id, archived) {
  requireLeader_(token);
  return updateRow_(TABS.EPICS, id, { archived: archived ? 'yes' : '' });
}

// Leaders: archive every event that's complete (all tasks done, or no tasks + date passed).
function tidyCompleted(token) {
  requireLeader_(token);
  return archiveCompleted();
}

function deleteEpic(token, id) {
  requireLeader_(token);
  // cascade: remove tasks, budget and feedback for this epic
  [TABS.TASKS, TABS.BUDGET, TABS.FEEDBACK].forEach(tab => {
    readTable_(tab).filter(r => String(r.epic_id) === String(id)).forEach(r => deleteRow_(tab, r.id));
  });
  return deleteRow_(TABS.EPICS, id);
}

/* ------------------------------------------------------------- write: tasks */

function saveTask(token, data) {
  const me = requireMember_(token);
  const leader = LEADERS.indexOf(me.role) >= 0;

  // Create (leaders only): full record required.
  if (!data.id) {
    if (!leader) throw new Error('NOT_ALLOWED');
    var off0 = String(data.due_offset || '').trim();
    const clean = {
      id: uuid_(),
      epic_id: data.epic_id || '',
      title: String(data.title || '').trim(),
      owner: data.owner || '',
      due_offset: off0,
      due_date: off0 ? '' : fmtDate_(data.due_date || ''), // absolute date when no offset
      status: data.status || 'Pending',
      priority: data.priority || 'Medium',
      notes: data.notes || '',
    };
    if (!clean.title) throw new Error('Task title is required');
    if (!clean.epic_id) throw new Error('Task must belong to an epic');
    return insert_(TABS.TASKS, clean);
  }

  // Update: merge only the provided fields over the existing row.
  const existing = readTable_(TABS.TASKS).find(t => String(t.id) === String(data.id));
  if (!existing) throw new Error('Task not found');

  if (!leader) {
    // doers + board rep may only touch status / notes on their OWN task
    if ((DOERS.indexOf(me.role) < 0 && OBSERVERS.indexOf(me.role) < 0) || String(existing.owner) !== me.name) throw new Error('NOT_ALLOWED');
    return updateRow_(TABS.TASKS, data.id, {
      status: data.status !== undefined ? data.status : existing.status,
      notes: data.notes !== undefined ? data.notes : existing.notes,
    });
  }

  const patch = {};
  ['epic_id', 'title', 'owner', 'status', 'priority', 'notes'].forEach(k => {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  if (patch.title !== undefined && !String(patch.title).trim()) throw new Error('Task title is required');
  // Date: an offset (relative to a dated event) OR an absolute date — offset wins.
  if (data.due_offset !== undefined || data.due_date !== undefined) {
    var off = String((data.due_offset !== undefined ? data.due_offset : existing.due_offset) || '').trim();
    patch.due_offset = off;
    patch.due_date = off ? '' : fmtDate_((data.due_date !== undefined ? data.due_date : existing.due_date) || '');
  }
  return updateRow_(TABS.TASKS, data.id, patch);
}

function deleteTask(token, id) {
  requireLeader_(token);
  return deleteRow_(TABS.TASKS, id);
}

/* ---------------------------------------------------------- clone last year */

function cloneEpic(token, sourceId, newName, newEventDate) {
  requireLeader_(token);
  const source = readTable_(TABS.EPICS).find(e => String(e.id) === String(sourceId));
  if (!source) throw new Error('Source epic not found');

  const newEpic = insert_(TABS.EPICS, {
    id: uuid_(),
    name: String(newName || (source.name + ' (copy)')).trim(),
    program: source.program || '',
    type: source.type,
    event_date: fmtDate_(newEventDate) || '',
    status: 'Planning',
    notes: source.notes || '',
    archived: '',
  });

  // copy tasks: keep offset (relative dates re-compute), reset status
  readTable_(TABS.TASKS)
    .filter(t => String(t.epic_id) === String(sourceId))
    .forEach(t => {
      insert_(TABS.TASKS, {
        id: uuid_(),
        epic_id: newEpic.id,
        title: t.title,
        owner: t.owner,
        due_offset: t.due_offset,
        due_date: '',
        status: 'Pending',
        priority: t.priority,
        notes: t.notes,
      });
    });

  return newEpic;
}

/* -------------------------------------------------------------- members (admin) */

function saveMember(token, data) {
  requireAdmin_(token);
  const email = String(data.email || '').trim().toLowerCase();
  const role = String(data.role || '').trim();
  if (!email) throw new Error('Email is required');
  if (ROLES.indexOf(role) < 0) throw new Error('Invalid role');
  const existing = readTable_(TABS.MEMBERS).find(m => String(m.email).trim().toLowerCase() === email);
  const clean = {
    email: email,
    name: String(data.name || '').trim() || email,
    role: role,
    token: (existing && existing.token) ? existing.token : shortToken_(), // stable per member
    class: (data['class'] !== undefined) ? String(data['class'] || '').trim()
         : (existing ? String(existing['class'] || '').trim() : ''),
  };
  const saved = existing ? updateRow_(TABS.MEMBERS, existing.email, clean) : insert_(TABS.MEMBERS, clean);
  return Object.assign({}, saved, { link: inviteLink_(saved.token) });
}

function deleteMember(token, email) {
  const me = requireAdmin_(token);
  if (String(email).trim().toLowerCase() === me.email) throw new Error("You can't remove yourself");
  return deleteRow_(TABS.MEMBERS, String(email).trim().toLowerCase());
}

/** Rotate a member's invite link (old link stops working). Admin only. */
function regenerateInvite(token, email) {
  requireAdmin_(token);
  const e = String(email || '').trim().toLowerCase();
  const existing = readTable_(TABS.MEMBERS).find(m => String(m.email).trim().toLowerCase() === e);
  if (!existing) throw new Error('Member not found');
  const nt = shortToken_();
  updateRow_(TABS.MEMBERS, existing.email, { token: nt });
  return { email: e, token: nt, link: inviteLink_(nt) };
}

/* ------------------------------------------------------------- budget (treasurer) */

function saveBudget(token, data) {
  const me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && me.role !== 'treasurer') throw new Error('NOT_ALLOWED');
  // Update: patch only provided fields (so a reimbursed-toggle won't wipe the row).
  if (data.id) {
    var patch = {};
    ['epic_id', 'item', 'category', 'amount', 'status', 'notes', 'date', 'paid_by', 'reimbursed', 'receipt_url', 'budget_category'].forEach(function (k) {
      if (data[k] !== undefined) patch[k] = (k === 'amount') ? (Number(data[k]) || 0) : data[k];
    });
    if (patch.item !== undefined && !String(patch.item).trim()) throw new Error('Item is required');
    return updateRow_(TABS.BUDGET, data.id, patch);
  }
  const clean = {
    id: uuid_(),
    epic_id: data.epic_id || '', item: String(data.item || '').trim(),
    category: data.category || 'expense', amount: Number(data.amount) || 0,
    status: data.status || '', notes: data.notes || '',
    date: data.date || '', paid_by: data.paid_by || '',
    reimbursed: data.reimbursed || 'No', receipt_url: data.receipt_url || '',
    budget_category: data.budget_category || '',
  };
  if (!clean.item) throw new Error('Item is required');
  return insert_(TABS.BUDGET, clean);
}

/* budget PLAN (per-financial-year category allocations) */
function saveBudgetLine(token, data) {
  const me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && me.role !== 'treasurer') throw new Error('NOT_ALLOWED');
  var cat = String(data.category || '').trim();
  var fy = String(data.fy || '').trim();
  if (!cat) throw new Error('Category is required');
  if (!/^\d{4}$/.test(fy)) throw new Error('Financial year (YYYY) is required');
  var patch = { fy: fy, category: cat, amount: Number(data.amount) || 0, notes: data.notes || '' };
  if (data.id) return updateRow_(TABS.BUDGETPLAN, data.id, patch);
  patch.id = uuid_();
  return insert_(TABS.BUDGETPLAN, patch);
}
function deleteBudgetLine(token, id) {
  const me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && me.role !== 'treasurer') throw new Error('NOT_ALLOWED');
  return deleteRow_(TABS.BUDGETPLAN, id);
}
function deleteBudget(token, id) {
  const me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && me.role !== 'treasurer') throw new Error('NOT_ALLOWED');
  return deleteRow_(TABS.BUDGET, id);
}

/** Upload an expense receipt to a Drive folder next to the backend sheet; returns a view link. */
function saveReceipt(token, dataUrl, filename) {
  var me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && me.role !== 'treasurer') throw new Error('NOT_ALLOWED');
  var m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Could not read the file');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], filename || 'receipt');
  var file = receiptsFolder_().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { url: file.getUrl(), id: file.getId(), name: file.getName() };
}
function receiptsFolder_() {
  var props = PropertiesService.getScriptProperties();
  // Preferred: a receipts folder the user created manually — use it directly.
  var rid = props.getProperty('RECEIPTS_FOLDER_ID');
  if (rid) return DriveApp.getFolderById(rid);
  // Fallback: create/find a "receipts" subfolder under the app folder (or root).
  var parent;
  try {
    var pid = props.getProperty('APP_FOLDER_ID');
    if (pid) { parent = DriveApp.getFolderById(pid); }
    else {
      var it = DriveApp.getFileById(props.getProperty('SPREADSHEET_ID')).getParents();
      parent = it.hasNext() ? it.next() : DriveApp.getRootFolder();
    }
  } catch (e) { parent = DriveApp.getRootFolder(); }
  var fs = parent.getFoldersByName('receipts');
  return fs.hasNext() ? fs.next() : parent.createFolder('receipts');
}

/* ---- media (photos/videos) — stored privately in Drive; bytes served only to authorized users ---- */
function mediaParent_() {
  var props = PropertiesService.getScriptProperties();
  try {
    var pid = props.getProperty('APP_FOLDER_ID');
    if (pid) return DriveApp.getFolderById(pid);
    var it = DriveApp.getFileById(props.getProperty('SPREADSHEET_ID')).getParents();
    return it.hasNext() ? it.next() : DriveApp.getRootFolder();
  } catch (e) { return DriveApp.getRootFolder(); }
}
function subFolder_(parent, name) {
  name = String(name || '').replace(/[\/\\]+/g, '-').trim() || 'unnamed';
  var fs = parent.getFoldersByName(name);
  return fs.hasNext() ? fs.next() : parent.createFolder(name);
}
function mediaFolder_(parts) { var f = subFolder_(mediaParent_(), 'CM Media'); (parts || []).forEach(function (p) { f = subFolder_(f, p); }); return f; }
function blobFromDataUrl_(dataUrl, filename) {
  var m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Could not read the file');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], filename || 'file');
}
function fileToMedia_(file) {
  var b = file.getBlob();
  return { id: file.getId(), name: file.getName(), type: b.getContentType(), dataUrl: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
}

// This Sunday per-class photos. Edit = leader OR the class's own teacher/co-teacher; View = any leader/teacher.
function canEditClassMedia_(me, cls) {
  if (LEADERS.indexOf(me.role) >= 0) return true;
  return DOERS.indexOf(me.role) >= 0 && String(me.class || '').trim().toLowerCase() === String(cls || '').trim().toLowerCase();
}
function uploadSundayPhoto(token, date, cls, dataUrl, filename) {
  var me = requireMember_(token);
  if (!canEditClassMedia_(me, cls)) throw new Error('NOT_ALLOWED');
  var f = mediaFolder_(['Sundays', fmtDate_(date), cls]).createFile(blobFromDataUrl_(dataUrl, filename)); // private
  return { id: f.getId(), name: f.getName() };
}
function getSundayPhotos(token, date, cls) {
  var me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && DOERS.indexOf(me.role) < 0) throw new Error('NOT_ALLOWED');
  var f = mediaFolder_(['Sundays', fmtDate_(date), cls]), it = f.getFiles(), out = [], n = 0;
  while (it.hasNext() && n < 60) { out.push(fileToMedia_(it.next())); n++; }
  return out;
}
function deleteSundayPhoto(token, date, cls, fileId) {
  var me = requireMember_(token);
  if (!canEditClassMedia_(me, cls)) throw new Error('NOT_ALLOWED');
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  return { ok: true };
}

// Per-event media (Photos + Videos). Edit + view = leaders + teachers/co-teachers.
function eventById_(id) { return readTable_(TABS.EPICS).find(function (e) { return String(e.id) === String(id); }); }
function eventFolder_(ev, kind) { return mediaFolder_(['Events', String(ev.name || 'event').slice(0, 80) + ' #' + String(ev.id).slice(-6), (kind === 'Videos' ? 'Videos' : 'Photos')]); }
function canUseEventMedia_(me) { return LEADERS.indexOf(me.role) >= 0 || DOERS.indexOf(me.role) >= 0; }
function getEventMedia(token, eventId) {
  var me = requireMember_(token); if (!canUseEventMedia_(me)) throw new Error('NOT_ALLOWED');
  var ev = eventById_(eventId); if (!ev) throw new Error('Event not found');
  var photos = [], videos = [], it, n;
  it = eventFolder_(ev, 'Photos').getFiles(); n = 0; while (it.hasNext() && n < 80) { photos.push(fileToMedia_(it.next())); n++; }
  it = eventFolder_(ev, 'Videos').getFiles(); n = 0; while (it.hasNext() && n < 80) { var f = it.next(); videos.push({ id: f.getId(), name: f.getName(), size: f.getSize() }); n++; } // metadata only; fetch on click
  return { photos: photos, videos: videos };
}
function getMediaFile(token, fileId) {
  var me = requireMember_(token); if (!canUseEventMedia_(me)) throw new Error('NOT_ALLOWED');
  return fileToMedia_(DriveApp.getFileById(fileId));
}
function uploadEventMedia(token, eventId, dataUrl, filename, kind) {
  var me = requireMember_(token); if (!canUseEventMedia_(me)) throw new Error('NOT_ALLOWED');
  var ev = eventById_(eventId); if (!ev) throw new Error('Event not found');
  var f = eventFolder_(ev, kind).createFile(blobFromDataUrl_(dataUrl, filename));
  return { id: f.getId(), name: f.getName() };
}
function deleteEventMedia(token, eventId, fileId) {
  var me = requireMember_(token); if (!canUseEventMedia_(me)) throw new Error('NOT_ALLOWED');
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  return { ok: true };
}

// AI flyer copy from event logistics only (no PII) -> the client renders it into a template.
var DEFAULT_FLYER_PROMPT = "Write the COPY for an Austin Christian Fellowship of India (ACFI) Children's Ministry event flyer. "
  + "Every flyer must clearly answer WHAT (the event and why to come), WHEN (date and time), and WHERE (venue).\n"
  + "Rules:\n"
  + "- title: punchy, max 6 words, names the event.\n"
  + "- subtitle: one short line on what it is / who it's for.\n"
  + "- dateline (the WHEN): spell the month and include the year; add the time ONLY if it is in the notes; never invent a time.\n"
  + "- location (the WHERE): the venue named in the notes; if none is given, use \"Austin Christian Fellowship of India\". Never leave it blank.\n"
  + "- highlights: 3-4 short phrases covering WHAT to expect — activities, purpose, or what to bring.\n"
  + "- speaker + org: only if the notes name a guest speaker; never describe their appearance; otherwise \"\".\n"
  + "- cta: short call to action (e.g. 'All families welcome').\n"
  + "Tone: warm, family-friendly, faith-centered. Do NOT invent any fact, venue, time, or speaker. No image descriptions.";
function makeFlyer(token, eventId, extra) {
  requireLeader_(token);
  var ev = eventById_(eventId); if (!ev) throw new Error('Event not found');
  // Editable without code: set Script Property FLYER_PROMPT to change tone/rules. The JSON
  // schema line below is always appended in code so the response stays parseable.
  var guide = PropertiesService.getScriptProperties().getProperty('FLYER_PROMPT') || DEFAULT_FLYER_PROMPT;
  var prompt = guide + '\n'
    + 'Return ONLY JSON with these keys: {"title":"","subtitle":"","dateline":"","location":"","speaker":"","org":"","highlights":["",""],"cta":""}.\n'
    + 'EVENT: ' + JSON.stringify({ name: ev.name, date: fmtDate_(ev.event_date), program: ev.program, notes: ev.notes })
    + (extra ? ('\nEXTRA INSTRUCTIONS: ' + String(extra).slice(0, 300)) : '');
  var f = callGemini_(prompt, 0.6);
  f.banner = flyerBannerDataUrl_(); // embed so the client can export a clean PNG (no CORS taint)
  return f;
}
function flyerBannerDataUrl_() {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('FLYER_BANNER_DATA'); if (cached) return cached;
  try {
    var res = UrlFetchApp.fetch('https://www.acfi.cc/wp-content/uploads/2018/08/ACFI_Banner2.png', { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) { var b = res.getBlob(); var d = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()); props.setProperty('FLYER_BANNER_DATA', d); return d; }
  } catch (e) {}
  return '';
}
function saveFeedback(token, data) {
  requireMember_(token);
  const clean = {
    epic_id: data.epic_id || '',
    text: String(data.text || '').trim(),
    converted: data.converted ? 'yes' : '',
    converted_task_id: data.converted_task_id || '',
  };
  if (!clean.text) throw new Error('Feedback text is required');
  if (data.id) return updateRow_(TABS.FEEDBACK, data.id, clean);
  clean.id = uuid_();
  return insert_(TABS.FEEDBACK, clean);
}

function deleteFeedback(token, id) {
  requireLeader_(token);
  return deleteRow_(TABS.FEEDBACK, id);
}

/** Turn a feedback item into a task on the target epic (carry-forward). */
function convertFeedbackToTask(token, feedbackId, targetEpicId, dueOffset, owner) {
  requireLeader_(token);
  const fb = readTable_(TABS.FEEDBACK).find(f => String(f.id) === String(feedbackId));
  if (!fb) throw new Error('Feedback not found');
  const task = insert_(TABS.TASKS, {
    id: uuid_(),
    epic_id: targetEpicId || fb.epic_id,
    title: fb.text,
    owner: owner || '',
    due_offset: dueOffset || '',
    due_date: '',
    status: 'Pending',
    priority: 'Medium',
    notes: 'Carried forward from feedback',
  });
  updateRow_(TABS.FEEDBACK, feedbackId, { converted: 'yes', converted_task_id: task.id });
  return task;
}

/* --------------------------------------------------------- children (PII) */
// Read is role- and class-scoped. Doers (teachers/co-teachers) get ONLY their
// class's children and ONLY the doer-allowed fields — parent contact, DOB, and
// language are stripped server-side so they never reach a teacher's browser.

function getChildren(token) {
  var me = requireMember_(token);
  var leader = LEADERS.indexOf(me.role) >= 0;
  var doer = DOERS.indexOf(me.role) >= 0;
  var observer = OBSERVERS.indexOf(me.role) >= 0; // board rep: roster overview, no PII
  if (!leader && !doer && !observer) throw new Error('NOT_ALLOWED'); // treasurer: no access
  var fields = leader ? SCHEMA.Children : (doer ? CHILD_DOER_FIELDS : CHILD_BOARD_FIELDS);
  var rows = readTable_(TABS.CHILDREN);
  if (doer) {
    var myClass = String(me.class || '').trim().toLowerCase();
    rows = rows.filter(function (c) { return String(c.class || '').trim().toLowerCase() === myClass && myClass !== ''; });
  }
  // Sanitize every value to a plain string (Date -> yyyy-MM-dd). Returning raw Date
  // objects makes google.script.run drop the whole payload — the client gets null.
  return rows.map(function (c) {
    var o = {};
    fields.forEach(function (f) {
      var v = c[f];
      o[f] = (v instanceof Date) ? fmtDate_(v) : (v === null || v === undefined ? '' : String(v));
    });
    return o;
  });
}

function saveChild(token, data) {
  requireLeader_(token); // only admin / co-leader may add or edit child records
  var clean = {};
  SCHEMA.Children.forEach(function (f) { if (f !== 'id') clean[f] = (data[f] !== undefined) ? data[f] : ''; });
  clean.name = String(clean.name || '').trim();
  if (!clean.name) throw new Error("Child's name is required");
  if (data.id) return updateRow_(TABS.CHILDREN, data.id, clean);
  clean.id = uuid_();
  return insert_(TABS.CHILDREN, clean);
}

function deleteChild(token, id) {
  requireLeader_(token);
  return deleteRow_(TABS.CHILDREN, id);
}

/**
 * Run once from the editor after bulk-pasting children (leaving column A blank):
 * assigns a UUID to every row that has a name but no id, so the app can read them.
 */
// Children's birthdays mapped into an academic year (Jul–Jun). Role-scoped:
// teachers/co-teachers see only their class; leaders see all; observers none.
function getBirthdays(token, ayStart) {
  var me = requireMember_(token);
  var leader = LEADERS.indexOf(me.role) >= 0, doer = DOERS.indexOf(me.role) >= 0;
  if (!leader && !doer) return [];
  var ay = parseInt(ayStart, 10);
  if (!ay) { var n = new Date(); ay = n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1; }
  var kids = readTable_(TABS.CHILDREN);
  if (doer) { var lc = String(me.class || '').trim().toLowerCase(); kids = kids.filter(function (c) { return String(c.class || '').trim().toLowerCase() === lc && lc !== ''; }); }
  var out = [];
  kids.forEach(function (c) {
    var m = fmtDate_(c.dob).match(/^\d{4}-(\d{2})-(\d{2})/);
    if (!m) return;
    var yr = (parseInt(m[1], 10) >= 7) ? ay : ay + 1; // Jul–Dec falls in ay, Jan–Jun in ay+1
    out.push({ date: yr + '-' + m[1] + '-' + m[2], name: String(c.name || ''), class: String(c.class || '') });
  });
  return out;
}
function archiveCompleted() {
  var events = readTable_(TABS.EPICS);
  var tasks = readTable_(TABS.TASKS);
  var byEpic = {};
  tasks.forEach(function (t) { (byEpic[t.epic_id] = byEpic[t.epic_id] || []).push(t); });
  var n = 0;
  events.forEach(function (e) {
    if (String(e.archived || '').trim()) return;
    var ts = byEpic[e.id] || [];
    // Only archive events that had real work and finished it. A no-task event is a
    // calendar marker / awareness item (e.g. Harvest Festival) or imported history —
    // never auto-archive those; the Archive button handles them on purpose.
    if (!ts.length) return;
    if (ts.every(function (t) { return t.status === 'Completed'; })) { updateRow_(TABS.EPICS, e.id, { archived: 'yes' }); n++; }
  });
  return 'Archived ' + n + ' completed event(s).';
}
function deleteWhere_(tab, matchFn) {
  _tblCache = {};
  var sh = sheet_(tab);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  var head = values[0];
  var toDelete = [];
  for (var i = 1; i < values.length; i++) {
    var o = {}; head.forEach(function (h, j) { o[h] = values[i][j]; });
    if (matchFn(o)) toDelete.push(i + 1); // 1-based row number
  }
  toDelete.sort(function (a, b) { return b - a; }).forEach(function (rn) { sh.deleteRow(rn); }); // bottom-up
  return toDelete.length;
}

function childrenInClass_(cls) {
  var c = String(cls || '').trim().toLowerCase();
  return readTable_(TABS.CHILDREN)
    .filter(function (x) { return String(x.class || '').trim().toLowerCase() === c && c !== ''; })
    .map(function (x) { return { id: String(x.id), name: String(x.name) }; });
}

// Teachers see/enter only their class; leaders any class. Returns the class actually used.
function weeklyClass_(me, cls) {
  if (DOERS.indexOf(me.role) >= 0) return String(me.class || '').trim();
  return String(cls || '').trim();
}

/* ---- lesson schedule: 10 lessons per unit; per-class pointer advances on completion ---- */
var LESSON_FALLBACK = 52; // Unit 6, Lesson 52 — current position when no pointer is set yet
function unitOf_(n) { n = Number(n) || 0; return n > 0 ? Math.floor((n - 1) / 10) + 1 : 0; }
function lessonLabel_(n) { n = Number(n) || 0; return n > 0 ? ('Unit ' + unitOf_(n) + ' · Lesson ' + n) : ''; }
function lessonPtrMap_() {
  var m = {}; readTable_(TABS.LESSONS).forEach(function (r) { var c = String(r.class || '').trim(); if (c) m[c.toLowerCase()] = Number(r.next_lesson) || 0; });
  return m;
}
function nextLessonFor_(cls) { var v = lessonPtrMap_()[String(cls || '').trim().toLowerCase()]; return v > 0 ? v : LESSON_FALLBACK; }
function setNextLesson_(cls, n) {
  cls = String(cls || '').trim(); if (!cls) return;
  var ex = readTable_(TABS.LESSONS).find(function (r) { return String(r.class || '').trim().toLowerCase() === cls.toLowerCase(); });
  if (ex) updateRow_(TABS.LESSONS, ex.class, { next_lesson: n }); else insert_(TABS.LESSONS, { class: cls, next_lesson: n });
}
function isNoSchoolDate_(date) {
  var d = fmtDate_(date);
  return readTable_(TABS.EPICS).some(function (e) {
    if (fmtDate_(e.event_date) !== d) return false;
    return String(e.no_school || '') === 'yes' || /no\s+sunday school/i.test(String(e.notes || '')) || /no\s+sunday school/i.test(String(e.name || ''));
  });
}
// No-school applies to every class EXCEPT High School (they meet regardless).
function classOff_(cls, date) { return isNoSchoolDate_(date) && String(cls || '').trim().toLowerCase() !== 'high school'; }

function getWeekly(token, date, cls) {
  var me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && DOERS.indexOf(me.role) < 0) throw new Error('NOT_ALLOWED');
  cls = weeklyClass_(me, cls);
  date = fmtDate_(date);
  var present = readTable_(TABS.ATTENDANCE)
    .filter(function (r) { return fmtDate_(r.date) === date && String(r.class || '').trim().toLowerCase() === cls.toLowerCase(); })
    .map(function (r) { return String(r.child_id); });
  var wl = readTable_(TABS.WEEKLY).find(function (r) { return fmtDate_(r.date) === date && String(r.class || '').trim().toLowerCase() === cls.toLowerCase(); }) || {};
  // Lesson number: a saved row wins (history); otherwise the class's live pointer (next to teach).
  var lessonNo = (wl.lesson_no !== undefined && wl.lesson_no !== '') ? Number(wl.lesson_no) : nextLessonFor_(cls);
  return {
    date: date, class: cls,
    roster: childrenInClass_(cls),
    present: present,
    offertory: (wl.offertory === undefined || wl.offertory === '') ? '' : wl.offertory,
    lesson: wl.lesson || '', notes: wl.notes || '',
    lessonNo: lessonNo, unit: unitOf_(lessonNo), lessonLabel: lessonLabel_(lessonNo),
    lessonDone: String(wl.lesson_done || '') === 'yes',
    noSchool: isNoSchoolDate_(date), classOff: classOff_(cls, date),
    substitute: wl.substitute || '',
    team: teamForClass_(cls),
    announcement: announcementFor_(date),
  };
}

function saveWeekly(token, date, cls, presentIds, offertory, lesson, notes, substitute, lessonNo, lessonDone) {
  var me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && DOERS.indexOf(me.role) < 0) throw new Error('NOT_ALLOWED');
  cls = weeklyClass_(me, cls);
  date = fmtDate_(date);
  if (!date) throw new Error('Pick a date');
  if (!cls) throw new Error('No class set for you — ask an admin to assign your class');
  var lc = cls.toLowerCase();
  // attendance: replace the set for this (date, class)
  deleteWhere_(TABS.ATTENDANCE, function (r) { return fmtDate_(r.date) === date && String(r.class || '').trim().toLowerCase() === lc; });
  var nameById = {}; childrenInClass_(cls).forEach(function (c) { nameById[c.id] = c.name; });
  (presentIds || []).forEach(function (id) {
    insert_(TABS.ATTENDANCE, { id: uuid_(), date: date, class: cls, child_id: String(id), child_name: nameById[String(id)] || '' });
  });
  var lno = (lessonNo === '' || lessonNo == null) ? '' : (Number(lessonNo) || '');
  var done = lessonDone ? 'yes' : '';
  // weekly log: upsert one row per (date, class)
  var clean = {
    date: date, class: cls,
    offertory: (offertory === '' || offertory == null) ? '' : (Number(offertory) || 0),
    lesson: lno ? lessonLabel_(lno) : String(lesson || '').trim(),
    lesson_no: lno, lesson_done: done,
    notes: String(notes || '').trim(),
    substitute: String(substitute || '').trim(),
  };
  var ex = readTable_(TABS.WEEKLY).find(function (r) { return fmtDate_(r.date) === date && String(r.class || '').trim().toLowerCase() === lc; });
  if (ex) { updateRow_(TABS.WEEKLY, ex.id, clean); } else { clean.id = uuid_(); insert_(TABS.WEEKLY, clean); }
  // Advance the class pointer only when a lesson is marked taught and the class actually met.
  if (done === 'yes' && lno && !classOff_(cls, date)) {
    if (Number(lno) + 1 > nextLessonFor_(cls)) setNextLesson_(cls, Number(lno) + 1);
  }
  return { ok: true, present: (presentIds || []).length };
}

function getWeeklyHistory(token, cls, limit) {
  var me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && DOERS.indexOf(me.role) < 0) throw new Error('NOT_ALLOWED');
  cls = weeklyClass_(me, cls);
  var lc = String(cls || '').trim().toLowerCase();
  var countByDate = {};
  readTable_(TABS.ATTENDANCE).forEach(function (r) {
    if (String(r.class || '').trim().toLowerCase() === lc) { var d = fmtDate_(r.date); countByDate[d] = (countByDate[d] || 0) + 1; }
  });
  var wlByDate = {};
  readTable_(TABS.WEEKLY).forEach(function (r) {
    if (String(r.class || '').trim().toLowerCase() === lc) wlByDate[fmtDate_(r.date)] = r;
  });
  var dates = {};
  Object.keys(countByDate).forEach(function (d) { dates[d] = true; });
  Object.keys(wlByDate).forEach(function (d) { dates[d] = true; });
  return Object.keys(dates).sort().reverse().slice(0, limit || 8).map(function (d) {
    var w = wlByDate[d] || {};
    return { date: d, present: countByDate[d] || 0, offertory: (w.offertory === undefined ? '' : w.offertory), lesson: w.lesson || '' };
  });
}

// Leader "All Classes" summary for one Sunday: present/roster/offertory/lesson per class.
function getWeeklyAll(token, date) {
  var me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && DOERS.indexOf(me.role) < 0) throw new Error('NOT_ALLOWED');
  date = fmtDate_(date);
  var att = readTable_(TABS.ATTENDANCE).filter(function (r) { return fmtDate_(r.date) === date; });
  var wl = readTable_(TABS.WEEKLY).filter(function (r) { return fmtDate_(r.date) === date; });
  var rows = CLASSES.map(function (c) {
    var lc = c.toLowerCase();
    var present = att.filter(function (r) { return String(r.class || '').trim().toLowerCase() === lc; }).length;
    var w = wl.find(function (r) { return String(r.class || '').trim().toLowerCase() === lc; }) || {};
    var lessonNo = (w.lesson_no !== undefined && w.lesson_no !== '') ? Number(w.lesson_no) : nextLessonFor_(c);
    return {
      class: c, present: present, roster: childrenInClass_(c).length,
      offertory: (w.offertory === undefined ? '' : w.offertory),
      lesson: lessonLabel_(lessonNo) || w.lesson || '',
      lessonDone: String(w.lesson_done || '') === 'yes', classOff: classOff_(c, date),
    };
  });
  return { rows: rows, announcement: announcementFor_(date) };
}

function announcementFor_(date) {
  var d = fmtDate_(date);
  var a = readTable_(TABS.ANNOUNCEMENTS).find(function (r) { return fmtDate_(r.date) === d; }) || {};
  return { date: d, slides_link: a.slides_link || '', notes: a.notes || '' };
}

// Announcements are an admin/co-leader task. One row per Sunday, keyed by date.
function saveAnnouncement(token, date, slidesLink, notes) {
  requireLeader_(token);
  date = fmtDate_(date);
  if (!date) throw new Error('Pick a date');
  var clean = { date: date, slides_link: String(slidesLink || '').trim(), notes: String(notes || '').trim() };
  var ex = readTable_(TABS.ANNOUNCEMENTS).find(function (r) { return fmtDate_(r.date) === date; });
  if (ex) return updateRow_(TABS.ANNOUNCEMENTS, ex.date, clean);
  return insert_(TABS.ANNOUNCEMENTS, clean);
}

// Offertory rollup: date x class matrix + per-class and grand totals for a
// calendar year. Visible to leaders + treasurer only.
function getOffertory(token, year) {
  var me = requireMember_(token);
  if (LEADERS.indexOf(me.role) < 0 && me.role !== 'treasurer' && OBSERVERS.indexOf(me.role) < 0) throw new Error('NOT_ALLOWED');
  var byDate = {}, yearsSet = {};
  readTable_(TABS.WEEKLY).forEach(function (r) {
    var d = fmtDate_(r.date); if (!d) return;
    var amt = Number(r.offertory) || 0;
    if (!amt) return;
    var canon = CLASSES.filter(function (c) { return c.toLowerCase() === String(r.class || '').trim().toLowerCase(); })[0];
    if (!canon) return; // ignore offertory for an unknown class
    var y = d.slice(0, 4);
    yearsSet[y] = true;
    if (!byDate[d]) byDate[d] = {};
    byDate[d][canon] = (byDate[d][canon] || 0) + amt;
  });
  var years = Object.keys(yearsSet).sort();
  var sel = String(year || '');
  if (years.indexOf(sel) < 0) sel = years.length ? years[years.length - 1] : String(new Date().getFullYear());
  var rows = [], classTotals = {}, grand = 0;
  CLASSES.forEach(function (c) { classTotals[c] = 0; });
  Object.keys(byDate).filter(function (d) { return d.slice(0, 4) === sel; }).sort().reverse().forEach(function (d) {
    var cells = {}, total = 0;
    CLASSES.forEach(function (c) { var v = byDate[d][c] || 0; cells[c] = v; total += v; classTotals[c] += v; });
    grand += total;
    rows.push({ date: d, cells: cells, total: total });
  });
  return { classes: CLASSES, years: years, year: sel, rows: rows, classTotals: classTotals, grandTotal: grand };
}

/* ---------------------------------------------- semester assignments (roster) */
// The assigned teacher/co-teacher team for a class this semester.
function teamForClass_(cls) {
  var cur = currentSemester_(), lc = String(cls || '').trim().toLowerCase();
  var nameByEmail = {};
  readTable_(TABS.MEMBERS).forEach(function (m) { var e = String(m.email || '').trim().toLowerCase(); if (e) nameByEmail[e] = String(m.name || ''); });
  return readTable_(TABS.ASSIGNMENTS)
    .filter(function (x) { return String(x.semester || '').trim() === cur && String(x['class'] || '').trim().toLowerCase() === lc; })
    .map(function (x) { var e = String(x.email || '').trim().toLowerCase(); return { name: (e && nameByEmail[e]) ? nameByEmail[e] : String(x.name || x.email || ''), role: String(x.role || '') }; });
}

function getAssignments(token, semester) {
  requireLeader_(token);
  var all = readTable_(TABS.ASSIGNMENTS);
  var sem = String(semester || '').trim() || currentSemester_();
  var semsSet = {}; all.forEach(function (x) { if (x.semester) semsSet[String(x.semester).trim()] = true; });
  var cur = currentSemester_(); semsSet[cur] = true; semsSet[nextSem_(cur)] = true; semsSet[prevSem_(cur)] = true;
  var sems = Object.keys(semsSet).sort();
  var allMembers = readTable_(TABS.MEMBERS);
  var nameByEmail = {};
  allMembers.forEach(function (m) { var e = String(m.email || '').trim().toLowerCase(); if (e) nameByEmail[e] = String(m.name || ''); });
  var members = allMembers
    .filter(function (m) { return DOERS.indexOf(String(m.role || '').trim()) >= 0; })
    .map(function (m) { return { email: String(m.email || '').trim().toLowerCase(), name: m.name, role: m.role }; });
  return {
    semester: sem, current: cur, classes: CLASSES,
    semesters: sems.map(function (k) { return { key: k, label: semLabel_(k), desc: semDesc_(k) }; }),
    rows: all.filter(function (x) { return String(x.semester).trim() === sem; })
             .map(function (r) { var e = String(r.email || '').trim().toLowerCase(); return { id: r.id, email: r.email, name: (e && nameByEmail[e]) ? nameByEmail[e] : r.name, class: r['class'], role: r.role }; }),
    memberOptions: members,
  };
}

function saveAssignment(token, data) {
  requireLeader_(token);
  var email = String(data.email || '').trim().toLowerCase();
  var cls = String(data['class'] || '').trim();
  var sem = String(data.semester || '').trim() || currentSemester_();
  var role = String(data.role || 'teacher').trim();
  if (!email) throw new Error('Pick a member');
  if (CLASSES.indexOf(cls) < 0) throw new Error('Pick a class');
  var mem = readTable_(TABS.MEMBERS).find(function (m) { return String(m.email || '').trim().toLowerCase() === email; });
  var clean = { email: email, name: mem ? mem.name : email, class: cls, role: role, semester: sem };
  if (data.id) return updateRow_(TABS.ASSIGNMENTS, data.id, clean);
  var dup = readTable_(TABS.ASSIGNMENTS).find(function (x) {
    return String(x.email || '').trim().toLowerCase() === email && String(x['class']).trim() === cls && String(x.semester).trim() === sem;
  });
  if (dup) return dup;
  clean.id = uuid_();
  return insert_(TABS.ASSIGNMENTS, clean);
}

function deleteAssignment(token, id) { requireLeader_(token); return deleteRow_(TABS.ASSIGNMENTS, id); }

/** Copy one semester's assignments into another (skips ones already there). */
function copyAssignments(token, fromSem, toSem) {
  requireLeader_(token);
  var have = {};
  readTable_(TABS.ASSIGNMENTS).filter(function (x) { return String(x.semester).trim() === toSem; })
    .forEach(function (x) { have[String(x.email).toLowerCase() + '|' + x['class']] = true; });
  var n = 0;
  readTable_(TABS.ASSIGNMENTS).filter(function (x) { return String(x.semester).trim() === fromSem; }).forEach(function (x) {
    var k = String(x.email).toLowerCase() + '|' + x['class'];
    if (!have[k]) { insert_(TABS.ASSIGNMENTS, { id: uuid_(), email: x.email, name: x.name, class: x['class'], role: x.role, semester: toSem }); n++; }
  });
  return { copied: n };
}