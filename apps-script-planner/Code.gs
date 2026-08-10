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
};

const SCHEMA = {
  Members:  ['email', 'name', 'role', 'token', 'class'],
  Events:   ['id', 'name', 'type', 'event_date', 'status', 'notes', 'program', 'archived', 'no_school'],
  Tasks:    ['id', 'epic_id', 'title', 'owner', 'due_offset', 'due_date', 'status', 'priority', 'notes'],
  Expenses: ['id', 'epic_id', 'item', 'category', 'amount', 'status', 'notes', 'date', 'paid_by', 'reimbursed', 'receipt_url'],
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

// Identity resolution order:
//  1. Google Sign-In session token (verified email, any account incl. Gmail)
//  2. Invite-link token (fallback during switchover)
//  3. @acfi.cc domain identity (auto)
function resolveMember_(token) {
  var t = String(token || '').trim();
  var m = null;
  if (t) {
    var email = CacheService.getScriptCache().get('sess_' + t);
    if (email) m = memberByEmail_(email);
    if (!m) m = memberByToken_(t);
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
  const feedback = readTable_(TABS.FEEDBACK).map(sanitizeRow_);

  return {
    access: true,
    me: me,
    epics: epics,
    tasks: tasks,
    members: members,
    memberOptions: memberRows.map(m => m.name).filter(Boolean), // for owner dropdowns
    budget: budget,
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

/** Run once: fold every "Sunday School" / "Regular Sunday School" bucket and the
 *  Planning catch-all into a single undated "Sunday School Planning" event. */
function consolidateSundaySchool() {
  var epics = readTable_(TABS.EPICS);
  var tasks = readTable_(TABS.TASKS);
  var target = epics.find(function (e) { return String(e.name).trim().toLowerCase() === 'sunday school planning'; });
  if (!target) {
    var planning = epics.find(function (e) { return String(e.name).toLowerCase().indexOf('planning') >= 0; });
    if (planning) { updateRow_(TABS.EPICS, planning.id, { name: 'Sunday School Planning', event_date: '', program: "Children's Ministry", status: '' }); target = { id: planning.id }; }
    else { var nid = uuid_(); insert_(TABS.EPICS, { id: nid, name: 'Sunday School Planning', type: '', event_date: '', status: '', notes: '', program: "Children's Ministry", archived: '' }); target = { id: nid }; }
  }
  var fold = epics.filter(function (e) {
    var n = String(e.name).trim().toLowerCase();
    return (n === 'sunday school' || n === 'regular sunday school') && String(e.id) !== String(target.id);
  });
  var moved = 0;
  fold.forEach(function (e) {
    tasks.filter(function (t) { return String(t.epic_id) === String(e.id); }).forEach(function (t) { updateRow_(TABS.TASKS, t.id, { epic_id: target.id }); moved++; });
    deleteRow_(TABS.EPICS, e.id); // remove the now-empty bucket (no cascade — tasks already moved)
  });
  return 'Consolidated into "Sunday School Planning": moved ' + moved + ' tasks, removed ' + fold.length + ' bucket(s).';
}

/* ---------------------------------------------------------------- AI (Gemini) */
// PII rule: only event/task logistics are ever sent to Gemini — never children's records.
// Model is a Script Property (GEMINI_MODEL) so it can be swapped without a redeploy.
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

/** Surface cleanup candidates: empty events, duplicate names, counts. Run from editor. */
/** DIAGNOSTIC — run from the editor with a historical planning sheet's URL or ID.
 *  Reports each tab's size + column headers so we can build a tailored importer.
 *  READ-ONLY: opens the sheet, writes nothing, returns only structure (no row data). */
function peekSheet(urlOrId) {
  urlOrId = urlOrId || 'PASTE_URL_OR_ID_HERE';
  var m = String(urlOrId).match(/[-\w]{25,}/); // Drive file IDs are ~44 chars
  var id = m ? m[0] : String(urlOrId);
  var ss = SpreadsheetApp.openById(id);
  var out = ['Spreadsheet: ' + ss.getName(), 'ID: ' + id, ''];
  ss.getSheets().forEach(function (sh) {
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    var head = lr ? sh.getRange(1, 1, 1, lc).getValues()[0].map(function (v) { return String(v).trim(); }) : [];
    out.push('• "' + sh.getName() + '"  (' + Math.max(lr - 1, 0) + ' data rows × ' + lc + ' cols)');
    out.push('    headers: ' + head.join(' | '));
  });
  var s = out.join('\n');
  Logger.log(s);
  return s;
}

/** One-click: run this from the editor, then paste me the output. */
function peekMySheets() {
  var ids = [
    ['2025-26', '1SmVSQvHw3trHtYCZAGeLSyGEYUPZu8k7M5to0z3Nnc0'],
    ['2024-25', '1djjX-GvpwBfQwLQA_YZJhhwZoayJQ13M'],
  ];
  var out = ids.map(function (p) {
    try { return '===== ' + p[0] + ' =====\n' + peekSheet(p[1]); }
    catch (e) { return '===== ' + p[0] + ' =====\n[Could not open ' + p[1] + ': ' + e.message + ']\n(If this is an uploaded .xlsx, open it in Drive and File → Save as Google Sheets, then send me the new link.)'; }
  }).join('\n\n');
  Logger.log(out);
  return out;
}

/* ============================================================================
 *  HISTORICAL IMPORT — load 2 years of Calendar + Action Items from the old
 *  workbooks. Reads ONLY 'Calendar of Events' and 'ACTION ITEMS' by name, so
 *  it never touches any Student/Teacher/PII tab. Idempotent (safe to re-run).
 *  Editor use: run dryRun_2025_26() first, review, then commit_2025_26().
 * ========================================================================== */
var IMPORT_SRC = {
  '2025-26': '1SmVSQvHw3trHtYCZAGeLSyGEYUPZu8k7M5to0z3Nnc0',
  '2024-25': '1djjX-GvpwBfQwLQA_YZJhhwZoayJQ13M',
};

var _MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11 };
function monthIndex_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (/^\d+$/.test(s)) { var n = +s; return (n >= 1 && n <= 12) ? n - 1 : -1; }
  if (_MONTHS[s.slice(0, 4)] !== undefined) return _MONTHS[s.slice(0, 4)];
  if (_MONTHS[s.slice(0, 3)] !== undefined) return _MONTHS[s.slice(0, 3)];
  return -1;
}
function parseISO_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  var s = String(v || '').trim(); if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  return (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100)
    ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') : '';
}
// Resolve an event date from the Month + Date columns; academic year Jul(startYear)–Jun(startYear+1).
function calDate_(monthCell, dateCell, startYear) {
  var iso = parseISO_(dateCell); if (iso) return iso;
  var mi = monthIndex_(monthCell), day = parseInt(String(dateCell).replace(/[^\d]/g, ''), 10);
  if (mi >= 0 && day >= 1 && day <= 31) {
    var yr = (mi >= 6) ? startYear : startYear + 1;
    var d = new Date(Date.UTC(yr, mi, day));
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  }
  return '';
}
function mapTaskStatus_(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return 'Completed';                                        // historical + blank ⇒ assume done
  if (/progress|wip|ongoing|working|started/.test(s)) return 'In Progress';
  if (/not\s*start|to\s*do|todo|open|pending|new|yet/.test(s)) return 'Pending';
  return 'Completed';                                                // done/closed/finished/etc.
}
// Fast bulk append — one setValues instead of N appendRow calls (needed for ~hundreds of rows).
function batchInsert_(tab, objs) {
  if (!objs.length) return 0;
  var sh = sheet_(tab), header = headerOf_(sh), start = sh.getLastRow() + 1;
  var vals = objs.map(function (o) { return header.map(function (h) { return (o[h] !== undefined && o[h] !== null) ? o[h] : ''; }); });
  sh.getRange(start, 1, vals.length, header.length).setValues(vals);
  _tblCache = {};
  return vals.length;
}

function importYear(which, commit) {
  which = which || '2025-26';
  var srcId = IMPORT_SRC[which];
  if (!srcId) throw new Error('Unknown year ' + which);
  var startYear = parseInt(which.slice(0, 4), 10);
  var src = SpreadsheetApp.openById(srcId);

  var existEv = readTable_(TABS.EPICS);
  var evSeen = {};
  existEv.forEach(function (e) { evSeen[String(e.name).trim().toLowerCase() + '|' + fmtDate_(e.event_date)] = true; });

  // ---- Calendar of Events → events ----
  var calSh = src.getSheetByName('Calendar of Events');
  var newEvents = [], calRows = 0, calDated = 0;
  if (calSh) {
    var cv = calSh.getDataRange().getValues();
    for (var i = 1; i < cv.length; i++) {
      var r = cv[i], name = String(r[2] || '').trim();
      if (!name) continue;
      if (name.toLowerCase() === 'regular sunday school class') continue; // calendar auto-labels every Sunday already
      calRows++;
      var date = calDate_(r[0], r[1], startYear); if (date) calDated++;
      var notes = [String(r[3] || '').trim(), r[4] ? 'Lead: ' + String(r[4]).trim() : '', r[5] ? 'Link: ' + String(r[5]).trim() : ''].filter(String).join(' · ');
      var key = name.toLowerCase() + '|' + date;
      if (evSeen[key]) continue; evSeen[key] = true;
      newEvents.push({ id: uuid_(), name: name, type: '', event_date: date, status: '', notes: notes, program: "Children's Ministry", archived: '', no_school: '' });
    }
  }

  // ---- Action Items → tasks under a per-year bucket ----
  var bucketName = 'Action Items ' + which;
  var bucket = existEv.filter(function (e) { return String(e.name).trim().toLowerCase() === bucketName.toLowerCase(); })[0];
  var bucketId = bucket ? bucket.id : null;
  var taskSeen = {};
  readTable_(TABS.TASKS).forEach(function (t) { taskSeen[String(t.epic_id) + '|' + String(t.title).trim().toLowerCase()] = true; });

  var actSh = src.getSheetByName('ACTION ITEMS');
  var candTasks = [], actRows = 0, rawStatus = {};
  if (actSh) {
    var av = actSh.getDataRange().getValues();
    for (var j = 1; j < av.length; j++) {
      var a = av[j], title = String(a[1] || '').trim();
      if (!title) continue; actRows++;
      var rawTrim = String(a[3] || '').trim(), raw = rawTrim || '(blank)';
      rawStatus[raw] = (rawStatus[raw] || 0) + 1;
      // Historical archive: everything lands as Completed so it never clutters the live
      // open-tasks view; the original status is preserved in notes for reference + AI.
      var wasNote = (rawTrim && !/^(completed|done)$/i.test(rawTrim)) ? 'Was: ' + rawTrim : '';
      var dnote = a[0] ? 'Logged: ' + fmtDate_(a[0]) : '';
      candTasks.push({
        title: title, owner: String(a[2] || '').trim(), status: 'Completed',
        notes: [String(a[4] || '').trim(), wasNote, dnote].filter(String).join(' · '),
      });
    }
  }

  if (!commit) {
    var wouldTasks = candTasks.filter(function (t) { return !bucketId || !taskSeen[bucketId + '|' + t.title.toLowerCase()]; });
    var statusCount = {}; wouldTasks.forEach(function (t) { statusCount[t.status] = (statusCount[t.status] || 0) + 1; });
    return {
      year: which, commit: false, note: 'DRY RUN — nothing written. Review, then run commit_' + which.replace('-', '_') + '().',
      calendar: { rowsWithName: calRows, parsedDates: calDated, undated: calRows - calDated, newToInsert: newEvents.length },
      actionItems: { rowsWithTitle: actRows, newToInsert: wouldTasks.length, mappedStatus: statusCount, rawStatusValues: rawStatus },
      sampleEvents: newEvents.slice(0, 8).map(function (e) { return (e.event_date || 'no-date') + '  ·  ' + e.name + (e.notes ? '  [' + e.notes + ']' : ''); }),
      sampleTasks: wouldTasks.slice(0, 8).map(function (t) { return '[' + t.status + '] ' + t.title + (t.owner ? '  @' + t.owner : ''); }),
    };
  }

  // ---- COMMIT ----
  var evWritten = batchInsert_(TABS.EPICS, newEvents);
  if (!bucketId) {
    var b = insert_(TABS.EPICS, { id: uuid_(), name: bucketName, type: '', event_date: '', status: '', notes: 'Imported action-item history for ' + which, program: "Children's Ministry", archived: 'yes', no_school: '' });
    bucketId = b.id;
  }
  var taskObjs = candTasks
    .filter(function (t) { return !taskSeen[bucketId + '|' + t.title.toLowerCase()]; })
    .map(function (t) { return { id: uuid_(), epic_id: bucketId, title: t.title, owner: t.owner, due_offset: '', due_date: '', status: t.status, priority: 'Medium', notes: t.notes }; });
  var tkWritten = batchInsert_(TABS.TASKS, taskObjs);
  return { year: which, commit: true, eventsInserted: evWritten, bucket: bucketName, tasksInserted: tkWritten };
}

// No-arg wrappers (the editor Run button can't pass arguments). They log the
// result so it shows in the execution log — paste that back.
function _run_(which, commit) {
  try { var r = importYear(which, commit); Logger.log(JSON.stringify(r, null, 2)); return r; }
  catch (e) { Logger.log('IMPORT ERROR: ' + ((e && e.stack) || e)); throw e; }
}
function dryRun_2025_26() { return _run_('2025-26', false); }
function commit_2025_26() { return _run_('2025-26', true); }
function dryRun_2024_25() { return _run_('2024-25', false); }
function commit_2024_25() { return _run_('2024-25', true); }

function findCleanup() {
  var epics = readTable_(TABS.EPICS);
  var tasks = readTable_(TABS.TASKS);
  var taskCount = {}; tasks.forEach(function (t) { taskCount[t.epic_id] = (taskCount[t.epic_id] || 0) + 1; });
  var emptyEvents = epics.filter(function (e) { return !taskCount[e.id]; })
    .map(function (e) { return e.name + (e.event_date ? ' (' + fmtDate_(e.event_date) + ')' : ' [undated]') + (String(e.archived || '').trim() ? ' [archived]' : ''); });
  var seen = {}, dups = [];
  epics.forEach(function (e) { var n = String(e.name).trim().toLowerCase(); if (seen[n]) dups.push(e.name); else seen[n] = true; });
  var out = {
    totalEvents: epics.length, totalTasks: tasks.length,
    completedTasks: tasks.filter(function (t) { return t.status === 'Completed'; }).length,
    emptyEvents: emptyEvents, duplicateEventNames: dups,
  };
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out);
}

/** List the most recently added tasks (run from the editor, read the log). */
function listRecentTasks() {
  var tasks = readTable_(TABS.TASKS);
  var epics = readTable_(TABS.EPICS);
  var byId = {}; epics.forEach(function (e) { byId[e.id] = e.name; });
  var last = tasks.slice(-15).map(function (t) {
    return { event: byId[t.epic_id] || '(none)', title: t.title, owner: t.owner || '', due: fmtDate_(t.due_date) || t.due_offset || '', status: t.status };
  });
  Logger.log(JSON.stringify(last, null, 2));
  return JSON.stringify(last);
}

/** Diagnostic: list models this key can use for generateContent. Run from the editor. */
function listGeminiModels() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return 'Set GEMINI_API_KEY first.';
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { Logger.log('ERROR ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 400)); return res.getContentText().slice(0, 400); }
  var body = JSON.parse(res.getContentText());
  var names = (body.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; }).map(function (m) { return m.name.replace('models/', ''); });
  Logger.log(JSON.stringify(names, null, 2));
  return JSON.stringify(names);
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
    ['epic_id', 'item', 'category', 'amount', 'status', 'notes', 'date', 'paid_by', 'reimbursed', 'receipt_url'].forEach(function (k) {
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
  };
  if (!clean.item) throw new Error('Item is required');
  return insert_(TABS.BUDGET, clean);
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
/** Run once from the editor after adding Drive scope, to grant Drive access. */
function authorizeDrive() {
  // Perform a real WRITE so Google grants the full drive scope (create/edit),
  // not just read. Create a temp file, then trash it.
  var f = DriveApp.createFile('cm-planner-auth-check.txt', 'ok', 'text/plain');
  f.setTrashed(true);
  return 'Drive write access granted.';
}
/** Run once from the editor: adds the new expense columns to the Budget tab. */
function migrateBudget() {
  var sh = sheet_(TABS.BUDGET);
  var header = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  var added = [];
  ['date', 'paid_by', 'reimbursed', 'receipt_url'].forEach(function (c) {
    if (header.indexOf(c) < 0) { sh.getRange(1, header.length + 1).setValue(c); header.push(c); added.push(c); }
  });
  return added.length ? ('Added: ' + added.join(', ')) : 'Already migrated.';
}

// Shared expense loader. rows = [[date, event, item, amount, spent_by, reimbursed, notes, link], ...]
function importRows_(rows) {
  function pdate(v) {
    if (v instanceof Date) return fmtDate_(v);
    var s = String(v || '').trim(); if (!s) return '';
    var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return fmtDate_(s);
  }
  var yrs = {};
  rows.forEach(function (r) { var d = pdate(r[0]); if (d) yrs[d.slice(0, 4)] = (yrs[d.slice(0, 4)] || 0) + 1; });
  var defYear = Object.keys(yrs).sort(function (a, b) { return yrs[b] - yrs[a]; })[0] || String(new Date().getFullYear());
  var epics = readTable_(TABS.EPICS);
  function matchEpic(ev) {
    ev = String(ev || '').toLowerCase(); if (!ev) return '';
    for (var j = 0; j < epics.length; j++) { var n = String(epics[j].name || '').toLowerCase(); if (n && (ev.indexOf(n) >= 0 || n.indexOf(ev) >= 0)) return epics[j].id; }
    return '';
  }
  var existing = readTable_(TABS.BUDGET);
  function dup(item, amt, date) { return existing.some(function (b) { return String(b.item || '').trim() === item && (Number(b.amount) || 0) === amt && String(b.date || '') === date; }); }
  var added = 0, skipped = 0, undated = 0;
  rows.forEach(function (r) {
    var item = String(r[2] || '').trim(), amt = Number(r[3]) || 0;
    if (!item && !amt) return;
    var date = pdate(r[0]); if (!date) { date = defYear + '-01-01'; undated++; }
    if (dup(item, amt, date)) { skipped++; return; }
    var ev = String(r[1] || '').trim(), nt = String(r[6] || '').trim(), reimb = String(r[5] || '').trim();
    insert_(TABS.BUDGET, {
      id: uuid_(), epic_id: matchEpic(ev), item: item, category: 'expense', amount: amt, status: '',
      notes: ev ? (ev + (nt ? ' · ' + nt : '')) : nt, date: date,
      paid_by: String(r[4] || '').trim(), reimbursed: reimb ? 'Yes' : 'No', receipt_url: String(r[7] || '').trim(),
    });
    added++;
  });
  var msg = 'Imported ' + added + ' expenses' + (skipped ? ', skipped ' + skipped + ' dupes' : '') +
    (undated ? ', ' + undated + ' undated set to ' + defYear + '-01-01' : '') + '.';
  Logger.log(msg);
  return msg;
}

/** Run once from the editor: loads the 2026 expenses (dedupes, so re-running is safe). */
function seedExpenses2026() {
  var ROWS = [
    ['', 'Regular Sunday School', 'GoldFish', 11.23, 'Dinesh', '', '', ''],
    ['', 'Sunday school regular classes', 'ABC Digital monthly subscription (Jan)', 29.97, 'Dinesh', '', '', ''],
    ['', 'Sunday school regular classes', 'ABC Digital monthly subscription (Feb)', 29.97, 'Dinesh', '', '', ''],
    ['01/28/2026', 'FMSC snacks', 'Pretzel, Addictives, Veggie straws, Caprisun', 46.56, 'Dorothy', '', 'Receipt uploaded', 'https://drive.google.com/file/d/1HcBRIesT2qUHnwrF0DDKtL_AOoo7r3Qu/view?usp=drive_link'],
    ['03/09/2026', 'Compassion International gift', 'Birthday gift for Ana', 30.00, 'Dorothy', '', 'Details on website', 'https://www.compassion.com/my-account/taxes-statements.htm?Year=2026'],
    ['', 'ABC Curriculum', 'Unit 5 curriculum for Toddler and Elementary classes', 108.40, 'Dinesh', '', '', ''],
    ['', 'Sunday school regular classes', 'ABC Digital monthly subscription for March 2026', 29.97, 'Dinesh', '', '', ''],
    ['03/04/2026', "Children's Sunday Trophies", "40 trophies for Children's Sunday by Stacie Bosson", 378.89, 'Dorothy', '', 'Invoice uploaded', 'https://drive.google.com/file/d/1OE5JEiApQfn_zzNloOIbeWmvc26yvIeZ/view?usp=sharing'],
    ['04/26/2026', "Children's Sunday Gift cards", '6 Chick-fil-A cards $10 each', 60.00, '', '', '', ''],
    ['04/25/2026', "Children's Sunday Trays", '2 trays for trophies', 14.88, 'Dorothy', '', 'Receipt uploaded', 'https://drive.google.com/file/d/1IYe8b89Nx_M7tyng-ymtVElOdLvWjVwZ/view?usp=sharing'],
    ['', 'Gift & books', 'Gift & books for Seniors and James (Baptized)', 61.32, 'Dorothy', '', 'Receipt uploaded', 'https://drive.google.com/file/d/1f7PYgWVlCeKJBRTGx6MP1I-LXjTe3G0C/view?usp=sharing'],
    ['05/09/2026', 'ABC Curriculum', 'ABC Middle school Unit 5 Student Guides - 9', 52.41, 'Dorothy', '', 'Receipt uploaded', 'https://drive.google.com/file/d/1rYrXmRv9v4jKpWlSpn3UF5LJTGUl6mQD/view?usp=drive_link'],
    ['07/22/2026', 'ABC Curriculum', 'Unit 6 Teachers kits, Take home sheets, Students guides for Toddler, Elementary and Middle school classes', 162.62, 'Dorothy', '', 'Receipt uploaded', 'https://drive.google.com/file/d/1Pv4VnOsClHJFdO0JAukDLdqQp4uejBHH/view?usp=sharing'],
  ];
  return importRows_(ROWS);
}

/* ---------------------------------------------------- feedback + carry-forward */

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

function backfillChildIds() {
  var sh = sheet_(TABS.CHILDREN);
  var last = sh.getLastRow();
  if (last < 2) return 'No child rows to process.';
  var idCol = sh.getRange(2, 1, last - 1, 1).getValues();       // column A (id)
  var nameCol = sh.getRange(2, 2, last - 1, 1).getValues();     // column B (name)
  var n = 0;
  for (var i = 0; i < idCol.length; i++) {
    if (String(nameCol[i][0]).trim() !== '' && String(idCol[i][0]).trim() === '') {
      idCol[i][0] = Utilities.getUuid();
      n++;
    }
  }
  sh.getRange(2, 1, last - 1, 1).setValues(idCol);
  return 'Assigned ids to ' + n + ' child row(s).';
}

/** Run once from the editor: adds the program + archived columns to the Events tab. */
function migrateEvents() {
  var sh = sheet_(TABS.EPICS);
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); });
  var added = [];
  ['program', 'archived'].forEach(function (col) {
    if (head.indexOf(col) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setValue(col); added.push(col); }
  });
  return added.length ? ('Added columns: ' + added.join(', ') + '. Now set a Program on each event in the app.') : 'Already migrated.';
}

/** Run once from the editor: loads the 2026-27 calendar of events. Safe to re-run
 *  (skips any event whose name already exists). Undated events are TBD-schedulable. */
function seedCalendar2627() {
  var sh = sheet_(TABS.EPICS);
  var header = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  ['program', 'archived'].forEach(function (c) { if (header.indexOf(c) < 0) { sh.getRange(1, header.length + 1).setValue(c); header.push(c); } });

  var have = {}; readTable_(TABS.EPICS).forEach(function (e) { have[String(e.name).trim().toLowerCase()] = true; });
  // [name, program, date ('' = TBD), notes, status]
  var evs = [
    ['First Teachers/Volunteers meeting (Zoom)', "Children's Ministry", '2026-07-09', '', 'Upcoming'],
    ["Teacher's Orientation Workshop", "Children's Ministry", '2026-08-29', '', 'Upcoming'],
    ['Second Teachers Meeting (after service)', "Children's Ministry", '2026-10-11', '', 'Upcoming'],
    ['Family Carol Service', "Children's Ministry", '2026-12-20', 'No Sunday School', 'Upcoming'],
    ['Teachers Meeting', "Children's Ministry", '2026-12-28', '', 'Upcoming'],
    ['Good Friday Service', "Children's Ministry", '2027-03-26', 'No childcare or Sunday school', 'Upcoming'],
    ["Children's Sunday", "Children's Ministry", '2027-04-25', '', 'Upcoming'],
    ['VBS 2027', "Children's Ministry", '', 'Summer 2027 (TBD) — planning starts May', 'Planning'],
    ['Mission Trip to Arlington', 'Outreach', '2026-07-15', 'Wed–Sat, through 7/18/2026', 'Upcoming'],
    ['OCC Shoebox pickup kickoff', 'Outreach', '2026-10-25', 'Show packing video; HS-managed pickup table', 'Upcoming'],
    ['Brown Santa – Caring & Serving', 'Outreach', '2026-11-14', 'For UE and above', 'Upcoming'],
    ['OCC Shoeboxes – order', 'Outreach', '', 'September 2026 — order from Operation Christmas Child', 'Planning'],
    ['OCC Shoeboxes – submission', 'Outreach', '', 'November 2026 — submission', 'Planning'],
    ['FMSC serving event', 'Outreach', '', 'January 2027 (TBD) — check dates', 'Planning'],
    ['Nursing home / serving event', 'Outreach', '', 'March 2027 (TBD) — explore and fix dates', 'Planning'],
    ['Harvest Festival', 'Special Events', '2026-10-24', '', 'Upcoming'],
    ['Austin Desi Christmas (ADC)', 'Special Events', '2026-12-05', '', 'Upcoming'],
    ['Reality Conference, Dallas', 'Special Events', '2027-02-19', 'Through 2/20/2027; group registration', 'Upcoming'],
    ['Bake Sale', 'Fund Raisers', '', 'September 2026 (TBD) — fix a Sunday date', 'Planning'],
  ];
  var added = 0;
  evs.forEach(function (e) {
    if (have[e[0].trim().toLowerCase()]) return;
    insert_(TABS.EPICS, { id: uuid_(), name: e[0], type: '', event_date: e[2], status: e[4], notes: e[3], program: e[1], archived: '' });
    added++;
  });
  return 'Added ' + added + ' events (' + (evs.length - added) + ' already present).';
}

/** Church-wide events CM tracks but doesn't own. Run once to move them into the
 *  new "Church Events" program. Easter/Christmas keep any "kids sing" tasks; days
 *  with no class should carry "No Sunday School" in notes so the calendar hides the class. */
function reclassifyChurchEvents() {
  var names = ['harvest festival', 'good friday service', 'family carol service',
               'easter', 'easter sunday', 'christmas', 'christmas service'];
  var rows = readTable_(TABS.EPICS), moved = 0;
  rows.forEach(function (e) {
    if (names.indexOf(String(e.name).trim().toLowerCase()) >= 0 && e.program !== 'Church Events') {
      updateRow_(TABS.EPICS, e.id, { program: 'Church Events' }); moved++;
    }
  });
  return 'Moved ' + moved + ' event(s) to Church Events.';
}

/** Seed the recurring annual events for an academic year (Jul ayStart – Jun ayStart+1).
 *  No arg = current academic year. Safe to re-run (skips a match on same name + date).
 *  Run once per year (or wire a yearly trigger later):
 *   - Mother's Day (2nd Sunday of May) + Father's Day (3rd Sunday of June) — Children's
 *     Ministry, kids sing a group song.
 *   - Christmas (Dec 25) + New Year's Day (Jan 1) — Church Events. */
function addAnnualDays(ayStart) {
  var now = new Date();
  if (!ayStart) ayStart = (now.getMonth() >= 6) ? now.getFullYear() : now.getFullYear() - 1;
  var y = ayStart + 1; // spring calendar year (May, June, Jan all fall here)
  function pad(n) { return ('0' + n).slice(-2); }
  function nthSunday(year, month0, n) { // month0: 0-11
    var first = new Date(year, month0, 1);
    var day = 1 + ((7 - first.getDay()) % 7) + (n - 1) * 7;
    return year + '-' + pad(month0 + 1) + '-' + pad(day);
  }
  var rows = readTable_(TABS.EPICS);
  function ensure(name, date, program, notes) {
    var dup = rows.some(function (e) { return String(e.name).trim().toLowerCase() === name.toLowerCase() && fmtDate_(e.event_date) === date; });
    if (dup) return name + ' (exists)';
    insert_(TABS.EPICS, { id: uuid_(), name: name, type: '', event_date: date, status: 'Upcoming', notes: notes || '', program: program, archived: '' });
    return name + ' ' + date;
  }
  var out = [
    ensure("Mother's Day", nthSunday(y, 4, 2), "Children's Ministry", 'Children sing a group song'),
    ensure("Father's Day", nthSunday(y, 5, 3), "Children's Ministry", 'Children sing a group song'),
    ensure('Christmas', ayStart + '-12-25', 'Church Events', 'Children sing a group song'),
    ensure("New Year's Day", y + '-01-01', 'Church Events', '')
  ];
  return 'Academic year ' + ayStart + '–' + String(y).slice(2) + ': ' + out.join(' · ');
}

/** Tidy completed events: archive events whose tasks are all done, and no-task events
 *  whose date has already passed. Mirrors the app's auto-archive for the cases that have
 *  no per-task trigger (e.g. church events with zero CM tasks). Safe to re-run. */
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

/** Add Mother's Day (2nd Sun of May) + Father's Day (3rd Sun of June) as Special Events
 *  for an academic year. Kids sing a group song, so they carry a note + stay on the calendar.
 *  Editor: run addSpecialDays_2026_27() (or _2025_26). Safe to re-run (skips existing). */
function nthSundayOfMonth_(year, month0, n) {
  var first = new Date(Date.UTC(year, month0, 1));
  var day = 1 + ((7 - first.getUTCDay()) % 7) + (n - 1) * 7;
  return Utilities.formatDate(new Date(Date.UTC(year, month0, day)), tz_(), 'yyyy-MM-dd');
}
function addAnnualSpecialDays(ayStart) {
  var y = ayStart + 1; // academic year Jul(ayStart)–Jun(ayStart+1); May/June fall in the spring year
  var events = readTable_(TABS.EPICS);
  function ensure(name, date) {
    if (events.some(function (e) { return String(e.name).trim().toLowerCase() === name.toLowerCase() && fmtDate_(e.event_date) === date; }))
      return name + ' already present (' + date + ')';
    insert_(TABS.EPICS, { id: uuid_(), name: name, type: '', event_date: date, status: '', notes: 'Children sing a group song', program: 'Special Events', archived: '', no_school: '' });
    return 'Added ' + name + ' — ' + date;
  }
  var r = [ensure("Mother's Day", nthSundayOfMonth_(y, 4, 2)), ensure("Father's Day", nthSundayOfMonth_(y, 5, 3))];
  Logger.log(r.join('\n'));
  return r;
}
function addSpecialDays_2025_26() { return addAnnualSpecialDays(2025); }
function addSpecialDays_2026_27() { return addAnnualSpecialDays(2026); }

/** Suggest/apply the "Church Events" program to church-festival events (imported as
 *  "Children's Ministry"). Dry-run lists candidates; commit reassigns the program.
 *  Editor: run dryRunRetagChurch() first, review, then commitRetagChurch(). */
// Tight: match church-wide *services/days*, NOT classes/lessons/practices that merely
// mention a holiday (e.g. "Sunday school class + Easter song practice" is CM work).
var CHURCH_PATTERNS = /harvest festival|good\s*friday|christmas (service|day)|new year.*(eve|service)|resurrection sunday|easter sunday|palm sunday|watch\s*night service/i;
function retagChurchEvents(commit) {
  var events = readTable_(TABS.EPICS);
  var matches = events.filter(function (e) {
    if (/^action items /i.test(String(e.name || ''))) return false;
    return CHURCH_PATTERNS.test(String(e.name || '')) && String(e.program || '').trim() !== 'Church Events';
  });
  if (commit) matches.forEach(function (e) { updateRow_(TABS.EPICS, e.id, { program: 'Church Events' }); });
  var r = {
    commit: !!commit, count: matches.length,
    events: matches.map(function (e) { return (fmtDate_(e.event_date) || 'undated') + '  ·  ' + e.name + '  [was: ' + (e.program || '—') + ']'; }),
    note: commit ? 'Reassigned to Church Events.' : 'DRY RUN — nothing changed. Review, then run commitRetagChurch().',
  };
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}
function dryRunRetagChurch() { return retagChurchEvents(false); }
function commitRetagChurch() { return retagChurchEvents(true); }

/** Repair: un-archive every event except the imported action-item buckets.
 *  Fast single-sheet rewrite. Run once from the editor if Tidy hid the imported history. */
function restoreEventsExceptBuckets() {
  var sh = sheet_(TABS.EPICS);
  var vals = sh.getDataRange().getValues();
  var header = vals[0].map(String);
  var iName = header.indexOf('name'), iArch = header.indexOf('archived');
  if (iArch < 0) return 'No archived column.';
  var n = 0, keptBuckets = 0;
  for (var r = 1; r < vals.length; r++) {
    var name = String(vals[r][iName] || '').trim();
    if (/^action items /i.test(name)) { if (String(vals[r][iArch]).trim()) keptBuckets++; continue; }
    if (String(vals[r][iArch] || '').trim()) { vals[r][iArch] = ''; n++; }
  }
  sh.getDataRange().setValues(vals);
  _tblCache = {};
  Logger.log('Un-archived ' + n + ' event(s). Kept ' + keptBuckets + ' action-item bucket(s) archived.');
  return 'Un-archived ' + n + ' event(s). Kept ' + keptBuckets + ' action-item bucket(s) archived.';
}

/** Run once from the editor: loads the July 2026 planning-meeting tasks (deduped).
 *  Creates catch-all events as needed. Safe to re-run (skips existing titles). */
function seedTasksJul2026() {
  function ensureEvent(name, date, notes) {
    var ev = readTable_(TABS.EPICS).find(function (e) { return String(e.name).trim().toLowerCase() === name.toLowerCase(); });
    if (ev) return ev.id;
    var id = uuid_();
    insert_(TABS.EPICS, { id: id, name: name, type: '', event_date: date || '', status: 'In Progress', notes: notes || '', program: "Children's Ministry", archived: '' });
    return id;
  }
  var CATCH = ensureEvent("Children's Ministry — Planning 2026-27", '', 'Ongoing co-leader planning & admin tasks');
  var VBS = ensureEvent('VBS 2026', '2026-07-15', 'Summer 2026 VBS wrap-up');
  function findEvent(name) { var e = readTable_(TABS.EPICS).find(function (x) { return String(x.name).trim().toLowerCase() === name.toLowerCase(); }); return e ? e.id : CATCH; }
  var MT = findEvent('Mission Trip to Arlington');
  var TO = findEvent("Teacher's Orientation Workshop");

  var have = {}; readTable_(TABS.TASKS).forEach(function (t) { have[String(t.title).trim().toLowerCase()] = true; });
  // [title, owner, status, notes, eventId]
  var tasks = [
    ['Plan Sunday school for 2026-27 (feedback, calendar, programs, training, budget, involve teachers)', 'Dinesh & Dorothy', 'Pending', 'Go through individually; discuss next meeting', CATCH],
    ['Offertory Song — closure email to Pastor and Board', 'Dinesh Patra', 'Completed', '', CATCH],
    ['Reorg Google Drive folder structure — add years to all folders', 'Dinesh Patra', 'Completed', '', CATCH],
    ['Buy ABC Curriculum Unit 6', 'Dorothy Rose', 'Completed', '', CATCH],
    ['List of teachers and volunteers for 2026-27 classes', 'Dinesh & Dorothy', 'Pending', 'Still need Middle School & Elementary — check Deepa Fenil, Susan', CATCH],
    ["Teachers/volunteers kickoff meeting (Thu 07/09, 9pm CST) — reuse last year's slides", 'Dinesh & Dorothy', 'Completed', '', CATCH],
    ['Calendar of events for 2026-27 — update and sync both sheets', 'Dinesh Patra', 'Completed', 'Updated through December 2026', CATCH],
    ['Update expenses and offertory for the last few Sundays', 'Dinesh Patra', 'Pending', '', CATCH],
    ['Talk to Neil about Sunday school plans, then session with Ps Vinod', 'Dorothy Rose', 'Pending', '', CATCH],
    ['Update Teachers sheet link in the Teachers WhatsApp group', 'Dinesh Patra', 'Completed', '', CATCH],
    ['Update Parents WhatsApp group — kids moved to next classes per student list', 'Dinesh Patra', 'Completed', '', CATCH],
    ['Sync student lists across all sheets', 'Dinesh Patra', 'Pending', '', CATCH],
    ['Talk to Abi & John to move to 2026 semester; move Stella to 2027', 'Dinesh Patra', 'In Progress', '', CATCH],
    ['Review Praise Factory curriculum; send to Suja, Sreenivas, Charles, Dorothy', 'Dorothy Rose', 'Pending', '', CATCH],
    ['Send CFC expenses to Shirisha (copy CFC coordinators)', 'Dinesh Patra', 'Pending', '', CATCH],
    ['Email brother Daniel re expense sheets / reimbursements (from Jan 2026?)', 'Dinesh Patra', 'Pending', 'Not yet started', CATCH],
    ['Call ABC to correct unit/lesson numbers to align to our schedule', 'Dorothy Rose', 'Pending', '', CATCH],
    ['Email Board to begin academic year (registered kids, teachers list, sheet links, expenses, calendar)', 'Dorothy Rose', 'Pending', '', CATCH],
    ['Email Pastor: Board confirmed no Child Protection Training needed (small church)', 'Dinesh Patra', 'Pending', '', CATCH],
    ['Create new 2026 expense sheet; migrate from old sheet', 'Dinesh Patra', 'Pending', '', CATCH],
    ['Adjust attendance sheet to sync with student list', 'Dinesh Patra', 'Pending', '', CATCH],
    ['Discipleship Program — meeting with Shirisha & Ps Vinod to kick it off', 'Dinesh Patra', 'Pending', 'Get a time this week', CATCH],

    ['Check with Pastor on Teachers Orientation date', 'Dinesh & Dorothy', 'Completed', 'No Saturdays available till Aug 29', TO],
    ['Email Board & Shirisha requesting Aug 29 (morning/afternoon)', 'Dorothy Rose', 'Completed', '', TO],
    ['Plan workshop details once Board approves; Pastor is resource person on Discipleship; send Pastor the schedule', 'Dinesh & Dorothy', 'Pending', '', TO],

    ['Mission trip planning — prep meetings, prayer calls, logistics (cars, accommodation, food, teams, devotions)', 'Dinesh & Dorothy', 'Completed', 'First prep meeting done', MT],
    ['Message kids to record a video and send to Stella', 'Dorothy Rose', 'Completed', '', MT],
    ['Stella & br. Naga to email Board a report with budget; cost per person', 'Dorothy Rose', 'In Progress', 'Stella to send the email report', MT],
    ['Remind Stella to make the student-experience video for Jul 26; feedback & thanksgiving meeting with crew', 'Dorothy Rose', 'Completed', '', MT],

    ['Thank-you card to IBC Pastor Venu and IBC church', 'Dorothy Rose', 'Pending', '', VBS],
    ['Create SignUpGenius for VBS sponsors', 'Dinesh Patra', 'Completed', 'Decided not required', VBS],
    ['Download VBS recordings from IBC website', 'Dinesh Patra', 'Pending', '', VBS],
    ['Share IBC link (VBS videos) with parents', 'Dorothy Rose', 'Completed', '', VBS],
    ['Email Board a VBS report with expense sheet and video link', 'Dinesh Patra', 'Completed', '', VBS],
    ['Have 3 kids share their VBS experience before the video', 'Dinesh Patra', 'Completed', 'Only 2 shared (Joanna, Jayden)', VBS],
    ['Check with IBC for VBS pictures and YouTube link', 'Dorothy Rose', 'In Progress', 'Pastor Venu in India; follow up when he returns', VBS],
  ];
  var added = 0;
  tasks.forEach(function (t) {
    if (have[t[0].trim().toLowerCase()]) return;
    insert_(TABS.TASKS, { id: uuid_(), epic_id: t[4], title: t[0], owner: t[1], due_offset: '', due_date: '', status: t[2], priority: 'Medium', notes: t[3] });
    added++;
  });
  return 'Added ' + added + ' tasks (' + (tasks.length - added) + ' already present).';
}

/* ------------------------------------------------ weekly class ops (Sunday) */
// Attendance is per-child (a row per present child), offertory + lesson are one
// row per class per Sunday. Teachers/co-teachers are locked to their own class.

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
/** Run once from the editor to seed each class at the current lesson (52). Safe to re-run. */
function seedLessonPointers() {
  CLASSES.forEach(function (c) {
    if (!readTable_(TABS.LESSONS).find(function (r) { return String(r.class || '').trim().toLowerCase() === c.toLowerCase(); }))
      insert_(TABS.LESSONS, { class: c, next_lesson: LESSON_FALLBACK });
  });
  return readTable_(TABS.LESSONS);
}
// A Sunday is "no school" if any event that day carries the flag (or says so in name/notes).
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

/** Run once from the editor: seed current-semester assignments from Members.class. */
function seedAssignmentsFromMembers() {
  var cur = currentSemester_(), have = {};
  readTable_(TABS.ASSIGNMENTS).forEach(function (x) { have[String(x.email).toLowerCase() + '|' + x['class'] + '|' + x.semester] = true; });
  var n = 0;
  readTable_(TABS.MEMBERS).forEach(function (m) {
    var cls = String(m['class'] || '').trim(), email = String(m.email || '').trim().toLowerCase(), role = String(m.role || '').trim();
    if (cls && DOERS.indexOf(role) >= 0 && !have[email + '|' + cls + '|' + cur]) {
      insert_(TABS.ASSIGNMENTS, { id: uuid_(), email: email, name: m.name, class: cls, role: role, semester: cur }); n++;
    }
  });
  return 'Seeded ' + n + ' assignments for ' + semLabel_(cur) + ' (' + semDesc_(cur) + ').';
}

/** Run once: CLEARS the Assignments tab, then loads the clean 2026-27 rosters
 *  split by semester. Names are pulled from Members when the email matches. */
function seedAssignments2627() {
  var sh = sheet_(TABS.ASSIGNMENTS);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1); // wipe prior seeds
  var members = readTable_(TABS.MEMBERS);
  // Resolve each seeded person against the Members roster by name, so we pick up
  // their real email + canonical name (keeps Assignments and Members identical).
  function findMem(seedName) {
    var s = String(seedName || '').toLowerCase().trim(); if (!s) return null;
    return members.find(function (m) { return String(m.name || '').toLowerCase().trim() === s; })
        || members.find(function (m) { var n = String(m.name || '').toLowerCase(); return n && (n.indexOf(s) >= 0 || s.indexOf(n) >= 0); })
        || members.find(function (m) { return String(m.name || '').toLowerCase().trim().split(' ')[0] === s.split(' ')[0]; }) || null;
  }
  var F = '2026F', S = '2026S'; // Fall 2026 shows "2026"; Spring 2027 shows "2027"
  var ROWS = [
    ['Mahitha', 'mahithahavaji04@gmail.com', 'Toddler', 'teacher', F],
    ['Sona', '', 'Toddler', 'co_teacher', F],
    ['Teju', '', 'Toddler', 'co_teacher', F],
    ['Jennifer Manohar', 'jeni.rose44@gmail.com', 'Elementary', 'teacher', F],
    ['Raj Valluri', 'rajvalluri777@gmail.com', 'Elementary', 'co_teacher', F],
    ['Stella', 'stellasam030@gmail.com', 'Middle School', 'teacher', F],
    ['Angeline Franklin', '', 'Middle School', 'co_teacher', F],
    ['Srinivas Vadlapatla', 'vsreeni@gmail.com', 'High School', 'teacher', F],
    ['Charles Rose', 'charles.e.rose@gmail.com', 'High School', 'co_teacher', F],
    ['Mukta Sebastian', 'mukta.potharaju@gmail.com', 'High School', 'co_teacher', F],
    ['Amuthan Sebastian', '', 'High School', 'co_teacher', F],
    ['Angel Emmanuel', 'angeljvinu@hotmail.com', 'Toddler', 'teacher', S],
    ['Divya', 'Dpasupuleti7@gmail.com', 'Toddler', 'co_teacher', S],
    ['Denzyl', '', 'Toddler', 'co_teacher', S],
    ['Madhu Vikram', 'vivel0526@gmail.com', 'Elementary', 'teacher', S],
    ['Ramya Naveen', 'ramyanaveen07@gmail.com', 'Elementary', 'co_teacher', S],
    ['Abi Dinesh', 'abi.kugan@gmail.com', 'Middle School', 'teacher', S],
    ['John Mudumuntala', 'babujohn1992@gmail.com', 'Middle School', 'co_teacher', S],
    ['Srinivas Vadlapatla', 'vsreeni@gmail.com', 'High School', 'teacher', S],
    ['Charles Rose', 'charles.e.rose@gmail.com', 'High School', 'co_teacher', S],
    ['Mukta Sebastian', 'mukta.potharaju@gmail.com', 'High School', 'co_teacher', S],
    ['Amuthan Sebastian', '', 'High School', 'co_teacher', S],
  ];
  ROWS.forEach(function (r) {
    var mem = findMem(r[0]);
    insert_(TABS.ASSIGNMENTS, {
      id: uuid_(),
      email: mem ? String(mem.email || '').trim().toLowerCase() : String(r[1] || '').trim().toLowerCase(),
      name: mem ? mem.name : r[0],
      class: r[2], role: r[3], semester: r[4],
    });
  });
  return 'Cleared and re-seeded ' + ROWS.length + ' assignments — 11 in Fall 2026, 11 in Spring 2027.';
}

/** Run once: add the oversight members + fill in Stella's and Mukta's new emails. */
function seedNewMembers() {
  var people = [
    // [email, name, role, class]
    ['josh.david@acfi.cc', 'Josh David', 'chairman', ''],
    ['daniel.pabbathi@acfi.cc', 'Daniel Pabbathi', 'treasurer', ''],
    ['stellasam030@gmail.com', 'Stella', 'teacher', 'Middle School'],
    ['mukta.potharaju@gmail.com', 'Mukta Sebastian', 'co_teacher', 'High School'],
  ];
  var existing = readTable_(TABS.MEMBERS);
  var added = 0, updated = 0;
  people.forEach(function (p) {
    var email = String(p[0]).trim().toLowerCase();
    var ex = existing.find(function (m) { return String(m.email || '').trim().toLowerCase() === email; });
    if (ex) { updateRow_(TABS.MEMBERS, ex.email, { name: p[1], role: p[2], class: p[3] }); updated++; }
    else { insert_(TABS.MEMBERS, { email: email, name: p[1], role: p[2], token: shortToken_(), class: p[3] }); added++; }
  });
  return 'Members: added ' + added + ', updated ' + updated + '. Remember to add the new emails as OAuth test users.';
}

/** Run ONCE (before reopening the app): renames the physical tabs Epics->Events,
 *  Budget->Expenses so the sheet matches the app's terminology. */
function renameLegacyTabs() {
  var ss = ss_(), msgs = [];
  [['Epics', 'Events'], ['Budget', 'Expenses']].forEach(function (p) {
    var oldSh = ss.getSheetByName(p[0]), newSh = ss.getSheetByName(p[1]);
    if (oldSh && !newSh) { oldSh.setName(p[1]); msgs.push(p[0] + ' → ' + p[1]); }
    else if (oldSh && newSh) {
      if (newSh.getLastRow() <= 1) { ss.deleteSheet(newSh); oldSh.setName(p[1]); msgs.push(p[0] + ' → ' + p[1] + ' (removed empty duplicate)'); }
      else msgs.push('BOTH "' + p[0] + '" and "' + p[1] + '" have data — left alone, merge manually');
    }
  });
  return msgs.length ? ('Done: ' + msgs.join('; ')) : 'Nothing to rename (already done).';
}

/**
 * ONE-TIME historical import. Paste your offertory matrix into a tab named
 * "OffertoryImport" (with a header row like: Date | Toddler | Lower Elementary |
 * Upper Elementary | Middle | High | TOTAL), then run this from the editor.
 * It un-pivots into the Weekly tab: Lower+Upper Elementary -> Elementary,
 * Middle -> Middle School, High -> High School. Safe to re-run (upserts).
 */
function importOffertory() {
  var ss = ss_();
  var sh = ss.getSheetByName('OffertoryImport');
  if (!sh) return 'Create a tab named exactly "OffertoryImport", paste your offertory matrix (with a header row), then run this again.';
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return 'OffertoryImport has no data rows.';
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function col(kw) { for (var i = 0; i < header.length; i++) if (header[i].indexOf(kw) >= 0) return i; return -1; }
  var cDate = col('date'), cTod = col('toddler'), cLow = col('lower'), cUp = col('upper'),
      cMid = col('middle'), cHigh = col('high');
  // A standalone Elementary column = contains "elementary" but not lower/upper.
  var cElem = -1;
  for (var k = 0; k < header.length; k++) {
    if (header[k].indexOf('elementary') >= 0 && header[k].indexOf('lower') < 0 && header[k].indexOf('upper') < 0) { cElem = k; break; }
  }
  if (cDate < 0) return 'Could not find a "Date" column in OffertoryImport.';

  var idx = {}; // existing Weekly rows: "date|class" -> id (so re-runs upsert)
  readTable_(TABS.WEEKLY).forEach(function (r) { idx[fmtDate_(r.date) + '|' + String(r.class || '').trim().toLowerCase()] = r.id; });
  function num(v) { var n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
  function put(date, cls, amt) {
    var k = date + '|' + cls.toLowerCase();
    if (idx[k]) { updateRow_(TABS.WEEKLY, idx[k], { offertory: amt }); } // preserves lesson/notes
    else { var id = uuid_(); insert_(TABS.WEEKLY, { id: id, date: date, class: cls, offertory: amt, lesson: '', notes: '' }); idx[k] = id; }
  }

  var sundays = 0, amounts = 0;
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var d = fmtDate_(row[cDate]);
    if (!d) continue;
    var elem = (cLow >= 0 ? num(row[cLow]) : 0) + (cUp >= 0 ? num(row[cUp]) : 0) + (cElem >= 0 ? num(row[cElem]) : 0);
    var perClass = [['Toddler', cTod >= 0 ? num(row[cTod]) : 0], ['Elementary', elem],
                    ['Middle School', cMid >= 0 ? num(row[cMid]) : 0], ['High School', cHigh >= 0 ? num(row[cHigh]) : 0]];
    var any = false;
    perClass.forEach(function (pc) { if (pc[1]) { put(d, pc[0], pc[1]); amounts++; any = true; } });
    if (any) sundays++;
  }
  var elemFound = (cElem >= 0) ? 'y' : ((cLow >= 0 || cUp >= 0) ? 'y(lower/upper)' : 'n');
  var msg = 'Imported ' + sundays + ' Sundays, ' + amounts + ' class amounts. Columns found → Toddler:' +
    (cTod >= 0 ? 'y' : 'n') + ' Elementary:' + elemFound + ' Middle:' + (cMid >= 0 ? 'y' : 'n') +
    ' High:' + (cHigh >= 0 ? 'y' : 'n');
  Logger.log(msg);
  return msg;
}

/* ---------------------------------------------------------------- test seed */

/**
 * Run once from the editor to create the tabs and load FAKE sample data so you
 * can test roles/flows before entering any real records. Uses no PII.
 * IMPORTANT: it adds the current user as an admin so you can get in.
 */
function seedSampleData() {
  Object.keys(SCHEMA).forEach(tab => sheet_(tab)); // ensure tabs + headers

  const me = domainEmail_() || 'you@example.com';
  const members = [
    [me, 'You (Admin)', 'admin', shortToken_()],
    ['coleader@example.com', 'Sample Co-Leader', 'co_leader', shortToken_()],
    ['teacher@example.com', 'Sample Teacher', 'teacher', shortToken_()],
    ['coteacher@example.com', 'Sample Co-Teacher', 'co_teacher', shortToken_()],
    ['treasurer@example.com', 'Sample Treasurer', 'treasurer', shortToken_()],
    ['board@example.com', 'Sample Board Rep', 'board_rep', shortToken_()],
  ];
  const msh = sheet_(TABS.MEMBERS);
  members.forEach(row => { if (findRowNum_(TABS.MEMBERS, row[0]) < 0) msh.appendRow(row); });

  const epicId = uuid_();
  if (readTable_(TABS.EPICS).length === 0) {
    insert_(TABS.EPICS, { id: epicId, name: "Children's Sunday 2027", type: "Children's Sunday", event_date: '2027-04-25', status: 'Planning', notes: 'Sample epic' });
    [
      ['Organize teachers meeting', 'Sample Co-Leader', '-6w', 'High'],
      ['Order trophies and certificates', 'Sample Treasurer', '-4w', 'Medium'],
      ['Book soundcheck with media', 'You (Admin)', '-1w', 'High'],
      ['Prepare class pictures', 'Sample Teacher', '-3w', 'Medium'],
    ].forEach(t => insert_(TABS.TASKS, {
      id: uuid_(), epic_id: epicId, title: t[0], owner: t[1], due_offset: t[2],
      due_date: '', status: 'Pending', priority: t[3], notes: '',
    }));
    insert_(TABS.FEEDBACK, { id: uuid_(), epic_id: epicId, text: 'Audio was not great — assign a soundcheck owner', converted: '', converted_task_id: '' });
  }
  return 'Seeded. Open the web app URL to use it.';
}
