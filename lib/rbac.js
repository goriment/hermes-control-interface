/**
 * lib/rbac.js
 * ───────────
 * Pure (dependency-free) authorization policy for the Hermes Control Interface.
 *
 * Everything in here is a pure function of a "principal" and a request/resource,
 * so it can be unit-tested without booting the server.
 *
 * Principal shape (built by auth.js#buildPrincipal from the user store on EVERY request,
 * never cached from login time, so role/profile/expiry changes take effect immediately):
 *   {
 *     username, role,                       // role: admin | viewer | custom | demo-viewer | reviewer
 *     permissions: { 'perm.name': true },   // already resolved from role/preset
 *     allowed_profiles: [...] | undefined,  // '*' honoured only for admin + legacy roles
 *     allowed_boards:   [...] | undefined,  // kanban boards; undefined => legacy full access, restricted => none
 *     reviewer_scope:   { task_ids: [...] } // reviewer role only: the ONLY tasks it may see / act on
 *   }
 *
 * Rules:
 *   - admin: everything (behaviour preserved).
 *   - demo-viewer / reviewer ("restricted roles"): fixed presets (stored permissions are ignored),
 *     explicit allowed_profiles + allowed_boards REQUIRED (no '*'), expiry required, and a
 *     default-deny route allow-list (ROUTE_POLICY) applied before any route handler runs.
 *   - viewer / custom (legacy roles): permission checks on every sensitive route; legacy '*' kept.
 */
'use strict';

const path = require('path');
const fs = require('fs');

// ── Roles ───────────────────────────────────────────────────────────────────
const ROLES = ['admin', 'viewer', 'custom', 'demo-viewer', 'reviewer'];
const RESTRICTED_ROLES = new Set(['demo-viewer', 'reviewer']);
const MAX_RESTRICTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Permissions ─────────────────────────────────────────────────────────────
const PERMISSIONS = [
  'sessions.view', 'sessions.messages', 'sessions.delete',
  'chat.use', 'chat.manage',
  'logs.view', 'usage.view', 'usage.export',
  'gateway.view', 'gateway.control',
  'config.view', 'config.edit',
  'secrets.view', 'secrets.reveal', 'secrets.edit',
  'skills.browse', 'skills.install',
  'cron.view', 'cron.manage',
  'files.read', 'files.write',
  'terminal',
  'users.view', 'users.manage',
  'system.update', 'system.backup', 'system.doctor', 'system.restart',
  // Office / kanban board (added for least-privilege demo access)
  'office.view',     // read board, task detail, summary, agent states (profile/board filtered)
  'office.comment',  // add a human comment to a task in scope
  'office.decide',   // record a human decision on a task in scope (comment + hand back to queue)
  'office.manage',   // assign / change task state (done, reopen, unblock, start, reassign)
];

const PRESET_PERMISSIONS = {
  admin: PERMISSIONS.reduce((acc, p) => { acc[p] = true; return acc; }, {}),
  // Legacy preset. NOT demo-safe (chat.use, files.read). office.view added so existing
  // read-only viewers keep their board read access; they still cannot mutate tasks.
  viewer: {
    'sessions.view': true, 'sessions.messages': true, 'chat.use': true,
    'logs.view': true, 'usage.view': true, 'skills.browse': true, 'files.read': true,
    'office.view': true,
  },
  custom: {},
  // Read-only: approved board/status + usage/gateway status + skills catalogue. Nothing mutable.
  'demo-viewer': {
    'office.view': true, 'usage.view': true, 'gateway.view': true, 'skills.browse': true,
  },
  // demo-viewer + comment/decision on explicitly scoped tasks only.
  reviewer: {
    'office.view': true, 'office.comment': true, 'office.decide': true,
    'usage.view': true, 'gateway.view': true, 'skills.browse': true,
  },
};

function isRestrictedRole(role) { return RESTRICTED_ROLES.has(role); }

/** Resolve effective permissions. Restricted roles ignore anything stored on the user. */
function resolvePermissions(role, permissions) {
  if (role === 'admin') return { ...PRESET_PERMISSIONS.admin };
  if (isRestrictedRole(role)) return { ...PRESET_PERMISSIONS[role] };
  if (role === 'viewer') return { ...PRESET_PERMISSIONS.viewer };
  if (role === 'custom' && permissions && typeof permissions === 'object') {
    const out = {};
    for (const k of Object.keys(permissions)) {
      if (PERMISSIONS.includes(k) && permissions[k] === true) out[k] = true;
    }
    // Legacy alias: the old terminal route checked 'terminal.exec' (never in PERMISSIONS).
    if (permissions['terminal.exec'] === true) out.terminal = true;
    return out;
  }
  return { ...PRESET_PERMISSIONS.viewer };
}

// ── Principal helpers ───────────────────────────────────────────────────────
const isAdmin = (p) => !!p && p.role === 'admin';
const isRestricted = (p) => !!p && isRestrictedRole(p.role);

function hasPerm(p, perm) {
  if (!p) return false;
  if (p.role === 'admin') return true;
  return !!(p.permissions && p.permissions[perm] === true);
}

function listHas(list, name) {
  return Array.isArray(list) && list.includes(name);
}

/** Profile access. Restricted roles never get wildcard; empty/missing list => deny. */
function canAccessProfile(p, profile) {
  if (!p) return false;
  if (p.role === 'admin') return true;
  const list = p.allowed_profiles;
  const restricted = isRestricted(p);
  if (list === undefined || list === null) return !restricted; // legacy accounts without the field
  if (!Array.isArray(list) || list.length === 0) return false;
  if (!restricted && list.includes('*')) return true;
  if (!profile) return false;
  return list.includes(String(profile));
}

/** Board access. Restricted roles need an explicit list; legacy accounts without one keep full access. */
function canAccessBoard(p, board) {
  if (!p) return false;
  if (p.role === 'admin') return true;
  const list = p.allowed_boards;
  const restricted = isRestricted(p);
  if (list === undefined || list === null) return !restricted;
  if (!Array.isArray(list) || list.length === 0) return false;
  if (!restricted && list.includes('*')) return true;
  return list.includes(String(board));
}

function reviewerTaskIds(p) {
  const ids = p && p.reviewer_scope && Array.isArray(p.reviewer_scope.task_ids) ? p.reviewer_scope.task_ids : [];
  return new Set(ids.map(String));
}

/** May this principal see (read) this task on this board? */
function canSeeTask(p, board, task) {
  if (!p || !task) return false;
  if (p.role === 'admin') return true;
  if (!canAccessBoard(p, board)) return false;
  if (!canAccessProfile(p, task.assignee || '')) return false;
  if (p.role === 'reviewer') return reviewerTaskIds(p).has(String(task.id));
  return true;
}

/** Action → required permission for POST /api/office/kanban/:taskId/action */
const OFFICE_ACTION_PERMS = {
  comment: 'office.comment',
  respond: 'office.decide',
  decision: 'office.decide',
  unblock: 'office.manage',
  done: 'office.manage',
  reopen: 'office.manage',
  start: 'office.manage',
  reassign: 'office.manage',
};
/** Human-decision actions non-admins may only perform on tasks waiting for a human. */
const DECISION_ACTIONS = new Set(['respond', 'decision']);
const DECISION_STATUSES = new Set(['blocked', 'review']);

// ── Filesystem sensitivity ──────────────────────────────────────────────────
const SENSITIVE_TOP_DIRS = new Set([
  'kanban', 'vault', 'mcp-tokens', 'pairing', 'sessions', 'state', 'bot_relay', 'backups',
  'sandboxes', 'runtime', 'cron', 'platforms', 'pending_messages', 'control-interface', '.git', 'node_modules',
]);
const SENSITIVE_NAME = /^(\.env(\..*)?|auth\.json|auth\.lock|hci-users\.json|hci-audit\.log|hci-notifications\.json|\.api_key|\.netrc|\.npmrc|id_(rsa|ed25519|ecdsa)(\.pub)?|spawn-ledger\.json|processes\.json|channel_directory\.json|install_id)$/i;
const SENSITIVE_PATTERN = /(secret|credential|password|token|private[-_]?key)/i;
const SENSITIVE_EXT = /\.(db|db-shm|db-wal|sqlite3?|bak|pem|key|pfx|p12|kdbx)$/i;

/** True if `child` is `base` or inside it (separator-aware, unlike a bare startsWith). */
function isPathInside(base, child) {
  const b = path.resolve(base);
  const c = path.resolve(child);
  const rel = path.relative(b, c);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const IS_WIN = process.platform === 'win32';
const CASE_INSENSITIVE_FS = IS_WIN || process.platform === 'darwin';

/** Windows ignores trailing dots/spaces and NTFS stream suffixes (name:stream) in a path component. */
function foldSegment(seg) {
  let s = String(seg);
  if (IS_WIN) s = s.replace(/:.*$/, '').replace(/[. ]+$/, '');
  return s;
}

/**
 * Resolve symlinks/junctions/8.3 names/case on the deepest existing ancestor of `abs`, and
 * re-attach the not-yet-existing remainder. Never throws.
 */
function canonicalize(abs) {
  const resolved = path.resolve(abs);
  const rest = [];
  let cur = resolved;
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return resolved;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function cmpKey(s) { return CASE_INSENSITIVE_FS ? String(s).toLowerCase() : String(s); }

/** Segments of `abs` below `home` (original case), [] if equal, null if not inside. */
function relParts(home, abs) {
  const h = path.resolve(home);
  const a = path.resolve(abs);
  const rel = path.relative(cmpKey(h), cmpKey(a));
  if (rel === '') return [];
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return a.slice(h.length).split(/[\\/]+/).filter(Boolean);
}

/**
 * Is `absPath` off-limits for this principal? Admin: never. Everyone else: credential /
 * state / other-profile material is denied even when files.read is granted.
 * The path is canonicalised (realpath.native on the deepest existing ancestor), compared
 * case-insensitively on Windows/macOS, and anything under the Hermes root that is not
 * positively allowed is denied (fail closed).
 */
function isSensitivePath(p, absPath, hermesHome) {
  if (p && p.role === 'admin') return false;
  const lexical = path.resolve(absPath);
  const canon = canonicalize(lexical);
  for (const candidate of canon === lexical ? [lexical] : [lexical, canon]) {
    const segs = candidate.split(/[\\/]+/).filter(Boolean).map(foldSegment);
    for (const s of segs) {
      if (SENSITIVE_NAME.test(s) || SENSITIVE_EXT.test(s) || SENSITIVE_PATTERN.test(s)) return true;
    }
  }
  if (!hermesHome) return false;
  const homeLex = path.resolve(hermesHome);
  const homeCanon = canonicalize(homeLex);
  const lexInside = relParts(homeLex, lexical) !== null || relParts(homeCanon, lexical) !== null;
  const parts = relParts(homeCanon, canon);
  if (parts === null) return lexInside; // under the Hermes root lexically but resolves elsewhere (junction escape)
  const folded = parts.map(foldSegment);
  if (!folded.length) return false;
  const top = folded[0].toLowerCase();
  if (SENSITIVE_TOP_DIRS.has(top)) return true;
  if (top === 'profiles') {
    if (folded.length === 1) return false; // the directory listing itself; entries are filtered individually
    // profile names are matched case-insensitively on case-insensitive filesystems
    const name = CASE_INSENSITIVE_FS ? folded[1].toLowerCase() : folded[1];
    const allowed = CASE_INSENSITIVE_FS
      ? canAccessProfileFolded(p, name)
      : canAccessProfile(p, name);
    if (!allowed) return true;
    return SENSITIVE_TOP_DIRS.has((folded[2] || '').toLowerCase());
  }
  // Default-profile access never grants arbitrary control-plane directories.
  const allowedDefaultEntries = new Set(['memories', 'skills', 'config.yaml', 'soul.md', 'agents.md', 'notes.txt']);
  return !canAccessProfile(p, 'default') || !allowedDefaultEntries.has(top);
}

/** canAccessProfile with case-insensitive profile-name matching (NTFS/APFS). */
function canAccessProfileFolded(p, lowerName) {
  if (!p) return false;
  if (p.role === 'admin') return true;
  const list = p.allowed_profiles;
  const restricted = isRestricted(p);
  if (list === undefined || list === null) return !restricted;
  if (!Array.isArray(list) || list.length === 0) return false;
  if (!restricted && list.includes('*')) return true;
  return list.some((x) => String(x).toLowerCase() === lowerName);
}

// ── Default-deny route allow-list for restricted roles ──────────────────────
// [method, regex on req.path, required permission (null = any authenticated restricted user)]
const ROUTE_POLICY = [
  ['GET', /^\/api\/(auth\/me|session|permissions|health|models|profiles|avatar|avatar\/image)$/, null],
  ['POST', /^\/api\/auth\/(logout|change-password)$/, null],
  // /api/usage, /api/insights and /usage aggregate ALL profiles => never reachable by profile-scoped
  // roles. Per-day usage is reachable only with an explicit ?profile= that passes the profile check
  // (enforced in the route via requireProfileScopedQuery).
  ['GET', /^\/api\/usage\/(daily\/)?\d+$/, 'usage.view'],
  ['GET', /^\/api\/insights\/[A-Za-z0-9_-]+\/\d+$/, 'usage.view'],
  ['GET', /^\/api\/gateway\/[A-Za-z0-9_-]+(\/(connections|health))?$/, 'gateway.view'],
  ['GET', /^\/api\/system\/health$/, 'gateway.view'], // host metrics only; /api/monitoring (process list) excluded
  ['GET', /^\/api\/skills(\/(browse\/[^/]+|search\/[^/]+|inspect\/[^/]+|list\/[A-Za-z0-9_-]+))?$/, 'skills.browse'],
  ['GET', /^\/api\/office\/(departments|summary|agent-states|kanban|kanban\/boards|kanban\/[A-Za-z0-9_-]+)$/, 'office.view'],
  // Fine-grained (per-action permission, scope, task status) enforcement happens in the route.
  ['POST', /^\/api\/office\/kanban\/[A-Za-z0-9_-]+\/action$/, 'office.comment|office.decide'],
];

/**
 * Evaluate the allow-list for a restricted principal.
 * @returns {{allowed:boolean, reason?:string}}
 */
function policyCheck(p, method, reqPath) {
  if (!isRestricted(p)) return { allowed: true };
  const m = String(method || 'GET').toUpperCase();
  const effective = m === 'HEAD' ? 'GET' : m;
  for (const [rm, re, perm] of ROUTE_POLICY) {
    if (rm !== effective || !re.test(reqPath)) continue;
    if (!perm) return { allowed: true };
    const anyOf = perm.split('|');
    if (anyOf.some((x) => hasPerm(p, x))) return { allowed: true };
    return { allowed: false, reason: `permission required: ${anyOf.join(' or ')}` };
  }
  return { allowed: false, reason: 'route not available to this role' };
}

// ── Account validation ──────────────────────────────────────────────────────
/**
 * Validate the access fields of a restricted-role account. Returns an error string or null.
 * `now` is injectable for tests.
 */
function validateRestrictedAccount(acct, now = Date.now()) {
  if (!acct || !isRestrictedRole(acct.role)) return null;
  const profiles = acct.allowed_profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) return `${acct.role} requires a non-empty allowed_profiles list`;
  if (profiles.includes('*')) return `${acct.role} must not use wildcard "*" in allowed_profiles`;
  if (!profiles.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x))) return 'allowed_profiles contains an invalid profile name';
  const boards = acct.allowed_boards;
  if (!Array.isArray(boards) || boards.length === 0) return `${acct.role} requires a non-empty allowed_boards list`;
  if (boards.includes('*')) return `${acct.role} must not use wildcard "*" in allowed_boards`;
  if (!boards.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x))) return 'allowed_boards contains an invalid board name';
  if (acct.role === 'reviewer') {
    const ids = acct.reviewer_scope && acct.reviewer_scope.task_ids;
    if (!Array.isArray(ids) || ids.length === 0) return 'reviewer requires reviewer_scope.task_ids (explicit task list)';
    if (!ids.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x))) return 'reviewer_scope.task_ids contains an invalid task id';
  }
  if (!acct.expires_at) return `${acct.role} requires expires_at (max 7 days)`;
  const exp = Date.parse(acct.expires_at);
  if (!Number.isFinite(exp)) return 'expires_at is not a valid ISO timestamp';
  if (exp <= now) return 'expires_at is in the past';
  if (exp > now + MAX_RESTRICTED_TTL_MS) return 'expires_at exceeds the 7-day maximum for demo accounts';
  return null;
}

function isExpired(acct, now = Date.now()) {
  if (!acct || !acct.expires_at) return false;
  const exp = Date.parse(acct.expires_at);
  return !Number.isFinite(exp) || exp <= now; // unparseable => fail closed
}

module.exports = {
  ROLES, RESTRICTED_ROLES, MAX_RESTRICTED_TTL_MS,
  PERMISSIONS, PRESET_PERMISSIONS, resolvePermissions,
  isRestrictedRole, isAdmin, isRestricted, hasPerm,
  canAccessProfile, canAccessBoard, canSeeTask, reviewerTaskIds,
  OFFICE_ACTION_PERMS, DECISION_ACTIONS, DECISION_STATUSES,
  isPathInside, isSensitivePath,
  ROUTE_POLICY, policyCheck,
  validateRestrictedAccount, isExpired,
};
