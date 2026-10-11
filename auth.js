/* ============================================
   HCI Multi-User Auth Module
   ============================================ */
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const os = require('os');
const rbac = require('./lib/rbac');

// HCI_AUTH_HOME lets tests (and isolated deployments) point the user store elsewhere.
const HERMES_HOME = process.env.HCI_AUTH_HOME || path.join(os.homedir(), '.hermes');
const USERS_FILE = path.join(HERMES_HOME, 'hci-users.json');
const AUDIT_FILE = path.join(HERMES_HOME, 'hci-audit.log');
const SALT_ROUNDS = 10;

// Username validation — prevent injection and log corruption
function sanitizeUsername(name) {
  const s = String(name || '').trim();
  if (s.length < 2 || s.length > 32) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(s)) return null;
  return s;
}

// ============================================
// User Store
// ============================================
// mtime/size keyed cache: the store is consulted on every request (the principal is rebuilt per
// request so role/profile/expiry changes apply immediately) without re-parsing JSON each time.
let _usersCache = { key: '', data: null };
function loadUsers() {
  try {
    const st = fs.statSync(USERS_FILE);
    const key = `${st.mtimeMs}:${st.size}`;
    if (_usersCache.data && _usersCache.key === key) return JSON.parse(JSON.stringify(_usersCache.data));
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    _usersCache = { key, data };
    return JSON.parse(JSON.stringify(data));
  } catch {
    return { users: [] };
  }
}

function saveUsers(data) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
  _usersCache = { key: '', data: null };
}

function isFirstRun() {
  const data = loadUsers();
  return data.users.length === 0;
}

function findUser(username) {
  const data = loadUsers();
  return data.users.find(u => u.username === username) || null;
}

/**
 * options: { allowed_boards, reviewer_scope: {task_ids}, expires_at, permissions }
 * Restricted roles (demo-viewer, reviewer) are validated: explicit profiles + boards (no '*'),
 * reviewer needs an explicit task list, expires_at required (<= 7 days).
 */
function createUser(username, password, role = 'viewer', allowed_profiles = ['*'], options = {}) {
  const clean = sanitizeUsername(username);
  if (!clean) return { ok: false, error: 'Invalid username (2-32 chars, alphanumeric/_.- only)' };
  if (!rbac.ROLES.includes(role)) return { ok: false, error: 'Invalid role' };
  const data = loadUsers();
  if (data.users.find(u => u.username === clean)) {
    return { ok: false, error: 'Username already exists' };
  }
  const restricted = rbac.isRestrictedRole(role);
  const record = {
    username: clean,
    password_hash: null,
    role,
    allowed_profiles: role === 'admin' ? ['*'] : allowed_profiles,
    created_at: new Date().toISOString(),
    last_login: null,
  };
  if (restricted || options.allowed_boards) record.allowed_boards = options.allowed_boards;
  if (role === 'reviewer' || options.reviewer_scope) record.reviewer_scope = options.reviewer_scope;
  if (restricted || options.expires_at) record.expires_at = options.expires_at;
  if (role === 'custom' && options.permissions) record.permissions = options.permissions;
  if (restricted) {
    const err = rbac.validateRestrictedAccount(record);
    if (err) return { ok: false, error: err };
  } else if (record.expires_at && !Number.isFinite(Date.parse(record.expires_at))) {
    return { ok: false, error: 'expires_at is not a valid ISO timestamp' };
  }
  record.password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
  data.users.push(record);
  saveUsers(data);
  audit('system', 'admin', 'USER_CREATE', `created user ${clean} (${role}) profiles=${JSON.stringify(record.allowed_profiles)}` +
    (restricted ? ` boards=${JSON.stringify(record.allowed_boards)} expires=${record.expires_at}` : ''));
  return { ok: true };
}

function updateUserProfiles(username, allowed_profiles, currentUser) {
  const data = loadUsers();
  const user = data.users.find(u => u.username === username);
  if (!user) return { ok: false, error: 'User not found' };
  if (!Array.isArray(allowed_profiles)) return { ok: false, error: 'allowed_profiles must be an array' };
  const err = rbac.validateRestrictedAccount({ ...user, allowed_profiles });
  if (err) return { ok: false, error: err };
  user.allowed_profiles = allowed_profiles;
  saveUsers(data);
  audit(currentUser, 'admin', 'USER_UPDATE_PROFILES', `${username} profiles=${JSON.stringify(allowed_profiles)}`);
  return { ok: true };
}

// Legacy signature kept: accepts a stored user record or a principal.
function canAccessProfile(user, profileName) {
  if (!user) return false; // fail closed: unknown user has no profile access
  return rbac.canAccessProfile(user, profileName);
}

function deleteUser(username, currentUser) {
  if (username === currentUser) {
    return { ok: false, error: 'Cannot delete yourself' };
  }
  const data = loadUsers();
  const idx = data.users.findIndex(u => u.username === username);
  if (idx === -1) return { ok: false, error: 'User not found' };

  // Check if last admin
  const user = data.users[idx];
  if (user.role === 'admin') {
    const adminCount = data.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      return { ok: false, error: 'Cannot delete the last admin' };
    }
  }

  data.users.splice(idx, 1);
  saveUsers(data);
  audit(currentUser, 'admin', 'USER_DELETE', `deleted user ${username}`);
  return { ok: true };
}

function verifyUserPassword(username, password) {
  const user = findUser(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  if (rbac.isExpired(user)) {
    audit(username, user.role, 'LOGIN_DENIED', 'account expired');
    return null;
  }

  // Update last_login
  const data = loadUsers();
  const u = data.users.find(x => x.username === username);
  if (u) {
    u.last_login = new Date().toISOString();
    saveUsers(data);
  }
  return user;
}

function changePassword(username, currentPassword, newPassword) {
  const user = verifyUserPassword(username, currentPassword);
  if (!user) return { ok: false, error: 'Current password is incorrect' };
  if (newPassword.length < 8) return { ok: false, error: 'Password must be at least 8 characters' };

  const data = loadUsers();
  const u = data.users.find(x => x.username === username);
  if (u) {
    u.password_hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    u.tokens_valid_after = Date.now();
    saveUsers(data);
  }
  audit(username, user.role, 'PASSWORD_CHANGE', 'changed own password');
  return { ok: true };
}

// ============================================
// Permissions (policy lives in lib/rbac.js)
// ============================================
const { PERMISSIONS, PRESET_PERMISSIONS, resolvePermissions } = rbac;

/**
 * Change role / permissions and (optionally) the access-scope fields in one validated write.
 * `access` may carry allowed_profiles, allowed_boards, reviewer_scope, expires_at.
 */
function updateUserPermissions(username, role, permissions, access = {}, actor = 'system') {
  const data = loadUsers();
  const u = data.users.find(x => x.username === username);
  if (!u) return { ok: false, error: 'User not found' };
  if (!rbac.ROLES.includes(role)) return { ok: false, error: 'Invalid role' };
  const candidate = { ...u, role };
  for (const k of ['allowed_profiles', 'allowed_boards', 'reviewer_scope', 'expires_at']) {
    if (access[k] !== undefined) candidate[k] = access[k];
  }
  if (role === 'admin') candidate.allowed_profiles = ['*'];
  const err = rbac.validateRestrictedAccount(candidate);
  if (err) return { ok: false, error: err };
  if (u.role === 'admin' && role !== 'admin') {
    const admins = data.users.filter(x => x.role === 'admin').length;
    if (admins <= 1) return { ok: false, error: 'Cannot demote the last admin' };
  }
  Object.assign(u, candidate);
  if (role === 'custom') {
    u.permissions = permissions || {};
  } else {
    delete u.permissions;
  }
  if (role !== 'reviewer') delete u.reviewer_scope;
  u.tokens_valid_after = Date.now(); // a role/scope change invalidates existing sessions
  saveUsers(data);
  audit(actor, 'admin', 'USER_UPDATE', `updated ${username} role to ${role}`);
  return { ok: true };
}

/**
 * Build the per-request principal from the CURRENT store contents.
 * Returns null for unknown or expired accounts (=> treated as unauthenticated), or when the
 * session token was issued before the account's tokens_valid_after (password/role change).
 */
function buildPrincipal(username, issuedAtMs) {
  const u = findUser(username);
  if (!u) return null;
  if (rbac.isExpired(u)) return null;
  if (issuedAtMs !== undefined && u.tokens_valid_after && Number(issuedAtMs) < u.tokens_valid_after) return null;
  return {
    username: u.username,
    role: u.role,
    permissions: resolvePermissions(u.role, u.permissions),
    allowed_profiles: u.allowed_profiles,
    allowed_boards: u.allowed_boards,
    reviewer_scope: u.reviewer_scope,
    expires_at: u.expires_at,
  };
}

function resetUserPassword(username, newPassword, adminUser) {
  if (newPassword.length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
  const data = loadUsers();
  const u = data.users.find(x => x.username === username);
  if (!u) return { ok: false, error: 'User not found' };
  u.password_hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
  u.tokens_valid_after = Date.now();
  saveUsers(data);
  audit(adminUser, 'admin', 'PASSWORD_RESET', `reset password for ${username}`);
  return { ok: true };
}

function listUsers() {
  const data = loadUsers();
  return data.users.map(u => ({
    username: u.username,
    role: u.role,
    created_at: u.created_at,
    last_login: u.last_login,
    allowed_profiles: u.allowed_profiles,
    allowed_boards: u.allowed_boards,
    reviewer_scope: u.reviewer_scope,
    expires_at: u.expires_at,
    expired: rbac.isExpired(u),
  }));
}

// ============================================
// Audit Log
// ============================================
function audit(username, role, action, details = '') {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${username}] [${role}] ${action}: ${String(details).replace(/[\r\n]+/g, ' ')}\n`;
  try {
    const dir = path.dirname(AUDIT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, line, 'utf8');
  } catch {}
}

function getAuditLog(limit = 100) {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const content = fs.readFileSync(AUDIT_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ============================================
// Notifications
// ============================================
const NOTIF_FILE = path.join(HERMES_HOME, 'hci-notifications.json');

function loadNotifications() {
  try {
    if (!fs.existsSync(NOTIF_FILE)) return [];
    return JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveNotifications(notifs) {
  const dir = path.dirname(NOTIF_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Keep last 100
  const trimmed = notifs.slice(-100);
  fs.writeFileSync(NOTIF_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
}

function addNotification(type, message) {
  const notifs = loadNotifications();
  notifs.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type, // error, warning, info, success
    message,
    timestamp: new Date().toISOString(),
    dismissed: false,
  });
  saveNotifications(notifs);
}

function dismissNotification(id) {
  const notifs = loadNotifications();
  const n = notifs.find(x => x.id === id);
  if (n) n.dismissed = true;
  saveNotifications(notifs);
}

function clearNotifications() {
  saveNotifications([]);
}

module.exports = {
  USERS_FILE,
  AUDIT_FILE,
  loadUsers,
  saveUsers,
  isFirstRun,
  findUser,
  createUser,
  deleteUser,
  verifyUserPassword,
  changePassword,
  resetUserPassword,
  sanitizeUsername,
  listUsers,
  updateUserPermissions,
  updateUserProfiles,
  canAccessProfile,
  buildPrincipal,
  rbac,
  PERMISSIONS,
  PRESET_PERMISSIONS,
  resolvePermissions,
  audit,
  getAuditLog,
  loadNotifications,
  addNotification,
  dismissNotification,
  clearNotifications,
};
