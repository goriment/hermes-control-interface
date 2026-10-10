'use strict';
/**
 * Authorization tests (allow + deny) for the Hermes Control Interface.
 *
 * Boots the REAL server.js against a throw-away HOME (HERMES_CONTROL_HOME/HCI_AUTH_HOME/USERPROFILE
 * all point at a temp dir), seeds two kanban boards + two profiles, creates users of every role and
 * drives the HTTP/WS API directly — i.e. exactly what a hostile client bypassing the UI would do.
 *
 * Run: node --test test/rbac.test.js   (needs the Node ABI better-sqlite3 was built for)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'hci-rbac-'));
const HOME = SANDBOX;
const HH = path.join(HOME, '.hermes');
const SECRET = 'test-secret-' + 'x'.repeat(40);
const ADMIN_PW = 'admin-pass-12345';
const USER_PW = 'user-pass-12345';

// auth.js must see the sandbox store BEFORE it is required.
process.env.HCI_AUTH_HOME = HH;
const auth = require('../auth');
const rbac = require('../lib/rbac');
const Database = require('better-sqlite3');

const FUTURE = () => new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

// ───────────────────────── fixtures ─────────────────────────
function seedKanban(board, tasks) {
  const dir = path.join(HH, 'kanban', 'boards', board);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'kanban.db'));
  db.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL,
      priority INTEGER DEFAULT 0, created_by TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER,
      workspace_kind TEXT DEFAULT 'scratch', workspace_path TEXT, claim_lock TEXT, claim_expires INTEGER, result TEXT,
      worker_pid INTEGER, current_run_id INTEGER, block_kind TEXT, last_failure_error TEXT);
    CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
    CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, run_id INTEGER, kind TEXT, payload TEXT, created_at INTEGER);
    CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT, status TEXT, summary TEXT, error TEXT, metadata TEXT, started_at INTEGER, ended_at INTEGER);
    CREATE TABLE task_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, filename TEXT, content_type TEXT, size INTEGER, uploaded_by TEXT, created_at INTEGER, path TEXT);
    CREATE TABLE task_links (parent_id TEXT, child_id TEXT);
  `);
  const ins = db.prepare('INSERT INTO tasks (id,title,body,assignee,status,priority,created_by,created_at,workspace_path,claim_lock,worker_pid) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const now = Math.floor(Date.now() / 1000);
  for (const t of tasks) ins.run(t.id, t.title, 'body of ' + t.id, t.assignee, t.status, 1, 'seed', now, 'C:/secret/workspace/' + t.id, 'lock-' + t.id, 4242);
  db.prepare('INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,?,?)').run('d1', 'blocked', JSON.stringify({ reason: 'need a human', pid: 4242 }), now);
  db.prepare('INSERT INTO task_runs (task_id, profile, status, metadata, started_at) VALUES (?,?,?,?,?)').run('d1', 'alpha', 'blocked', JSON.stringify({ lock: 'x' }), now);
  db.prepare('INSERT INTO task_links (parent_id, child_id) VALUES (?,?)').run('d1', 'd3');
  db.prepare('INSERT INTO task_links (parent_id, child_id) VALUES (?,?)').run('d1', 'd2');
  db.close();
}

function seedProfile(name) {
  const dir = path.join(HH, 'profiles', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), `model:\n  default: test-model\n  provider: test\n`);
  fs.writeFileSync(path.join(dir, '.env'), `${name.toUpperCase()}_API_KEY=sk-${name}-supersecretvalue1234\n`);
  fs.mkdirSync(path.join(dir, 'memories'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memories', 'MEMORY.md'), `memory of ${name}`);
  const db = new Database(path.join(dir, 'state.db'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, model TEXT, title TEXT, parent_session_id TEXT, started_at INTEGER, ended_at INTEGER,
      message_count INTEGER, tool_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, estimated_cost_usd REAL, billing_provider TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, reasoning TEXT, finish_reason TEXT);
  `);
  db.prepare('INSERT INTO sessions (id,source,model,title,started_at,message_count) VALUES (?,?,?,?,?,?)').run(`sess_${name}`, 'cli', 'm', `session of ${name}`, Math.floor(Date.now() / 1000), 1);
  db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)').run(`sess_${name}`, 'user', `private message in ${name}`, Date.now() / 1000);
  db.close();
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs', 'agent.log'), `[2026-10-10T00:00:00Z] [INFO] [agent] log line from ${name}\n`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

// ───────────────────────── harness ─────────────────────────
let server; let BASE; let PORT;

async function startServer() {
  fs.mkdirSync(HH, { recursive: true });
  fs.writeFileSync(path.join(HH, '.env'), 'ROOT_SECRET=root-level-secret-value\n');
  fs.writeFileSync(path.join(HH, 'notes.txt'), 'harmless notes');
  fs.writeFileSync(path.join(HH, 'config.yaml'), 'model:\n  default: test-model\n  provider: test\n');
  seedProfile('alpha'); seedProfile('beta');
  seedKanban('demo', [
    { id: 'd1', title: 'Needs human decision', assignee: 'alpha', status: 'blocked' },
    { id: 'd2', title: 'Alpha running', assignee: 'alpha', status: 'running' },
    { id: 'd3', title: 'Beta private task', assignee: 'beta', status: 'ready' },
    { id: 'd4', title: 'Alpha done', assignee: 'alpha', status: 'done' },
  ]);
  seedKanban('secretboard', [{ id: 's1', title: 'Secret board task', assignee: 'alpha', status: 'ready' }]);
  fs.writeFileSync(path.join(HH, 'control-interface-departments.json'), '{}');

  auth.createUser('admin', ADMIN_PW, 'admin');
  const mk = (name, role, profiles, opts = {}) => {
    const r = auth.createUser(name, USER_PW, role, profiles, opts);
    assert.ok(r.ok, `${name}: ${r.error}`);
  };
  mk('demo', 'demo-viewer', ['alpha'], { allowed_boards: ['demo'], expires_at: FUTURE() });
  mk('rev', 'reviewer', ['alpha'], { allowed_boards: ['demo'], reviewer_scope: { task_ids: ['d1'] }, expires_at: FUTURE() });
  mk('legacyviewer', 'viewer', ['alpha']);
  mk('cust-none', 'custom', ['*'], { permissions: {} });
  mk('cust-files', 'custom', ['alpha'], { permissions: { 'files.read': true } });
  mk('cust-write', 'custom', ['*'], { permissions: { 'files.read': true, 'files.write': true } });
  mk('cust-sess', 'custom', ['alpha'], { permissions: { 'sessions.view': true, 'sessions.messages': true, 'logs.view': true, 'secrets.view': true, 'config.view': true } });
  mk('cust-term', 'custom', ['*'], { permissions: { terminal: false } });

  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  const env = {
    ...process.env,
    HOME, USERPROFILE: HOME, HERMES_HOME: HH, HERMES_CONTROL_HOME: HH, HCI_AUTH_HOME: HH,
    HERMES_CONTROL_ROOTS: HH,
    HERMES_CONTROL_PASSWORD: 'unused-pass', HERMES_CONTROL_SECRET: SECRET, GATEWAY_API_KEY: 'x',
    PORT: String(PORT), HOST: '127.0.0.1',
    HCI_LOGIN_RATE_MAX: '100000', HCI_GLOBAL_RATE_MAX: '1000000',
  };
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', (d) => { logs += d; });
  server.stderr.on('data', (d) => { logs += d; });
  server.on('exit', (code) => { if (code && code !== null) logs += `\n[server exited ${code}]`; });
  const deadline = Date.now() + 40000;
  for (;;) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline || server.exitCode !== null) throw new Error('server failed to start:\n' + logs.slice(-3000));
    await new Promise((r) => setTimeout(r, 250));
  }
}

function stopServer() {
  if (server && server.exitCode === null) server.kill();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
}

class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async login(username, password) {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const body = await r.json().catch(() => ({}));
    if (r.status === 200) {
      const sc = r.headers.get('set-cookie') || '';
      this.cookie = sc.split(';')[0];
      this.csrf = body.csrfToken;
    }
    return { status: r.status, body };
  }
  async req(method, url, body, { csrf = true, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (csrf && this.csrf) h['x-csrf-token'] = this.csrf;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text };
  }
  get(url, opts) { return this.req('GET', url, undefined, opts); }
  post(url, body, opts) { return this.req('POST', url, body === undefined ? {} : body, opts); }
  put(url, body, opts) { return this.req('PUT', url, body === undefined ? {} : body, opts); }
  del(url, opts) { return this.req('DELETE', url, undefined, opts); }
}

async function loggedIn(user, pw = USER_PW) {
  const c = new Client();
  const r = await c.login(user, pw);
  assert.equal(r.status, 200, `login ${user}: ${JSON.stringify(r.body)}`);
  return c;
}

const clients = {};
test.before(async () => {
  await startServer();
  clients.admin = await loggedIn('admin', ADMIN_PW);
  for (const u of ['demo', 'rev', 'legacyviewer', 'cust-none', 'cust-files', 'cust-write', 'cust-sess', 'cust-term']) clients[u] = await loggedIn(u);
});
test.after(stopServer);

const DENY = [403];
const expectDenied = async (c, method, url, body, label) => {
  const r = await c.req(method, url, body);
  assert.ok(DENY.includes(r.status), `${label || method + ' ' + url} expected 403, got ${r.status}: ${r.text.slice(0, 200)}`);
  return r;
};

// ───────────────────────── unit: policy ─────────────────────────
test('unit: restricted accounts need explicit profiles, boards, expiry (<=7d), reviewer scope', () => {
  const base = { role: 'demo-viewer', allowed_profiles: ['a'], allowed_boards: ['b'], expires_at: FUTURE() };
  assert.equal(rbac.validateRestrictedAccount(base), null);
  assert.match(rbac.validateRestrictedAccount({ ...base, allowed_profiles: ['*'] }), /wildcard/);
  assert.match(rbac.validateRestrictedAccount({ ...base, allowed_profiles: [] }), /non-empty/);
  assert.match(rbac.validateRestrictedAccount({ ...base, allowed_boards: undefined }), /allowed_boards/);
  assert.match(rbac.validateRestrictedAccount({ ...base, allowed_boards: ['*'] }), /wildcard/);
  assert.match(rbac.validateRestrictedAccount({ ...base, expires_at: undefined }), /expires_at/);
  assert.match(rbac.validateRestrictedAccount({ ...base, expires_at: new Date(Date.now() - 1000).toISOString() }), /past/);
  assert.match(rbac.validateRestrictedAccount({ ...base, expires_at: new Date(Date.now() + 8 * 864e5).toISOString() }), /7-day/);
  assert.match(rbac.validateRestrictedAccount({ ...base, role: 'reviewer' }), /reviewer_scope/);
  assert.equal(rbac.validateRestrictedAccount({ ...base, role: 'reviewer', reviewer_scope: { task_ids: ['t1'] } }), null);
  assert.equal(rbac.validateRestrictedAccount({ role: 'admin' }), null);
});

test('unit: stored permissions are ignored for restricted roles; custom ignores unknown keys', () => {
  const p = rbac.resolvePermissions('demo-viewer', { terminal: true, 'files.write': true });
  assert.equal(p.terminal, undefined);
  assert.equal(p['files.write'], undefined);
  assert.equal(p['office.view'], true);
  assert.equal(rbac.PRESET_PERMISSIONS['demo-viewer']['office.comment'], undefined);
  assert.equal(rbac.PRESET_PERMISSIONS.reviewer['office.manage'], undefined);
  assert.deepEqual(rbac.resolvePermissions('custom', { 'bogus.perm': true, 'files.read': true }), { 'files.read': true });
  assert.equal(rbac.resolvePermissions('custom', { 'terminal.exec': true }).terminal, true); // legacy alias
});

test('unit: profile/board/task visibility', () => {
  const demo = { role: 'demo-viewer', allowed_profiles: ['alpha'], allowed_boards: ['demo'] };
  assert.equal(rbac.canAccessProfile(demo, 'alpha'), true);
  assert.equal(rbac.canAccessProfile(demo, 'beta'), false);
  assert.equal(rbac.canAccessProfile({ ...demo, allowed_profiles: ['*'] }, 'beta'), false, 'wildcard ignored for restricted');
  assert.equal(rbac.canAccessProfile({ role: 'custom', allowed_profiles: ['*'] }, 'beta'), true);
  assert.equal(rbac.canAccessProfile({ role: 'custom' }, 'beta'), true, 'legacy account without field');
  assert.equal(rbac.canAccessProfile({ role: 'demo-viewer' }, 'beta'), false, 'restricted without field => deny');
  assert.equal(rbac.canAccessProfile({ role: 'custom', allowed_profiles: [] }, 'beta'), false, 'empty => deny');
  assert.equal(rbac.canAccessProfile(null, 'beta'), false);
  assert.equal(rbac.canAccessBoard(demo, 'demo'), true);
  assert.equal(rbac.canAccessBoard(demo, 'other'), false);
  const rev = { role: 'reviewer', allowed_profiles: ['alpha'], allowed_boards: ['demo'], reviewer_scope: { task_ids: ['d1'] } };
  assert.equal(rbac.canSeeTask(rev, 'demo', { id: 'd1', assignee: 'alpha' }), true);
  assert.equal(rbac.canSeeTask(rev, 'demo', { id: 'd2', assignee: 'alpha' }), false, 'not in reviewer scope');
  assert.equal(rbac.canSeeTask(rev, 'demo', { id: 'd1', assignee: 'beta' }), false, 'wrong profile');
  assert.equal(rbac.canSeeTask(rev, 'other', { id: 'd1', assignee: 'alpha' }), false, 'wrong board');
  assert.equal(rbac.canSeeTask(demo, 'demo', { id: 'dX', assignee: 'alpha' }), true);
});

test('unit: sensitive path detection', () => {
  const hh = path.join(HOME, '.hermes');
  const alpha = { role: 'custom', allowed_profiles: ['alpha'] };
  const all = { role: 'custom', allowed_profiles: ['*'] };
  const j = (...p) => path.join(hh, ...p);
  for (const u of [alpha, all]) {
    for (const p of ['.env', 'auth.json', 'hci-users.json', 'state.db', 'kanban/boards/x/kanban.db', 'vault/x', 'sessions/x.json', 'profiles/alpha/.env', 'profiles/alpha/state.db', 'profiles/alpha/sandboxes/x', 'mcp-tokens/t', 'a/client_secret.json', 'a/api_token.txt']) {
      assert.equal(rbac.isSensitivePath(u, j(...p.split('/')), hh), true, `${p} must be sensitive`);
    }
  }
  assert.equal(rbac.isSensitivePath(alpha, j('profiles', 'beta', 'config.yaml'), hh), true);
  assert.equal(rbac.isSensitivePath(alpha, j('profiles', 'alpha', 'config.yaml'), hh), false);
  assert.equal(rbac.isSensitivePath(alpha, j('notes.txt'), hh), true, 'root files belong to default profile');
  assert.equal(rbac.isSensitivePath(all, j('notes.txt'), hh), false);
  assert.equal(rbac.isSensitivePath({ role: 'admin' }, j('.env'), hh), false, 'admin unaffected');
  assert.equal(rbac.isPathInside(hh, hh + '-evil'), false, 'sibling prefix is not inside');
});

// ───────────────────────── account lifecycle ─────────────────────────
test('createUser enforces restricted-role validation; stored permissions cannot escalate', () => {
  assert.equal(auth.createUser('bad1', USER_PW, 'demo-viewer', ['*'], { allowed_boards: ['demo'], expires_at: FUTURE() }).ok, false);
  assert.equal(auth.createUser('bad2', USER_PW, 'demo-viewer', ['alpha'], { allowed_boards: ['demo'] }).ok, false, 'expiry required');
  assert.equal(auth.createUser('bad3', USER_PW, 'reviewer', ['alpha'], { allowed_boards: ['demo'], expires_at: FUTURE() }).ok, false, 'scope required');
  assert.equal(auth.createUser('bad4', USER_PW, 'nonsense', ['alpha']).ok, false);
  assert.equal(auth.findUser('bad1'), null);
});

test('expired account cannot log in and live sessions die immediately', async () => {
  assert.ok(auth.createUser('shortlived', USER_PW, 'demo-viewer', ['alpha'], { allowed_boards: ['demo'], expires_at: FUTURE() }).ok);
  const c = await loggedIn('shortlived');
  assert.equal((await c.get('/api/office/kanban?board=demo')).status, 200);
  const data = auth.loadUsers();
  data.users.find((u) => u.username === 'shortlived').expires_at = new Date(Date.now() - 1000).toISOString();
  auth.saveUsers(data);
  assert.equal((await c.get('/api/office/kanban?board=demo')).status, 401, 'existing cookie rejected after expiry');
  assert.equal((await new Client().login('shortlived', USER_PW)).status, 401, 'login refused after expiry');
});

test('logout, password reset and role change revoke existing sessions', async () => {
  assert.ok(auth.createUser('revoke1', USER_PW, 'demo-viewer', ['alpha'], { allowed_boards: ['demo'], expires_at: FUTURE() }).ok);
  const a = await loggedIn('revoke1');
  assert.equal((await a.post('/api/auth/logout')).status, 200);
  assert.equal((await a.get('/api/auth/me')).status, 401, 'logged-out token rejected');

  const b = await loggedIn('revoke1');
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(auth.resetUserPassword('revoke1', 'another-pass-123', 'admin').ok);
  assert.equal((await b.get('/api/auth/me')).status, 401, 'password reset kills sessions');

  const c = await loggedIn('revoke1', 'another-pass-123');
  await new Promise((r) => setTimeout(r, 15));
  const w = auth.loadUsers();
  const u = w.users.find((x) => x.username === 'revoke1');
  u.role = 'demo-viewer'; u.tokens_valid_after = Date.now(); auth.saveUsers(w);
  assert.equal((await c.get('/api/auth/me')).status, 401, 'tokens_valid_after kills sessions');
});

test('role/profile changes apply on the very next request (no stale login-time permissions)', async () => {
  assert.ok(auth.createUser('live1', USER_PW, 'custom', ['*'], { permissions: { 'files.read': true } }).ok);
  const c = await loggedIn('live1');
  assert.equal((await c.get('/api/file?path=notes.txt')).status, 200);
  const d = auth.loadUsers();
  d.users.find((x) => x.username === 'live1').permissions = {};
  auth.saveUsers(d);
  assert.equal((await c.get('/api/file?path=notes.txt')).status, 403, 'permission removal effective without re-login');
});

test('forged stored permissions on a demo-viewer record do not grant anything', async () => {
  assert.ok(auth.createUser('forged', USER_PW, 'demo-viewer', ['alpha'], { allowed_boards: ['demo'], expires_at: FUTURE() }).ok);
  const d = auth.loadUsers();
  d.users.find((x) => x.username === 'forged').permissions = { terminal: true, 'files.write': true, 'config.edit': true, 'office.manage': true };
  auth.saveUsers(d);
  const c = await loggedIn('forged');
  await expectDenied(c, 'POST', '/api/terminal/ensure', {});
  await expectDenied(c, 'POST', '/api/workspace/file', { path: 'x', content: 'y' });
  await expectDenied(c, 'POST', '/api/office/kanban/d2/action?board=demo', { action: 'done' });
});

// ───────────────────────── unauthenticated ─────────────────────────
test('unauthenticated: every protected route is 401', async () => {
  const anon = new Client();
  const routes = [
    ['GET', '/api/office/kanban?board=demo'], ['GET', '/api/office/kanban/d1?board=demo'], ['GET', '/api/office/summary?board=demo'],
    ['GET', '/api/office/agent-states'], ['GET', '/api/office/events'], ['GET', '/api/office/departments'],
    ['POST', '/api/office/kanban/d1/action?board=demo', { action: 'done' }],
    ['GET', '/api/all-sessions'], ['GET', '/api/sessions'], ['GET', '/api/sessions/x/messages'], ['GET', '/api/logs'],
    ['GET', '/api/file?path=.env'], ['GET', '/api/files/list'], ['GET', '/api/explorer'], ['GET', '/api/workspace'],
    ['POST', '/api/workspace/file', { path: 'a', content: 'b' }], ['POST', '/api/terminal/ensure', {}], ['POST', '/api/terminal/exec', { command: 'id' }],
    ['GET', '/api/keys/alpha'], ['GET', '/api/config/alpha'], ['GET', '/api/memory/alpha'], ['GET', '/api/users'], ['GET', '/api/audit'],
    ['GET', '/api/dashboard-state'], ['GET', '/api/gateway/alpha'], ['GET', '/api/mcp/servers'], ['GET', '/usage'],
  ];
  for (const [m, u, b] of routes) {
    const r = await anon.req(m, u, b);
    assert.equal(r.status, 401, `${m} ${u} -> ${r.status}`);
  }
});

// ───────────────────────── demo-viewer ─────────────────────────
test('demo-viewer ALLOW: sees the approved board and status only', async () => {
  const c = clients.demo;
  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.role, 'demo-viewer');
  assert.equal(me.json.user.permissions.terminal, undefined);

  const board = await c.get('/api/office/kanban?board=demo');
  assert.equal(board.status, 200);
  const ids = board.json.tasks.map((t) => t.id).sort();
  assert.deepEqual(ids, ['d1', 'd2', 'd4'], 'beta-assigned d3 must be filtered out');
  for (const t of board.json.tasks) {
    assert.equal(t.workspace_path, undefined, 'no workspace paths');
    assert.equal(t.claim_lock, undefined, 'no lock names');
    assert.equal(t.worker_pid, undefined, 'no worker pid');
  }
  assert.ok(!board.json.links.some((l) => l.child_id === 'd3' || l.parent_id === 'd3'), 'links to hidden tasks removed');
  assert.deepEqual(board.json.columns.map((x) => x.assignee), ['alpha']);

  const boards = await c.get('/api/office/kanban/boards');
  assert.deepEqual(boards.json.boards, ['demo'], 'secretboard not listed');

  const sum = await c.get('/api/office/summary?board=demo');
  assert.equal(sum.status, 200);
  assert.equal(sum.json.overview.total, 3, 'summary counts exclude hidden tasks');
  assert.ok(!JSON.stringify(sum.json).includes('Beta private'), 'no hidden task titles in alerts');

  const detail = await c.get('/api/office/kanban/d1?board=demo');
  assert.equal(detail.status, 200);
  assert.equal(detail.json.task.id, 'd1');
  assert.equal(detail.json.task.workspace_path, undefined);
  assert.deepEqual(detail.json.runs, [], 'run records (pids, locks) are not exposed');
  assert.ok(detail.json.events.every((e) => e.payload === undefined), 'event payloads are not exposed');
  assert.ok(!detail.json.links.some((l) => l.child_id === 'd3'), 'detail links hide out-of-scope tasks');

  const agents = await c.get('/api/office/agent-states?board=demo');
  assert.equal(agents.status, 200);
  assert.deepEqual(agents.json.agents.map((a) => a.name), ['alpha'], 'beta agent not returned');
  assert.equal((await c.get('/api/profiles')).status, 200);
  assert.equal((await c.get('/api/health')).status, 200);
});

test('demo-viewer DENY: no data from disallowed profile / board / task', async () => {
  const c = clients.demo;
  const hidden = await c.get('/api/office/kanban/d3?board=demo');
  assert.equal(hidden.status, 404, 'out-of-profile task detail looks nonexistent');
  assert.ok(!hidden.text.includes('Beta private'));
  assert.equal((await c.get('/api/office/kanban?board=secretboard')).status, 403, 'unapproved board');
  assert.equal((await c.get('/api/office/summary?board=secretboard')).status, 403);
  assert.equal((await c.get('/api/office/agent-states?board=secretboard')).status, 403);
  assert.equal((await c.get('/api/office/kanban/s1?board=secretboard')).status, 403);
  assert.equal((await c.get('/api/office/kanban')).status, 403, 'default board "main" is not approved');
});

test('demo-viewer DENY: cannot mutate tasks (direct API, valid CSRF)', async () => {
  const c = clients.demo;
  for (const action of ['comment', 'respond', 'decision', 'done', 'reopen', 'unblock', 'start', 'reassign']) {
    await expectDenied(c, 'POST', '/api/office/kanban/d1/action?board=demo', { action, text: 'x', assignee: 'beta' }, `demo action=${action}`);
  }
  const t = new Database(path.join(HH, 'kanban', 'boards', 'demo', 'kanban.db'), { readonly: true });
  assert.equal(t.prepare("SELECT status FROM tasks WHERE id='d1'").get().status, 'blocked', 'state unchanged');
  assert.equal(t.prepare('SELECT count(*) c FROM task_comments').get().c, 0);
  t.close();
});

test('demo-viewer DENY: terminal, files, workspace, secrets, config, users, sessions, logs, system, gateway control', async () => {
  const c = clients.demo;
  const cases = [
    ['POST', '/api/terminal/ensure', {}], ['POST', '/api/terminal/exec', { command: 'id' }],
    ['POST', '/api/workspace/file', { path: 'pwn.txt', content: 'x' }], ['GET', '/api/workspace/file?path=a'],
    ['POST', '/api/workspace', { path: HH }], ['GET', '/api/workspace?listDir=/'],
    ['POST', '/api/file', { path: 'notes.txt', content: 'x' }], ['GET', '/api/file?path=notes.txt'], ['GET', '/api/file?path=.env'],
    ['GET', '/api/files/list'], ['GET', '/api/explorer'],
    ['GET', '/api/keys/alpha'], ['GET', '/api/keys/alpha/reveal/ALPHA_API_KEY'], ['PUT', '/api/keys/alpha', { name: 'A', value: 'b' }],
    ['GET', '/api/config/alpha'], ['PUT', '/api/config/alpha', { raw_yaml: 'a: 1' }],
    ['GET', '/api/memory/alpha'], ['GET', '/api/mcp/servers'], ['GET', '/api/mcp/servers/x/config'],
    ['GET', '/api/users'], ['POST', '/api/users', { username: 'evil', password: 'password123', role: 'admin' }],
    ['PUT', '/api/users/demo', { role: 'admin' }], ['DELETE', '/api/users/admin'], ['POST', '/api/users/admin/reset-password', { new_password: 'hacked-pass-1' }],
    ['GET', '/api/audit'],
    ['GET', '/api/sessions'], ['GET', '/api/all-sessions'], ['GET', '/api/all-sessions?profile=alpha'], ['GET', '/api/sessions/sess_alpha/messages?profile=alpha'],
    ['GET', '/api/sessions/sess_alpha/export'], ['DELETE', '/api/sessions/sess_alpha'], ['POST', '/api/sessions/sess_alpha/rename', { title: 'x' }],
    ['GET', '/api/logs'], ['GET', '/api/logs?profile=alpha'], ['GET', '/api/gateway/alpha/logs'],
    ['POST', '/api/gateway/alpha/restart'], ['POST', '/api/gateway/alpha/stop'],
    ['POST', '/api/chat/send', { message: 'hi', profile: 'alpha' }], ['POST', '/api/gateway/responses', { message: 'hi', profile: 'alpha' }],
    ['POST', '/api/chat/fork', { sessionId: 'x', messageIndex: 0 }],
    ['POST', '/api/cron/add', { schedule: '5m' }], ['GET', '/api/hermes-cron/alpha'], ['POST', '/api/hermes-cron/alpha/create', { schedule: '5m' }],
    ['POST', '/api/update', {}], ['POST', '/api/hci-restart', {}], ['POST', '/api/backup/create', {}], ['POST', '/api/doctor', {}], ['GET', '/api/dump'],
    ['POST', '/api/profiles/use', { profile: 'alpha' }], ['POST', '/api/profiles/create', { name: 'zz' }], ['DELETE', '/api/profiles/alpha'],
    ['POST', '/api/skills/install', { skill: 'x' }], ['POST', '/api/skills/check', { profile: 'alpha' }],
    ['GET', '/api/dashboard-state'], ['GET', '/api/usage'], ['GET', '/api/insights'], ['GET', '/usage'], ['GET', '/api/usage/7'], ['GET', '/api/monitoring'],
    ['GET', '/api/office/events'], ['GET', '/api/office/kanban/d1/workspace-file?board=demo&path=.'],
    ['POST', '/api/office/departments', { name: 'x', color: '#aabbcc' }], ['PUT', '/api/office/departments/aaaaaaaaaaaa/members', { members: ['x'] }],
    ['POST', '/api/layout', { panels: [] }], ['POST', '/api/avatar', { dataUrl: 'data:image/png;base64,AAAA' }], ['DELETE', '/api/avatar'],
    ['POST', '/api/agent/state', { state: 'idle' }], ['GET', '/api/setup/check'], ['GET', '/api/plugins'],
    ['POST', '/api/notifications/clear', {}], ['POST', '/internal/cron/add', {}],
  ];
  const unexpected = [];
  for (const [m, u, b] of cases) {
    const r = await c.req(m, u, b);
    // /internal/cron has its own shared-secret gate => 403 as well; everything else must be 403 from RBAC
    if (r.status !== 403) unexpected.push(`${m} ${u} -> ${r.status}`);
  }
  assert.deepEqual(unexpected, [], 'routes reachable by demo-viewer');
});

test('demo-viewer DENY: write attempts leave the filesystem untouched', () => {
  assert.equal(fs.existsSync(path.join(HH, 'pwn.txt')), false);
  assert.equal(fs.readFileSync(path.join(HH, 'notes.txt'), 'utf8'), 'harmless notes');
  assert.ok(!fs.existsSync(path.join(HH, 'control-interface', 'avatar.dataurl')));
});

test('demo-viewer: denied requests are audited with the true actor', async () => {
  await clients.demo.post('/api/terminal/ensure', {});
  const log = fs.readFileSync(path.join(HH, 'hci-audit.log'), 'utf8');
  assert.match(log, /\[demo\] \[demo-viewer\] DENIED: POST \/api\/terminal\/ensure/);
});

test('demo-viewer: gateway port listing is filtered to allowed profiles', async () => {
  const r = await clients.demo.get('/api/gateway/ports');
  assert.equal(r.status, 200);
  assert.ok(r.json.profiles.every((p) => p === 'alpha'));
});

test('demo-viewer: dashboard WebSocket snapshot is redacted; expiry closes the socket', async () => {
  const WebSocket = require('ws');
  assert.ok(auth.createUser('wsdemo', USER_PW, 'demo-viewer', ['alpha'], { allowed_boards: ['demo'], expires_at: FUTURE() }).ok);
  const c = await loggedIn('wsdemo');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: c.cookie } });
  const msgs = [];
  ws.on('message', (m) => { try { msgs.push(JSON.parse(m.toString())); } catch { /* ignore */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const t0 = Date.now();
  while (!msgs.some((m) => m.type === 'snapshot') && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
  const snap = msgs.find((m) => m.type === 'snapshot');
  assert.ok(snap, 'got snapshot');
  assert.deepEqual(snap.payload.sessions, []);
  assert.deepEqual(snap.payload.allSessions, []);
  assert.deepEqual(snap.payload.cronJobs, []);
  assert.deepEqual(snap.payload.explorerRoots, []);
  assert.equal(snap.payload.terminal.buffer, '');
  assert.equal(snap.payload.configSummary.raw, undefined, 'raw config yaml withheld');
  assert.equal(snap.payload.knowledge, '');
  assert.ok(!msgs.some((m) => m.type === 'terminal-transcript'));
  // terminal-input over WS is ignored for demo-viewer
  ws.send(JSON.stringify({ type: 'terminal-input', data: 'echo pwned > ' + path.join(HH, 'ws-pwn.txt').replace(/\\/g, '/') + '\r' }));
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(fs.existsSync(path.join(HH, 'ws-pwn.txt')), false);
  // expire the account -> next message closes the socket
  const d = auth.loadUsers();
  d.users.find((x) => x.username === 'wsdemo').expires_at = new Date(Date.now() - 1000).toISOString();
  auth.saveUsers(d);
  const closed = new Promise((res) => ws.on('close', res));
  ws.send(JSON.stringify({ type: 'noop' }));
  await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('socket not closed after expiry')), 5000))]);
});

// ───────────────────────── reviewer ─────────────────────────
test('reviewer ALLOW: scoped task only; comment + human decision', async () => {
  const c = clients.rev;
  const board = await c.get('/api/office/kanban?board=demo');
  assert.deepEqual(board.json.tasks.map((t) => t.id), ['d1'], 'only the scoped task is visible');
  assert.equal((await c.get('/api/office/kanban/d1?board=demo')).status, 200);

  const cm = await c.post('/api/office/kanban/d1/action?board=demo', { action: 'comment', text: 'reviewer note' });
  assert.equal(cm.status, 200);
  assert.equal(cm.json.ok, true);
  const dec = await c.post('/api/office/kanban/d1/action?board=demo', { action: 'respond', text: 'approved by reviewer' });
  assert.equal(dec.status, 200);
  assert.equal(dec.json.ok, true);

  const db = new Database(path.join(HH, 'kanban', 'boards', 'demo', 'kanban.db'), { readonly: true });
  const comments = db.prepare('SELECT author, body FROM task_comments ORDER BY id').all();
  assert.deepEqual(comments.map((x) => x.author), ['rev', 'rev'], 'author is the true actor, never hci-admin');
  assert.equal(db.prepare("SELECT status FROM tasks WHERE id='d1'").get().status, 'ready');
  db.close();
  assert.match(fs.readFileSync(path.join(HH, 'hci-audit.log'), 'utf8'), /\[rev\] \[reviewer\] OFFICE_ACTION: board=demo task=d1 action=respond/);
});

test('reviewer DENY: decision only while task awaits a human; no other state changes; no out-of-scope tasks', async () => {
  const c = clients.rev;
  const again = await c.post('/api/office/kanban/d1/action?board=demo', { action: 'respond', text: 'again' });
  assert.equal(again.status, 409, 'd1 is now ready, no longer waiting for a decision');
  for (const action of ['done', 'reopen', 'unblock', 'start', 'reassign']) {
    await expectDenied(c, 'POST', '/api/office/kanban/d1/action?board=demo', { action, assignee: 'beta' }, `reviewer action=${action}`);
  }
  for (const id of ['d2', 'd3', 'd4']) {
    const r = await c.post(`/api/office/kanban/${id}/action?board=demo`, { action: 'comment', text: 'sneaky' });
    assert.equal(r.status, 404, `task ${id} outside reviewer_scope`);
    assert.equal((await c.get(`/api/office/kanban/${id}?board=demo`)).status, 404);
  }
  assert.equal((await c.post('/api/office/kanban/s1/action?board=secretboard', { action: 'comment', text: 'x' })).status, 403);
  assert.equal((await c.post('/api/office/kanban/d1/action?board=demo', { action: 'bogus' })).status, 400);
  await expectDenied(c, 'POST', '/api/terminal/ensure', {});
  await expectDenied(c, 'POST', '/api/workspace/file', { path: 'a', content: 'b' });
  await expectDenied(c, 'GET', '/api/file?path=.env');
  await expectDenied(c, 'GET', '/api/keys/alpha');
  const db = new Database(path.join(HH, 'kanban', 'boards', 'demo', 'kanban.db'), { readonly: true });
  assert.equal(db.prepare("SELECT count(*) c FROM task_comments WHERE task_id != 'd1'").get().c, 0);
  assert.equal(db.prepare("SELECT assignee FROM tasks WHERE id='d1'").get().assignee, 'alpha');
  db.close();
});

// ───────────────────────── legacy roles ─────────────────────────
test('legacy viewer: previously-open mutation/read routes are now gated', async () => {
  const c = clients.legacyviewer;
  await expectDenied(c, 'POST', '/api/workspace/file', { path: 'pwn.txt', content: 'x' });
  await expectDenied(c, 'POST', '/api/terminal/ensure', {});
  await expectDenied(c, 'POST', '/api/office/kanban/d2/action?board=demo', { action: 'done' });
  await expectDenied(c, 'POST', '/api/layout', { panels: [] });
  await expectDenied(c, 'POST', '/api/avatar', {});
  await expectDenied(c, 'POST', '/api/skills/check', {});
  await expectDenied(c, 'GET', '/api/keys/alpha');
  await expectDenied(c, 'GET', '/api/config/alpha');
  await expectDenied(c, 'GET', '/api/mcp/servers');
  await expectDenied(c, 'GET', '/api/office/events');
  await expectDenied(c, 'GET', '/api/memory/beta');
  await expectDenied(c, 'GET', '/api/sessions/sess_beta/messages?profile=beta');
  await expectDenied(c, 'GET', '/api/logs?profile=beta');
  await expectDenied(c, 'GET', '/api/logs');
  await expectDenied(c, 'GET', '/api/sessions');
  await expectDenied(c, 'GET', '/api/all-sessions');
  await expectDenied(c, 'GET', '/api/all-sessions?profile=beta');
  await expectDenied(c, 'GET', '/api/hermes-cron/beta');
  await expectDenied(c, 'GET', '/api/gateway/beta');
  assert.equal(fs.existsSync(path.join(HH, 'pwn.txt')), false);
  // still allowed for the viewer preset, within its profile
  assert.equal((await c.get('/api/sessions/sess_alpha/messages?profile=alpha')).status, 200);
  assert.equal((await c.get('/api/office/kanban?board=demo')).status, 200);
  const board = (await c.get('/api/office/kanban?board=demo')).json;
  assert.ok(!board.tasks.some((t) => t.id === 'd3'), 'viewer limited to allowed_profiles [alpha]');
});

test('custom roles: permission checks on file/terminal/secret/config routes', async () => {
  const none = clients['cust-none'];
  for (const [m, u, b] of [
    ['GET', '/api/file?path=notes.txt'], ['GET', '/api/files/list'], ['GET', '/api/explorer'], ['GET', '/api/workspace'], ['GET', '/api/workspace/file?path=a'],
    ['POST', '/api/file', { path: 'notes.txt', content: 'x' }], ['POST', '/api/workspace/file', { path: 'a', content: 'b' }],
    ['POST', '/api/terminal/ensure', {}], ['POST', '/api/terminal/exec', { command: 'id' }],
    ['GET', '/api/keys/alpha'], ['GET', '/api/config/alpha'], ['GET', '/api/memory/alpha'], ['GET', '/api/logs'], ['GET', '/api/sessions'],
    ['GET', '/api/office/kanban?board=demo'], ['POST', '/api/office/kanban/d2/action?board=demo', { action: 'comment', text: 'x' }],
    ['POST', '/api/skills/check', {}], ['GET', '/api/hermes-cron/alpha'], ['GET', '/api/usage'], ['GET', '/api/skills'],
  ]) await expectDenied(none, m, u, b);

  await expectDenied(clients['cust-term'], 'POST', '/api/terminal/ensure', {});
  await expectDenied(clients['cust-term'], 'POST', '/api/terminal/exec', { command: 'id' });

  const f = clients['cust-files'];
  assert.equal((await f.get('/api/file?path=profiles/alpha/config.yaml')).status, 200);
  await expectDenied(f, 'GET', '/api/file?path=profiles/beta/config.yaml');
  await expectDenied(f, 'GET', '/api/file?path=.env');
  await expectDenied(f, 'GET', '/api/file?path=profiles/alpha/.env');
  await expectDenied(f, 'GET', '/api/file?path=hci-users.json');
  await expectDenied(f, 'GET', '/api/file?path=profiles/alpha/state.db');
  await expectDenied(f, 'GET', '/api/file?path=kanban/boards/demo/kanban.db');
  await expectDenied(f, 'GET', '/api/file?path=notes.txt', undefined, 'root file belongs to default profile');
  await expectDenied(f, 'GET', '/api/files/list?path=kanban');
  const lst = await f.get('/api/files/list?path=profiles');
  assert.equal(lst.status, 200);
  assert.deepEqual(lst.json.items.map((i) => i.name), ['alpha'], 'beta profile directory hidden');
  const lst2 = await f.get('/api/files/list?path=profiles/alpha');
  assert.ok(!lst2.json.items.some((i) => i.name === '.env' || i.name === 'state.db'), 'credential/db files hidden in listings');
  const ex = JSON.stringify((await f.get('/api/explorer')).json);
  assert.ok(!ex.includes('beta') && !ex.includes('hci-users') && !ex.includes('.env'), 'explorer tree filtered');
  await expectDenied(f, 'POST', '/api/file', { path: 'profiles/alpha/config.yaml', content: 'x' }); // no files.write
  await expectDenied(f, 'POST', '/api/workspace/file', { path: 'a', content: 'b' });

  const w = clients['cust-write'];
  assert.equal((await w.post('/api/file', { path: 'notes.txt', content: 'edited' })).status, 200);
  assert.equal(fs.readFileSync(path.join(HH, 'notes.txt'), 'utf8'), 'edited');
  await expectDenied(w, 'POST', '/api/file', { path: '.env', content: 'ROOT_SECRET=pwned' });
  assert.match(fs.readFileSync(path.join(HH, '.env'), 'utf8'), /root-level-secret-value/, '.env untouched');
  await expectDenied(w, 'POST', '/api/file', { path: 'hci-users.json', content: '{}' });
});

test('profile scoping on sessions / logs / secrets / config / memory', async () => {
  const c = clients['cust-sess'];
  const own = await c.get('/api/sessions/sess_alpha/messages?profile=alpha');
  assert.equal(own.status, 200);
  assert.equal(own.json.messages[0].content, 'private message in alpha');
  const other = await c.get('/api/sessions/sess_beta/messages?profile=beta');
  assert.equal(other.status, 403);
  assert.ok(!other.text.includes('private message in beta'));
  // default profile requested implicitly (no ?profile) is also outside [alpha]
  await expectDenied(c, 'GET', '/api/sessions/sess_alpha/messages');
  await expectDenied(c, 'GET', '/api/sessions');          // spans all profiles
  await expectDenied(c, 'GET', '/api/all-sessions');      // spans all profiles
  await expectDenied(c, 'GET', '/api/all-sessions?profile=beta');
  await expectDenied(c, 'GET', '/api/sessions/sess_alpha/export');
  await expectDenied(c, 'GET', '/api/logs');
  await expectDenied(c, 'GET', '/api/logs?profile=beta');
  const logs = await c.get('/api/logs?profile=alpha');
  assert.equal(logs.status, 200);
  assert.ok(!logs.text.includes('from beta'));
  assert.equal((await c.get('/api/keys/alpha')).status, 200);
  await expectDenied(c, 'GET', '/api/keys/beta');
  await expectDenied(c, 'GET', '/api/keys/alpha/reveal/ALPHA_API_KEY');
  assert.equal((await c.get('/api/config/alpha')).status, 200);
  await expectDenied(c, 'GET', '/api/config/beta');
  await expectDenied(c, 'GET', '/api/memory/beta');
  await expectDenied(c, 'GET', '/api/usage/7');           // no ?profile => all profiles
  await expectDenied(c, 'GET', '/api/usage/7?profile=beta');
  await expectDenied(c, 'GET', '/api/usage/daily/7?profile=beta');
  await expectDenied(c, 'GET', '/api/usage/daily/7');     // defaults to the default profile
  await expectDenied(c, 'GET', '/api/gateway/beta');
});

// ───────────────────────── admin regression ─────────────────────────
test('admin: behaviour preserved (full board, task detail, actions, events, users, audit)', async () => {
  const c = clients.admin;
  const board = await c.get('/api/office/kanban?board=demo');
  assert.equal(board.status, 200);
  assert.equal(board.json.tasks.length, 4, 'admin sees every task, incl. other profiles');
  assert.ok(board.json.tasks.find((t) => t.id === 'd3'), 'admin sees d3');
  assert.equal((await c.get('/api/office/kanban?board=secretboard')).status, 200);
  assert.deepEqual((await c.get('/api/office/kanban/boards')).json.boards.sort(), ['demo', 'secretboard']);
  const detail = await c.get('/api/office/kanban/d3?board=demo');
  assert.equal(detail.status, 200);
  assert.equal(detail.json.task.workspace_path, 'C:/secret/workspace/d3', 'admin keeps full task rows');
  assert.ok(detail.json.runs && detail.json.events.length >= 0);
  assert.equal((await c.get('/api/office/summary?board=demo')).json.overview.total, 4);
  assert.equal((await c.get('/api/office/agent-states?board=demo')).status, 200);
  assert.equal((await c.get('/api/office/events')).status, 200);
  assert.equal((await c.get('/api/office/departments')).status, 200);

  for (const action of ['start', 'done', 'reopen', 'unblock']) {
    const r = await c.post('/api/office/kanban/d4/action?board=demo', { action });
    assert.equal(r.status, 200, action);
    assert.equal(r.json.ok, true, action);
  }
  assert.equal((await c.post('/api/office/kanban/d4/action?board=demo', { action: 'reassign', assignee: 'beta' })).json.ok, true);
  assert.equal((await c.post('/api/office/kanban/d3/action?board=demo', { action: 'comment', text: 'admin note' })).json.ok, true);
  const db = new Database(path.join(HH, 'kanban', 'boards', 'demo', 'kanban.db'), { readonly: true });
  assert.equal(db.prepare("SELECT author FROM task_comments WHERE body='admin note'").get().author, 'admin', 'admin comments carry the real username');
  db.close();

  const users = await c.get('/api/users');
  assert.equal(users.status, 200);
  assert.ok(users.json.users.every((u) => u.password_hash === undefined), 'hashes never listed');
  assert.equal((await c.get('/api/audit')).status, 200);
  assert.equal((await c.get('/api/file?path=.env')).status, 200, 'admin may read sensitive paths');
  assert.equal((await c.get('/api/sessions/sess_beta/messages?profile=beta')).status, 200);
  assert.equal((await c.get('/api/logs?profile=beta')).status, 200);
  assert.equal((await c.get('/api/keys/beta')).status, 200);
  assert.equal((await c.get('/api/config/beta')).status, 200);
  assert.equal((await c.get('/api/files/list?path=kanban')).status, 200);
  assert.equal((await c.get('/api/explorer')).status, 200);
  assert.equal((await c.get('/api/notifications')).status, 200);
  const perms = (await c.get('/api/auth/me')).json.user.permissions;
  for (const p of rbac.PERMISSIONS) assert.equal(perms[p], true, `admin has ${p}`);
});

test('admin: user management validates restricted roles and applies them', async () => {
  const c = clients.admin;
  const bad = await c.post('/api/users', { username: 'apidemo', password: 'password-12345', role: 'demo-viewer', allowed_profiles: ['*'], allowed_boards: ['demo'], expires_at: FUTURE() });
  assert.equal(bad.status, 400);
  const noExpiry = await c.post('/api/users', { username: 'apidemo', password: 'password-12345', role: 'demo-viewer', allowed_profiles: ['alpha'], allowed_boards: ['demo'] });
  assert.equal(noExpiry.status, 400);
  assert.equal((await c.post('/api/users', { username: 'apidemo', password: 'password-12345', role: 'superuser' })).status, 400);
  const ok = await c.post('/api/users', { username: 'apidemo', password: 'password-12345', role: 'demo-viewer', allowed_profiles: ['alpha'], allowed_boards: ['demo'], expires_at: FUTURE() });
  assert.equal(ok.status, 200);
  const created = (await c.get('/api/users')).json.users.find((u) => u.username === 'apidemo');
  assert.deepEqual(created.allowed_boards, ['demo']);
  assert.ok(created.expires_at);
  const dc = await loggedIn('apidemo', 'password-12345');
  assert.equal((await dc.get('/api/office/kanban?board=demo')).status, 200);
  await expectDenied(dc, 'GET', '/api/users');
  // promote to wildcard profile on a restricted role must fail
  const promote = await c.put('/api/users/apidemo', { role: 'demo-viewer', allowed_profiles: ['*'] });
  assert.equal(promote.status, 400);
  // last admin cannot be demoted
  assert.equal((await c.put('/api/users/admin', { role: 'viewer' })).status, 400);
});

// ───────────────────────── static route inventory guard ─────────────────────────
test('route inventory: every non-public route has an explicit authorization guard', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const routeRe = /^app\.(get|post|put|delete|patch)\(\s*'([^']+)'([^\n]*)/gm;
  const publicRoutes = new Set(['GET /api/health', 'GET /api/auth/me', 'GET /api/auth/status', 'POST /api/auth/setup', 'POST /api/auth/login', 'POST /internal/cron/:action']);
  // authenticated-only routes that are safe for EVERY role because the handler redacts / self-scopes.
  const authOnly = new Set([
    'GET /api/session', 'GET /api/permissions', 'GET /api/notifications', 'GET /api/profiles', 'GET /api/dashboard-state',
    'GET /api/avatar/image', 'POST /api/auth/logout', 'POST /api/auth/change-password',
  ]);
  const guard = /require(Role|Perm|AnyPerm|ProfileAccess|AllProfiles)\(|requireAllProfiles|requireProfileAccess|requireProfileFrom|requireProfileOrAll|requireBoardAccess/;
  const csrfLegacy = new Set(['POST /api/chat/send', 'POST /api/gateway/responses']);
  const offenders = [];
  let m; let count = 0;
  while ((m = routeRe.exec(src))) {
    count++;
    const [, method, p, rest] = m;
    const key = `${method.toUpperCase()} ${p}`;
    if (publicRoutes.has(key) || authOnly.has(key)) continue;
    if (!guard.test(rest)) offenders.push(key);
    // chat/send + gateway/responses authenticate by session cookie and are pre-existing CSRF-less JSON posts.
    if (method !== 'get' && !csrfLegacy.has(key) && !/requireCsrf|requireRole\('admin'\)/.test(rest) && !publicRoutes.has(key)) offenders.push(key + ' (mutation without CSRF)');
  }
  assert.ok(count > 100, 'route scan found the routes');
  assert.deepEqual(offenders, [], 'routes with no permission guard');
});
