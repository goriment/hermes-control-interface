# Hermes Control Interface - Demo RBAC Matrix and Public-Demo GO/NO-GO Gate

Card: t_cb788474 (goriment-control). Owner: gorimentpm (PM).
Evidence base: static read of server.js / auth.js at HEAD ee0f580 (main, checkout D:\Apps\hermes-control-interface is DIRTY: server.js, state.js, office*.js modified - uncommitted changes NOT reviewed), plus hci-users.json and hci-audit.log. No runtime/penetration test has been performed. Everything below is "specified", not "tested".

## 1. Current state (verified by reading code)

Auth model: roles admin | viewer | custom. requireRole('admin') = role admin only. requirePerm(p) = admin bypass, else permissions[p] must be true. requireProfileAccess checks allowed_profiles only on routes with :profile param.
PERMISSIONS list (auth.js): sessions.*, chat.*, logs.view, usage.*, gateway.view/control, config.view/edit, secrets.view/reveal/edit, skills.*, cron.*, files.read/write, terminal, users.*, system.update/backup/doctor/restart.
Existing accounts: admin (profiles *), demo-reviewer (custom; permissions usage.view, gateway.view, skills.browse; profiles gptsupervisor, gorimentpm, gorimentcanary; never logged in; NO expiry field; user model has no expiry/rotation attribute at all).
Audit: hci-audit.log records USER_CREATE/UPDATE/DENIED/PASSWORD_CHANGE. It does not record successful reads/mutations on most routes.

## 2. Blocking defects found (each must be a Dev fix; see seeded card key demo-enforce-rbac-v1)

D1 (CRITICAL) POST /api/workspace/file - requireAuth+CSRF only, no permission. Any logged-in user (incl. Demo Viewer) can write files. Violates "cannot write files".
D2 (CRITICAL) POST /api/terminal/ensure - no perm check (exec itself needs 'terminal.exec', which is NOT in the PERMISSIONS list, so only admin can exec; naming mismatch with 'terminal' must be fixed, and ensure must be gated).
D3 (CRITICAL) POST /api/office/kanban/:taskId/action - requireAuth+CSRF only; any user can change task state/assign/comment; writes author 'hci-admin' (audit attribution wrong, no profile/board scoping).
D4 (HIGH) GET /api/file, /api/files/list, /api/workspace, /api/workspace/file, /api/explorer - requireAuth only; no files.read check, no allowed_profiles filtering -> arbitrary readable path exposure under HERMES home, may include .env.
D5 (HIGH) GET /api/memory/:profile, /api/mcp/servers*, /api/mcp/servers/:name/config, /api/setup/check, /api/skills/check (POST), /api/layout POST, /api/avatar POST/DELETE, /api/hermes-cron/:profile GET, /api/sessions/:id/messages|export, /api/all-sessions, /api/sessions - requireAuth only, no profile filter (memory has :profile but no requireProfileAccess). Session/log/office data from disallowed profiles may leak. /api/office/* read routes also have no profile filtering (not fully traced).
D6 (HIGH) GET /api/keys/:profile - requireProfileAccess only, no secrets.view permission. Masking behaviour not verified.
D7 (HIGH) requireRole('admin') used instead of permissions for gateway control, config edit, backup, update, restart: OK for Demo Viewer (non-admin denied) but custom roles can never be granted these; acceptable (fail-closed) - keep.
D8 (HIGH) No account expiry/rotation field and no enforcement; no login-time allowed_profiles audit; audit lacks success events for office actions.
D9 (MEDIUM) preset 'viewer' includes chat.use and files.read - NOT demo-safe (chat sends prompts to real agents). Demo Viewer must be a new explicit preset.
D10 (MEDIUM) Dirty main checkout; app runs from uncommitted code. GO must pin a clean commit SHA.

## 3. Roles

R1 Owner/Admin - role admin, allowed_profiles ["*"]. Internal only, never given to demo users. Full routes.
R2 Operator - role custom, internal staff only. Day-to-day: sessions/logs/usage/cron view, chat.use, kanban actions, gateway.view, files.read on allowed profiles. NOT secrets.reveal/edit, users.manage, config.edit, system.*, terminal (admin only). Not exposed publicly.
R3 Reviewer - role custom (new preset "reviewer"). Read-only board + status for explicitly scoped tasks; may add a comment and record a human decision (approve / request changes) ONLY on task ids in its scope list (reviewer_scope.task_ids and board), nothing else mutable. No chat.use, no files, no terminal, no secrets, no gateway control.
R4 Demo Viewer - role custom (new preset "demo-viewer"). Read-only on the approved board/status and approved profile list. Denied: terminal (ensure+exec), files.write, workspace/file write, files.read (raw), secrets.view/reveal/edit, users.view/manage, gateway.control, config.view/edit, system.restart/update/backup/doctor, cron.manage, skills.install, chat.use, kanban mutation, avatar/layout writes.

## 4. Permission matrix (Y = allowed, N = denied, S = only on explicitly scoped items)

Capability                         Owner/Admin  Operator  Reviewer  Demo Viewer
sessions.view (allowed profiles)       Y           Y         N         N
sessions.messages / delete             Y / Y       Y / N     N / N     N / N
chat.use / chat.manage                 Y / Y       Y / N     N / N     N / N
logs.view                              Y           Y         N         N
usage.view                             Y           Y         Y         Y
gateway.view                           Y           Y         Y         Y
gateway.control                        Y           N         N         N
config.view / config.edit              Y / Y       Y / N     N / N     N / N
secrets.view / reveal / edit           Y / Y / Y   N / N / N N / N / N N / N / N
skills.browse / install                Y / Y       Y / N     Y / N     Y / N
cron.view / cron.manage                Y / Y       Y / N     N / N     N / N
files.read / files.write               Y / Y       S / N     N / N     N / N
terminal (ensure + exec)               Y           N         N         N
users.view / users.manage              Y / Y       N / N     N / N     N / N
system.update/backup/doctor/restart    Y           N         N         N
office board read (allowed profiles)   Y           Y         S         Y (approved board only)
office task comment / decision         Y           Y         S         N
office task assign / state change      Y           Y         N         N
audit log view                         Y           N         N         N

## 5. Data / profile boundaries

- Every non-admin account MUST have an explicit allowed_profiles list; "*" is forbidden for non-admin. Default deny when empty.
- Demo accounts: allowed_profiles limited to the profiles intentionally shown in the demo. The existing demo-reviewer includes gptsupervisor, gorimentpm, gorimentcanary - these hold owner business context; PM recommends a dedicated, sanitised demo profile/board instead of live profiles before any public exposure (owner decision, see section 8).
- No demo role may read any .env, auth.json, hci-users.json, state.db, kanban workspaces, or paths outside an allow-listed demo workspace. Filtering must be server-side for sessions, logs, office events, kanban tasks/comments, memory, and files.
- Reviewer scope: explicit list of board+task ids; any other task id returns 403 and is audited.
- Public demo must show sanitised/synthetic data or data the owner has approved; no customer/financial/trading data.

## 6. Routes by role (current route names; ownership of fix = D#)

Public (no auth): GET /api/health, GET /api/auth/status, /api/auth/me, POST /api/auth/login.
All logged-in roles (self only): POST /api/auth/logout, /api/auth/change-password, GET /api/permissions, /api/notifications*.
Demo Viewer allowed: GET /api/usage*, /api/insights* (usage.view), GET /api/gateway/:profile, /connections, /health (allowed profile), GET /api/skills*, GET /api/office/kanban, /kanban/boards, /kanban/:taskId, /office/summary, /office/agent-states, /office/events (after D5 profile filtering), GET /api/system/health, /api/monitoring, /api/profiles (filtered), GET /api/models.
Reviewer additionally: POST /api/office/kanban/:taskId/action with action in {comment, decision} for scoped task ids only (after D3).
Operator additionally: sessions, logs, cron view, kanban actions, chat, files.read.
Admin only (requireRole admin): all /api/users*, /api/audit, POST /api/profiles/use|create, DELETE /api/profiles/:name, POST /api/gateway/:profile/:action, PUT /api/config/:profile, GET /api/keys/:profile/reveal/:name, PUT/DELETE /api/keys*, /api/backup/*, /api/update, /api/hci/*, /api/hci-restart, /api/doctor, /api/dump, /api/skills/install|uninstall|update, /api/hermes-cron create/update/action, /api/mcp start|stop|restart|test|add|config PUT|DELETE, /api/sessions/:id rename|DELETE, /api/agent/state, /api/office/departments writes, terminal exec.

## 7. Account policy (every demo account)

- allowed_profiles non-empty and non-"*"; role preset demo-viewer or reviewer (never admin/viewer legacy).
- expires_at (default max 7 days, enforced at login and per request) - NOT YET IMPLEMENTED (D8).
- Rotation: password reset at issuance, rotate/disable on expiry or after demo; no shared credentials; per-person username.
- Audit: login success/fail, DENIED, every mutation (user, task, scope) with true actor (not 'hci-admin'); log retained and reviewed after demo.
- Disable-all procedure: set all demo accounts expired / delete via admin; verify with a login attempt.
- Existing demo-reviewer: credentials hash exists, never logged in; must be re-provisioned with the final preset and an expiry before use; password is not recorded here.

## 8. Release checklist (all must be checked before GO)

Dev (owner: gorimentdev / HCI card demo-enforce-rbac-v1)
[ ] D1-D6, D8, D9 fixed server-side; terminal perm names consistent
[ ] demo-viewer and reviewer presets added; expiry enforced
[ ] Automated allow/deny authorization tests per role x route class pass; admin regression passes
[ ] Change merged to a CLEAN commit; deployed SHA recorded; migration/rollback documented
Ops (owner: gorimentops / card demo-secure-staging-v1)
[ ] Private HTTPS staging with TLS, rate limiting, no direct host exposure; blast radius reduced (separate OS user/sandbox, no real .env reachable)
[ ] Backup of hci-users.json and rollback tested; log retention in place
[ ] Public exposure (tunnel/DNS) is a gated external action requiring explicit owner approval
QA / Canary (independent; gorimentcanary or Antigravity)
[ ] Black-box direct-API tests with real demo-viewer and reviewer sessions: every Section 3 denial returns 403 (terminal, file write, secrets, users, gateway control, config edit, restart/update/backup, task mutation, out-of-scope task, out-of-profile data)
[ ] Cross-profile data leakage test = none
[ ] CSRF/session tests, expiry test, audit entries verified
[ ] Report attached to Kanban with SHA tested
PM
[ ] Owner approves demo dataset and profile list
[ ] Evidence for Dev + Ops + QA all attached to this gate card and refer to the same SHA
[ ] PM writes GO in Kanban comment citing evidence ids. Otherwise NO-GO.

## 9. Decision record

Current decision: NO-GO. Basis: static review shows D1-D3 critical authorization gaps (any authenticated Demo Viewer can write files, mutate kanban tasks, open terminal sessions); no Dev, Ops or QA evidence attached; no expiry mechanism; main checkout dirty. No test evidence exists, so no GO may be claimed.

## 9. Implementation status (card t_2b292174, branch dev/t_2b292174-demo-rbac)

Implemented in lib/rbac.js (pure policy), auth.js (accounts, per-request principal) and server.js (route guards):

- New roles `demo-viewer` and `reviewer` (restricted). Their permissions come ONLY from the code preset; any stored `permissions` on the record is ignored.
- Per-request principal: role, permissions, allowed_profiles, allowed_boards, reviewer_scope and expires_at are re-read from the user store on every HTTP request and every WebSocket message. Expiry, role change, password reset and logout take effect immediately (open sockets are closed).
- Default-deny gate: restricted roles may reach only the route allow-list in `ROUTE_POLICY` (lib/rbac.js); every other /api, /usage, /internal and /plugins path returns 403 and is audited. New routes are therefore denied for them until explicitly listed.
- Account policy enforced at create/update: restricted roles need non-wildcard allowed_profiles, explicit allowed_boards, `expires_at` within 7 days, and (reviewer) `reviewer_scope.task_ids`.
- Kanban: board allow-list; tasks filtered by profile (assignee) and, for reviewers, by task id; out-of-scope task => 404 (no existence oracle); non-admin task rows are projected (no workspace_path, claim_lock, worker pid); runs / event payloads withheld; links to hidden tasks removed. Actions are authorized per action (`comment`, `respond`/`decision`); decisions are only valid while the task is blocked/review; the author is the real username (no more `hci-admin`).
- D1-D6 fixed: workspace/file, terminal ensure/exec, files/explorer/workspace, memory, mcp, setup, skills/check, layout/avatar writes, hermes-cron, sessions/logs/usage now require a permission and (where profile data) a permitted profile; endpoints that span all profiles require an all-profiles principal. Sensitive paths (.env, auth.json, hci-users.json, *.db, vault, tokens, other profiles) are blocked for non-admins even with files.read.
- WebSocket: dashboard snapshot is redacted per principal; terminal, logs, chat actions are re-authorized per message.
- Legacy `viewer`/`custom` accounts keep working; `viewer` no longer reaches previously unguarded mutation routes.

Tests: `node --test test/rbac.test.js` boots the real server on a temp HOME (HCI_AUTH_HOME) with seeded profiles and boards and exercises allow + deny paths for every role, plus a static route-inventory guard that fails when a new route has no authorization guard.
Test-only env overrides: HCI_AUTH_HOME, HCI_LOGIN_RATE_MAX, HCI_GLOBAL_RATE_MAX.

Not covered / follow-ups: audit of successful read events; rotation of the existing `demo-reviewer` account (re-provision with a preset + expiry); a sanitised demo profile/board (owner decision, section 8); /internal/cron shared-secret path is unchanged; no penetration test beyond the automated suite; the running instance on :3011 was not touched or restarted.

## 10. Migration and rollback

Migration (no data migration needed; hci-users.json is backward compatible):
1. Back up `~/.hermes/hci-users.json` before deploying.
2. Deploy the branch commit (pin the SHA; the former dirty main checkout changes are included as baseline commit b786a96).
3. Existing admin/viewer/custom users keep working unchanged. Old tokens stay valid.
4. Create demo accounts via the admin API (`POST /api/users`) with role `demo-viewer` or `reviewer`, explicit `allowed_profiles` (no `*`), `allowed_boards`, `expires_at` (<= 7 days) and, for reviewer, `reviewer_scope.task_ids`. Re-provision the existing `demo-reviewer` the same way.
5. Smoke test: log in as the demo user and confirm `/api/office/kanban?board=<approved>` = 200 and `/api/terminal/ensure` = 403.

Rollback (operator procedure; do not use a live account for a test):
1. Before starting the previous build, remove every `demo-viewer` and `reviewer` account from the **effective users store that build will read**, or restore a verified pre-creation `hci-users.json` backup that contains none of those accounts. Check the restored store, not just the backup filename. Deleting via the new build's admin API is an option before stopping it, but verify that the deletion is present in the store used on rollback.
2. Invalidate existing sessions/tokens for those accounts before reverting; ensure no old or restored session can authenticate them. Redeploy the pinned previous commit only after the store and sessions are safe.
3. On the previous build, verify that login with a removed demo/reviewer account is rejected and that its former session/token cannot access an authenticated endpoint. Retain the admin smoke check; admin accounts are not altered by this change.

Expiration alone is **not** a rollback control: the previous build's `verifyUserPassword` does not enforce `expires_at`, and its `resolvePermissions` maps unknown roles to the legacy `viewer` preset (`chat.use`, `files.read`, `sessions.view`, `logs.view`). A restricted account left in the old build's users store could authenticate with its password and gain those legacy viewer permissions.
