# Private HTTPS staging and rollback runbook — v2 (F4 privacy-alignment repair)

Version: v2, repair card t_3cbf5e9d (2026-10-14). SUPERSEDES for review purposes, but does NOT modify, the immutable v1 packet attached to t_86282507:
- v1 PRIVATE_HTTPS_STAGING_RUNBOOK.md SHA256 572809f31c69f60bc0c710909ad87402feb70eb283bef565f1212419a20d1115
- v1 validate_runbook.py SHA256 205d4045b0b18464b88aa5b2288c1a115a6a80586730ff744081696ac3170cfe
Status: PROPOSAL / planning only / release NO-GO (unchanged from v1).
Board: goriment-control. Author/assigned documentation owner: gorimentops.
Parent program: t_56a8d947 (Ops), t_cb788474 (PM release gate). Repair source: independent QA t_f831f2df run 827, finding F4 (F4a backup-default conflict, F4b lifecycle/test alignment), extending PM finding F4 on t_5c9fe705.
v1 prepared against source/board readback on 2026-10-13 UTC; v2 re-read the same pinned sources on 2026-10-14 (see evidence_v2.json) and changed documentation only.

## 0. v2 privacy-policy input and its status

Pinned input: GORIMENT private-demo privacy policy v1.0 (demo_privacy_policy_v1.md), byte SHA256 667791087fbb3084a9eb68490af2daeeb48c55a6e8bb9afffaff82065965c426, authored by research card t_d21e61b4 (gorimentresearch). Read from that card's local workspace; the research card attachments were empty at QA inspection.

Status of that input — read carefully, it is NOT adopted:
- Research t_d21e61b4 is a completed local deliverable but the card itself is BLOCKED on a separate contract repair t_3e118c44. It is not done, not approved and not adopted.
- PM adoption of the policy and its independent review remain on existing cards t_1b88d032 / t_bd17ad8c. This runbook does not duplicate that research, adopt it, or grant any approval, deletion or deploy.
- Release gate t_b9e54840 / t_cb788474 remains NO-GO.
- Open hazard cross-references (unchanged by this documentation repair, no runtime exploit claim): F1 proxy/XFF attribution -> t_03d4deb8; F2 volatile logout revocation across restart -> t_71534a12; successful-read audit gap -> t_2b292174 (line 123 of its record).
- Review lanes: independent re-review is t_c2563df6 (continuation of DONE QA t_f831f2df; gated on this card — no duplicate QA lane created here). PR #3 consolidation is t_7a15da2d, gated on that QA; this card does not edit PR #3.
- F3 corrections from v1 kept in substance: candidate is c46ecdbd (not stale 9967aa5); Tailscale service get-config/set-config is service-scoped, not a node listener backup/restore; no `serve reset` / `--all`; node-scoped off/restore syntax must be operator-verified before execution.

How v2 uses it: every retention, reset, backup, input and notice control below is a PROPOSED CONSERVATIVE BASELINE copied from the policy's defaults. Shorter is preferred. PM/owner must adopt the policy (or a replacement) and freeze actual UTC deadlines before any invitation; until then each control is a release gate, not an implemented or enforced behavior. Nothing in v2 claims implementation, legal certification or PDPA compliance; policy retention figures are policy choices, not statutory minima.

This document supplements, rather than republishes or modifies, draft PR https://github.com/goriment/hermes-control-interface/pull/3 at 791d9a4464a8dd4e3217f442224d17dfd4529158. No server, account, secret, DNS, ACL, firewall, gateway or provider configuration was changed. No deploy, merge, external invitation or positive HTTPS/restore test occurred. A completed documentation task does not unblock staging or grant GO.

## 1. Evidence and context receipt

Outcome: an operator-reviewable private-only topology, enable/disable procedure, identity and data boundary, recovery and secret-rotation plan, and measurable future acceptance checks.

Sources and provenance:
- Current assignment t_86282507: running, atomically claimed run 793 in the assigned scratch workspace; no structural parents/children existed at initial inspection. The parent ID in its body is a program reference, not a dependency edge.
- t_56a8d947: blocked on gateway/data approval and real staging/rollback evidence. Its 2026-10-10 listener, environment and feature observations are HISTORICAL; they were not revalidated here.
- t_cb788474: gorimentpm owns release gate; matrix specification is not staging evidence. The old upstream 403 was superseded by the writable fork PR, not a current permission blocker.
- Business OS: D:/GORIMENT/GitHub/GORIMENT-Business-OS, main ecc5f7c9b859de3177f18e52cbba3eb94943ad25 (clean; behind tracked origin/main by 11 at inspection). AGENTS.md, START_HERE.md and templates/CONTEXT_RECEIPT.md read. No fetch/pull/write was necessary for this document.
- Knowledge: D:/GORIMENT/GitHub/GORIMENT-Knowledge, main 451c973c78861208f09abc035cfe03cebebfe804 (clean). AGENTS.md, index.json, contracts/reading.md and apps/business-os/summary.md read. Shared recall at 2026-10-13T08:14:29.420416+00:00: approved context source SHA256 4300fc3aab34c81699578ab4791b0a9e425f613ac6aa8e75bcca7a2c9a4d295a; index SHA256 cb3a7e41b3ee4e72e3fc2f124ff0f7c5b71b580aa68c8df2b2f083981574ec02. Knowledge budget: four direct local documents plus two recall summaries; approximately 2,000 tokens, not tokenizer-measured; zero relationship hops. No claim of full portfolio impact analysis.
- HCI live checkout D:/Apps/hermes-control-interface: main ee0f5804e631ce522cb709fccae38fc68d3681e1 with unowned dirty files. Origin xaspx/hermes-control-interface. Read-only metadata only; not used as the demo build and not edited.
- Existing Ops worktree D:/d/GORIMENT-Worktrees/hci-t_56a8d947: clean at 791d9a4464a8dd4e3217f442224d17dfd4529158. PR #3 readback: OPEN, draft, matching head; no checks returned. Its prerequisite 9967aa5 is stale, and service set-config is not assumed to be a node-listener restoration method.
- Existing Dev worktree D:/d/GORIMENT-Worktrees/hci-t_2b292174: clean at c46ecdbd165a40405f953889c78729a7d9445e1d. PR #1 readback matches that head, OPEN/draft, statusCheckRollup empty. Read server.js, auth.js, lib/hci-config.js and docs/DEMO_RBAC_GATE.md. Prior Canary focused 28/28 and full 41/41 tests are board evidence from 2026-10-11, NOT tests rerun for this card or exact-head CI.
- Installed Tailscale 1.102.3: version/help inspected; `tailscale serve status --json` returned `{}` at inspection (node Serve status only, not proof of tailnet approval, origin firewall, absence of all public paths, or successful private access). Service get-config/set-config help explicitly concerns service configuration. A help probe with off plus --help returned invalid argument format without applying a config; no enable/disable command was run.

Authority correction: live goriment-control and current developer rules supersede historical Business OS queue or older handoff-skill authority statements. Readiness is ready_for_scoped_documentation; runtime/deploy context remains incomplete. Receipt and findings are persisted in Kanban, not in legacy STATE.json.

Before/after: existing short PR #3 proposal remains untouched; this task supplies a fuller safety and operations supplement with current candidate SHA, explicit gates and rollback hazards. Only this task workspace/artifacts are written. Interfaces affected by a future approved deployment: HCI auth/cookies, origin bind, proxy headers, synthetic boards/profiles, audit/backup and private ingress. Further product consumers and live host access have not been assessed.

## 2. Proposed topology — not selected or provisioned

Recommended proposal (owner still decides): existing Tailscale Serve on a dedicated private HTTPS listener, proposed 8443, forwarding to a new isolated HCI at http://127.0.0.1:10275. Keep the existing operator listener 10274 entirely unchanged.

Invited named user + approved device
  -> private tailnet ACL/grant for only the demo HTTPS endpoint
  -> Tailscale Serve TLS termination
  -> loopback HCI 127.0.0.1:10275
  -> isolated synthetic home/auth store/board/artifacts only

No Funnel, public tunnel, router forwarding, TCP forwarding, wildcard bind, public DNS publication, or direct access to 10274/10275. Select the actual private hostname only from approved runtime output; no invented working URL is supplied. Certificate/DNS names may be visible in certificate transparency: the owner must approve hostname privacy implications even for a private endpoint.

Alternative: Cloudflare Access with individually authenticated allow-listed identities and a reviewed outbound-only tunnel. This is NOT approved here. Account/zone, privacy/cost, MFA/IdP, tunnel policy and origin bypass testing require a separate owner decision. Never run an unauthenticated temporary tunnel. Do not provision both alternatives or add a new service merely to work around an approval gate.

## 3. Identity and least-privilege boundary

Two independent controls are required: network admission and HCI per-person authorization. Tailnet membership does not itself map a user to an HCI role. Do not trust arbitrary identity HTTP headers or auto-promote a gateway user.

- Named invitations only; MFA/device posture required according to the owner-approved tailnet policy. Restrict grants to approved people/devices and the demo listener, not all members or all host ports. Explicitly verify unwanted users/devices are denied.
- One HCI account per person, issued via an approved secure operator flow; no shared admin or shared demo password. Demo accounts must be demo-viewer or reviewer, never legacy viewer/custom or admin as a shortcut.
- Explicit non-wildcard allowed_profiles and allowed_boards; reviewer_scope.task_ids only approved synthetic IDs. Reviewer may record only PREDEFINED SAFE comment/decision labels (privacy policy C20 / P04) on those explicit isolated IDs; arbitrary free-text, uploads, prompts, webhooks, tools and dispatch must be rejected server-side. A real-feedback study needs a separately approved collection flow and is out of scope. No queue/resume/assign/terminal/file/secret/config/gateway/system action. Whether the candidate actually enforces scripted labels is UNVERIFIED and remains a Dev P04 gate (t_a18c77ba/t_2b292174); this document does not claim it.
- Demo Viewer never mutates. Display names are fixed fictional actors (C06); the private actor mapping from invited person to HCI account is personal data, held only in the restricted store described in section 7, never in fixtures, UI, screenshots or Kanban.
- Account expires_at <= 7 days is the candidate-code maximum; proposal is end-of-event expiry, not seven-day access by default. Record expiry in UTC, issued-by identity and revocation owner. Remove access after the session unless the owner approves another interval.
- Admin/bootstrap is an operator-only local task BEFORE gateway access. Do not expose first-run setup to invitees. Admin credentials are not used by Canary/demo clients or copied from the operator instance.
- Session scope/expiry must be verified on each HTTP request and WebSocket message; revalidate after account deletion, password reset and role change. Ongoing server-push behavior also needs testing, not just new requests.

## 4. Origin restrictions and host blast radius

Proposed approved-data root: D:/GORIMENT/DemoData/hci-private-synthetic (NOT created or approved). Structure: home/, projects/, release/, evidence/ and a separately ACL-protected auth/backup area. Credential stores must never be inside an exported projects/explorer root; sharing a common parent alone is not an access control.

Future operator manifest (values are a proposal, not an applied .env):
- HOST=127.0.0.1, PORT=10275.
- HERMES_CONTROL_HOME -> synthetic home; HCI_AUTH_HOME -> dedicated protected synthetic auth store. Both need explicit configuration: auth.js defaults independently to the OS user's ~/.hermes.
- HERMES_PROJECTS_ROOT -> synthetic projects only, never D:/, repository root, all worktrees or the real Hermes home.
- HERMES_CONTROL_ROOTS -> explicit JSON allow-list of synthetic public project roots only. Do not use a broad fallback or add the auth/backup directory.
- HCI_SESSION_SECURE=true, HCI_SESSION_COOKIE_NAME=hci_private_demo_auth (different from operator cookie), HCI_SESSION_COOKIE_MAX_AGE=3600 (proposed browser lifetime).
- HERMES_CONTROL_PASSWORD and HERMES_CONTROL_SECRET -> unique demo-only material via an approved secret store, not literal values in this document or Kanban. Do not inherit real GATEWAY_API_KEY/provider/API credentials.

Use a dedicated non-admin OS account/VM/container with no read access to real Hermes homes, source secrets or business/customer files. Environment overrides alone do not sandbox subprocesses; HOME/USERPROFILE, other platform data paths, executable discovery and outbound requests must be reviewed. Use fixture-only board storage and no live gateway, scheduled jobs, provider/broker access or dispatcher capable of executing synthetic tasks. Deny outbound access except specifically approved private-ingress/certificate/identity requirements; never blanket-disable the existing host's operational network.

Required before enable: loopback-only bind including IPv6 review; deny direct inbound 10275 for LAN/WAN/tailnet; no portproxy/router/NAT rules; scoped firewall evidence without disturbing 10274/other services. A Windows firewall change is operator-approved work; no blanket firewall resets. Verify direct access fails from independent authorized and unauthorized test devices, not just a localhost probe.

Check canonical filesystem boundaries including mixed case, traversal, NTFS junctions/symlinks/8.3 aliases. Non-admin raw files are denied; sanitizing the UI alone is insufficient. Test that a marker outside the synthetic root cannot be read and that rollback does not widen scope.

## 5. Trusted proxy, cookies and session limits

Candidate source facts at c46ecdbd:
- server.js:161-168 sets HttpOnly, SameSite=Lax, Path=/ and conditionally Secure; cfg.session.secure can force it.
- server.js:186 trusts one proxy hop. getClientIp at 1079-1082 independently uses the FIRST supplied X-Forwarded-For value without verifying its source. This is a static trust-boundary hazard; it is not a demonstrated live compromise.
- Token TTL at 1984 is hard-coded 24 hours. Reducing cookie Max-Age does NOT reduce bearer-token lifetime. Logout revocations at 1985/2182 are an in-memory map; process restart loses that map. Do not promise durable logout revocation with unchanged signing material.

Required design: only the approved local proxy reaches the origin; proxy overwrites/removes client-supplied Forwarded, X-Forwarded-For, X-Forwarded-Proto and identity headers; use a pinned/verified header trust chain. If this cannot be proven with the selected gateway, developer correction is required before GO. Never increase trust proxy blindly or call supplied X-Forwarded-Proto proof of TLS. TLS terminates at the gateway; plain HTTP is permitted only on isolated loopback.

Force Secure rather than relying on auto-detection. Verify actual login Set-Cookie is Secure; HttpOnly; SameSite=Lax; Path=/, host-only/no Domain, unique cookie name and intended Max-Age. Verify cleared cookies, no token in URL/log/referrer, HTTPS-only entry and wss upgrade. Cookie port isolation does not exist: cookies on the same hostname are shared across ports, so unique naming/secret and origin review are necessary.

Use exact private-origin CORS only where required; no wildcard credentialed origins. Keep existing token-bound CSRF checks; missing/invalid CSRF on mutation must fail and cross-origin POST/WS attempts must fail without a side effect. Gateway must not accept user traffic over plaintext HTTP; HSTS may be proposed only after hostname/other-listener effects are reviewed (the candidate disables HSTS, so it is not claimed present).

Proposed session security target: 1-hour absolute server session TTL and 15-minute idle timeout; NOT implemented by setting cookie values in this candidate. The 1-hour proposal is stricter than, and compatible with, the privacy policy's 2-hour hard session maximum (policy section 5). Neither the 1-hour nor the 2-hour bound is enforced by cookie Max-Age; candidate bearer-token TTL remains the hard-coded 24 hours until a Dev change lands and is independently tested. PM must explicitly approve/resolve the server TTL/idle requirement or route a bounded correction; do not silently label it enforced. Regardless, account expiry within event window and per-request checks remain mandatory. Logout/restart replay must be negatively tested; signing-secret rotation + fresh account/session provisioning is the safe containment fallback during restart/recovery, not durable logout by assumption.

## 6. Rate limits and abuse controls

Source defaults, not measured gateway behavior: global 150 requests/min/IP; login max 5 requests per 15 min via getClientIp (do not rely on the comment implying failed-only counting); chat and terminal 30/min/IP, though demo roles must never reach those operations. Test overrides HCI_LOGIN_RATE_MAX/HCI_GLOBAL_RATE_MAX must not leak from a test environment into staging.

Proposed controls: retain or tighten default limits after small scoped load tests; add gateway per-identity/device limits where supported, bounded body/concurrency/WS message limits and no agent-spawn capability. Do not claim that a tailnet proxy natively supplies all these limits. Multiple users collapsed to one proxy IP or spoofed XFF can distort quotas: prove actual key behavior with two synthetic users and forged headers before release. Expected over-limit result is 429 with retry/rate-limit information, no side effect; fresh benign traffic recovers after the window. No high-volume testing against live services.

## 7. Audit, privacy and retention

Record UTC time, environment/release SHA, true HCI actor and separately verified network identity where available, action, route without sensitive query strings, scoped object ID, result/denial and correlation ID. Required: sign-in success/failure, logout, expiry/revocation, account/scope changes, reviewer decisions, authorization denials, rate-limit events and operator enable/disable/restore/rotation. Candidate successful-read auditing remains a known follow-up in t_2b292174; do not claim complete audit coverage.

Logs must exclude passwords, tokens, Cookie/Authorization headers, secrets, request bodies, raw customer data and unnecessary filesystem names. Use OS ACL-protected append/rotation storage outside the served roots; restrict read access to operator/approved QA. A logging failure must alarm/block demo acceptance, not silently pass. Source identity absence must be shown as unknown rather than forged from headers. Security events keep minimal IP precision where security permits and no bodies/prompts/query strings/auth headers.

Data scope: invented tasks/status/profiles/prompts/artifacts only (policy C03-C09, C15, C19-C20). Never copy real homes, operational boards, session/log databases, provider configs, usage/billing/customer/trading data or credentials (C10-C14, C18 prohibited). Scan fixtures and rendered/API payloads for internal absolute paths and operational IDs; negative-test other profiles and task IDs. Reviewer input is limited to predefined safe labels (section 3), so no tester free-text enters any data class below.

### 7.1 Data-class split (v2)

Two classes are handled differently. Do not mix them in one store, backup or attachment.
- Class S — source-only / pre-creation records: reviewed release/dependency manifest, versioned policy and seed-fixture templates (hand-authored synthetic, hashed), config REFERENCES (no secret values), pre-creation listener/ACL/firewall state receipts, the empty pre-creation users-store template, and tests. Non-personal; may be retained as versioned engineering records (policy section 5 "immutable policy/source-only synthetic templates/tests"). Contains no tester identifiers, private security logs, auth hashes or session data.
- Class M — mutable runtime data created after enable: hci-users.json with real demo accounts and password hashes, sessions/tokens, mutable synthetic SQLite DB + WAL/SHM, workspaces/temp/preview files, browser caches, reviewer decisions, private invitation/actor mapping, notice receipts, security/audit events, gateway/CDN/SDK telemetry copies. Treated as personal or security-sensitive data even when the content is synthetic.

### 7.2 Proposed conservative lifecycle baseline (policy section 5; NOT adopted, NOT implemented)

PM/owner must adopt and freeze actual UTC timestamps for each row on the existing gate card before invitations. Inactivity never resets an expiry. Extension needs recorded purpose, lawful basis if personal data, approver and a new explicit deadline. Shorter is preferred.

| Record (class) | Proposed clock | Owner / required evidence |
| --- | --- | --- |
| Auth session (M) | Server-side hard maximum 2 h (policy); proposal 1 h absolute + 15 min idle; never later than account/demo expiry; revoke on logout/disable | Dev: HTTP+WS rejection; candidate token TTL is still 24 h, so this is an open Dev/PM gate |
| Demo account / invitation (M) | Expire at scheduled demo end; hard max 7 days from issuance; immediate revoke on cancellation | Ops: unique identity, rejection proof |
| Mutable synthetic DB / workspace / temp / previews / browser caches (M) | RESET between tester sessions (restore from Class S template, not from a mutable snapshot); stop access at demo end; remove within 24 hours after demo end | Ops: isolated inventory, absence and cache checks, old URL/token denied |
| Private invitation mapping / security events / notice receipt (M) | Minimum needed; delete within 7 days after demo end unless an approved retention assessment or legal hold | PM/Ops: restricted access only; never in general Kanban |
| Sanitized QA/support evidence (non-personal) | Delete 7 days after evidence creation | Canary/Ops: expiring store + receipt. Kanban attachment deletion/auto-purge is UNVERIFIED; only non-personal synthetic evidence may go to Kanban at all |
| Gateway / CDN / object-cache / SDK telemetry copies (M) | Maximum 7 days after demo end where configurable | Ops inventories the ACTUAL processors and their retention/deletion capability before GO; an unsupported or conflicting minimum needs an approved documented alternative before GO |
| Mutable backups (M) | NONE by default — no mutable demo backups by default (see 7.3) | Only under the 7.3 exception |
| Class S templates/tests/policy | Retain as versioned non-personal records | No promise to erase Git/canonical history |

Disposal procedure (each deletion is a separate explicitly approved destructive action, NOT performed or authorized here): revoke accounts/sessions and stop access -> inventory isolated DB/files/exports/caches/processor copies -> execute only the approved narrow deletion -> independently verify absence (including SQLite WAL/snapshots/browser storage residue, not just UI deletion) and NO RESURRECTION on any later restore -> keep a non-personal receipt (dataset/version, aggregate counts, action/time/result/verifier/exceptions). Do not delete live board/history.

### 7.3 Backup default and mutable-backup exception

Default (v2, replaces v1 "Backups inherit the same classification and deletion policy"): SOURCE/TEMPLATE-ONLY RECOVERY. Recovery and between-tester reset rebuild state from Class S only (pinned release + hashed synthetic fixture templates + empty pre-creation users-store template + config references + fresh demo-only secret version). No mutable-data backups by default: no backup of hci-users.json with real accounts, sessions, reviewer decisions, actor mappings, notice receipts, audit/security logs or the post-enable mutable DB.

Mutable-backup exception — only if ALL of the following are separately recorded on the existing PM/owner gate card (t_cb788474 / t_1b88d032) before enable; this runbook does not grant it:
1. Specific purpose and why template-only recovery is insufficient; owner approval reference.
2. Exact contents (named files/tables), protection (encryption, separate key custody) and named access list; stored outside every served root.
3. Precise UTC expiry no later than the matching Class M row in 7.2, number and location of copies, and the deletion method + verifier.
4. No-resurrection safeguards: a restore must never reinstate revoked/expired accounts, removed actor mappings, deleted records or a revoked signing secret; restored data is re-filtered against current revocation/deletion receipts before admission.
5. No auth hashes, logs, private mappings or raw evidence attached to general Kanban or PR; only a non-personal receipt (hash, count, expiry, verifier).

Owner/PM approves privacy notice, controller/processor and retention before invitation (section 8 G1/G5).

## 8. Approval gates and decision packet

NO-GO until all gates are recorded on existing cards; this runbook does not replace them.

G1 — Owner/operator: choose Tailscale Serve or separately reviewed Cloudflare Access; approve listener/hostname privacy, invited identities/device ACL, synthetic data/profile/board root, dedicated OS boundary, audit retention, certificate/feature/account costs and exposure window. Actual admin console/Serve feature state must be checked then; the 2026-10-10 feature-denial observation is not fresh proof. No spending/credential/network provisioning without the existing approval flow.
  G1 privacy decisions (OPEN placeholders — explicit owner/controller decisions, NOT invented or legally certified here): [G1-P1] controller legal name/address/contact and any DPO/representative; [G1-P2] actual gateway/hosting processors/recipients/locations and cross-border safeguards; [G1-P3] reviewed lawful basis per purpose (necessary access/security processing is not "consent"; notice acknowledgement is not consent); [G1-P4] actual UTC demo start/end and frozen deadlines for every section 7.2 row; [G1-P5] whether any mutable-backup exception (7.3) is approved — default is NONE.
G2 — Dev/PM: exact clean release SHA with required CI and independent review; resolve imported baseline changes and proxy/revocation/session/audit findings (F1 proxy, F2 revocation incl. logout repair lane t_71534a12, server session TTL vs policy 2 h maximum, P04 scripted-label enforcement). PR #1 has no checks at this inspection; do not merge unverified code or assume CI policy is waived.
G3 — Ops: approve specific process/environment/firewall/gateway/secret-store changes and rollback plan. BEFORE admission: Class S recovery set (section 11) must exist, be hashed, and be rebuild-tested into a non-networked synthetic location; the actual processor retention/deletion inventory (section 7.2 telemetry row) must be recorded. A mutable-data backup exists only if G1-P5 approved it, with its 7.3 record. Only a current assigned deployment card authorizes execution after the owner gate; this planning card never does.
G4 — Independent Canary: approved staged SHA/URL, security and disable/restore/old-build replay evidence plus lifecycle evidence (reset between testers, no resurrection, category clocks) (t_f945ce69 / current staging QA lane). Prior local authorization unit tests do not satisfy this.
G5 — PM t_cb788474: cite matching Dev+Ops+Canary evidence, privacy/UX decisions and explicit owner exposure authorization. Requires: privacy policy (pinned v1 hash in section 0 or a replacement) ADOPTED via t_1b88d032 with independent review t_bd17ad8c; approved privacy notice delivered BEFORE invitation/auth collection with no placeholders (policy section 6, P07; UX t_411a03f1); G1-P1..P5 resolved. GO applies to the bounded invited-user private demo only; public release remains prohibited.

Decision request to owner is limited to G1 and genuine implementation/secret/network approvals. Routine implementation detail is PM/team-owned. Missing CI registration is not proof that an unobserved owner fork opt-in is required; keep the existing CI repair lane.

## 9. Enable procedure — future authorized operator only

1. PM confirms G1/G2 and a unique deployment owner/lease/change window. Re-read current board, open PRs and existing listeners; no duplicate writer or process.
2. Pin the reviewed release and record commit/build/dependency hashes. Never copy unowned dirty main. Inspect release .env/config for prohibited inherited paths without disclosing secret contents.
3. Confirm G5 privacy preconditions are recorded (policy adopted, notice approved, G1-P1..P5 decided, actual UTC deadlines frozen); otherwise stop. Create only owner-approved synthetic data/home/auth under least-privilege ACL; provision unique material through approved secret tooling. Complete operator-only admin bootstrap before ingress. Seed synthetic board/profile fixtures only from hashed Class S templates, with execution disabled.
4. Capture baseline operator health, listeners, firewall/NAT/proxy policy and `tailscale serve status --json` in protected evidence. Confirm proposed 8443/10275 do not collide. An empty Serve config is not permission to configure it.
5. Complete the Class S template-only rebuild drill in section 11 (and, only if G1-P5 approved an exception, the 7.3 mutable-backup drill). Verify off/undo syntax for the installed CLI and exactly this node listener. Its service get-config/set-config commands are not a blanket node configuration backup/restore procedure.
6. Start only the isolated instance after authorization. Verify process owner, effective roots/auth paths/loopback bind and sanitized startup diagnostics. Perform local allow/deny checks with synthetic credentials; confirm real operator health unchanged.
7. On owner-approved Tailscale path only, installed help supports the proposed enable form `tailscale serve --bg --https=8443 http://127.0.0.1:10275`. This is a reviewed command example, not a command executed here; verify feature/grants and displayed URL first. No --yes, reset, --all, Funnel or unsafe TLS bypass. If a port/config is already owned, stop and obtain a scoped plan rather than overwrite it.
8. Capture exact private URL/valid certificate/HTTPS+wss behavior and sanitized headers. Run T01-T10 below with independent testers within the approved window. Disable admission immediately on a failing safety check. Invitations/external messages are operator-approved communications, not performed by a bot from this card; the approved notice precedes any invitation or gateway/auth collection.
9. PM records private-demo GO only after gates are satisfied; keep rollback contact/operator on duty. No automatic restart reopening a revoked endpoint.
10. During the event: between tester sessions, revoke the previous session, reset mutable synthetic DB/workspace/temp/previews from Class S templates (never from a mutable snapshot) and verify prior tester's state/decisions are absent before the next login.
11. After the event (each a separately approved destructive action, not authorized here): stop access at demo end; mutable synthetic data/workspaces/caches removed within 24 h after demo end; private mapping/security events/notice receipts within 7 days after demo end; sanitized QA evidence 7 days after creation; processor telemetry per the recorded inventory (max 7 days after demo end where configurable). Keep only non-personal receipts.

## 10. Disable and incident containment

Trigger immediate NO-GO for unexpected network exposure, unauthorized success/data leak, missing audit, header/identity spoofing, account/token reuse after revocation, uncontrolled agent execution or failure to restore. An actual incident containment change still follows the pre-approved operator emergency authority; agents do not infer permission from this text.

1. Deny new admission by removing only the demo grant/listener using the installed CLI's operator-verified exact scoped syntax. Do not execute an unvalidated off command, blanket `tailscale serve reset`, service clear/set-config --all, or remove unrelated access.
2. Stop only the approved demo process/supervisor restart policy; do not stop the operator HCI or Hermes gateway. Preserve restricted sanitized evidence before changing stores; keep incident secrets outside Kanban.
3. Revoke named demo network/HCI access. Account expiration on the candidate is an immediate control, but older-build rollback requires actual removal/pre-creation store restore. Rotate compromised demo-only signing material; do not change operator secrets.
4. Independently verify private endpoint unavailable to prior invitees, no direct origin listener/bypass, no residual WS, no auto-respawn, and unchanged operator listener/health. Snapshot resulting config and compare with the baseline; unrelated differences must be explained.
5. Record UTC incident window, affected release/data scope, actions, sanitized evidence handles, operator and next remediation. Owner decides notifications, credential rotation and any re-enable; no automatic public message or restart.

Contacts: owner-approved human incident operator + alternate/contact channel MUST be filled in a restricted Kanban approval comment before enable. Role escalation: gorimentops contains; gorimentcanary validates/preserves evidence; gorimentpm coordinates NO-GO/remediation; owner authorizes re-exposure. These bot roles are not fabricated human contact names or permission to contact outsiders.

## 11. Backup, restore and rollback

Proposed recovery objective: RTO 30 minutes as a drill target for rebuilding from Class S, NOT a demonstrated SLA. Mutable runtime data has no recovery point by default (it is disposable demo state); owner may choose another target only through the 7.3 exception.

Default recovery set (Class S only, section 7.1): exact approved release/dependency manifest; effective demo process env/config REFERENCES (no secret values); hashed synthetic seed-fixture templates for homes/projects/board/SQLite schema; the EMPTY pre-creation users-store template (operator bootstrap redone, no demo/tester accounts); specific pre-creation listener/ACL/firewall state receipts; secret-store version references (a fresh demo-only signing version is issued on recovery, never a restored one). No live operator home/account backup is taken by this card. Not in the default set (Class M, policy section 5): hci-users.json containing demo accounts/password hashes, sessions/tokens, post-enable mutable SQLite DB/WAL/SHM, reviewer decisions, private actor mappings, notice receipts, audit/security logs and processor telemetry. Audit/security events are retained only in their own restricted append store under the 7.2 clock, not copied into a backup.

Class S preparation before enable: generate templates from source (never by copying a running mutable DB), record UTC, SHA256 per file, release/store schema and size; store outside all served roots with OS ACLs. Templates contain no personal data, auth hashes or secrets, so a non-personal hash manifest may go to Kanban; the files themselves stay in the protected recovery area.

Rebuild drill (template-only): rebuild into another non-networked synthetic location from Class S; verify hash/manifest/schema, fixture marker/row counts, that the users store contains ONLY freshly bootstrapped operator material and zero demo/tester accounts, and least privilege, using documented expected fixture values. Do not overwrite live storage or copy credentials into the working operator home. Record measured rebuild duration and any gap; a failed drill leaves GO blocked. If (and only if) G1-P5 approved a mutable-backup exception, ADDITIONALLY: quiesce writes, use a supported consistent SQLite backup (never copy a running DB ignoring WAL), encrypt with separately held key, restore to a COPY and prove the 7.3 no-resurrection filter (revoked/expired accounts, removed mappings, deleted records and the revoked signing secret are NOT reinstated), then delete per the recorded expiry.

Rollback order:
1. Close ingress and stop the demo process, preserve incident evidence, ensure no auto-restart.
2. Select pinned previous reviewed release/config and Class S fixture templates compatible with the selected data schema. If incompatible, remain offline for controlled migration; never default to old unsafe auth behavior merely to restore availability.
3. Remove EVERY demo-viewer/reviewer record from the effective users store read by an older build, or rebuild from the verified empty pre-creation users-store template containing none. Candidate expiry alone is unsafe: ee0f580 ignores expires_at and unknown roles fall back to legacy viewer. Preserve operator accounts only within their own instance; do not mix stores.
4. Invalidate sessions and replace the DEMO HERMES_CONTROL_SECRET using the approved secret-version flow before restarting any previous build. In-memory logout/revokedTokens and a process restart are not durable invalidation. Do not restore a revoked old signing secret from backup.
5. Restore only scoped demo data/config/listener pre-state; no blanket gateway/firewall restore. For prior empty node Serve state, removing the sole demo listener must produce empty node status; for non-empty state preserve all unrelated entries. Service-format set-config is used only for a deliberately approved service configuration, not assumed for node listener restoration.
6. In isolated old-build tests, login with removed accounts must fail and prior signed cookie/token must fail authenticated API/WS access. Test existing authorized synthetic admin where appropriate. Do not write a raw token/password into a log or evidence file.
7. Verify containment/operator unaffected, manifest integrity and T09/T10. Keep private admission OFF until independent QA and a new owner/PM gate approve re-enable. A rollback to previous vulnerable RBAC is never an invited-user release.

## 12. Secret rotation

Inventory owner-controlled secrets by reference, purpose and scope only: demo HERMES_CONTROL_SECRET (HMAC), demo HERMES_CONTROL_PASSWORD/bootstrap requirement, individual user passwords, any approved private ingress credentials and (only under an approved 7.3 exception) mutable-backup encryption keys. Tailscale certificate/node/IdP material belongs to the human network operator; no extraction, copying or invented credential repair.

Triggers: demo issuance/end, suspected leak, role/scope incident, recovery/restart where revoked tokens might replay, relevant personnel/device removal, or owner-approved periodic policy. Issue fresh demo-only signing/bootstrap material before first use. No plaintext/random example secrets in this runbook, shell history, PR, task metadata or prompts.

Approved rotation sequence: close demo ingress -> capture sanitized evidence and Class S references (no mutable backup by default) -> operator creates a new vault/secret-store version -> apply only to demo instance -> restart controlled process -> reset/remove affected per-person accounts through an approved flow -> negative-test prior credentials/cookies/WS, positive-test a fresh synthetic login -> record version reference/time/operator/test results -> independent verification -> re-enable only under renewed gate. Never dual-accept a compromised signing key. Rotation rollback keeps admission off and must not restore a compromised/revoked version. Secure handling and any real credential change require the existing operator gate; none occurred here.

## 13. Future acceptance tests and completion verification

All below are NOT RUN for this planning card. Run only against an owner-approved isolated staging target; use two individually scoped synthetic accounts plus an independent denied device. Store sanitized outputs, expected/actual result, UTC, exact SHA/config manifest and verifier identity.

Status of every test below: NOT_RUN (future, owner-approved staging only). Each line gives the concrete expected result; a mismatch is a FAIL and keeps NO-GO.

T01 network — NOT_RUN. Expected: invitee HTTPS 200/login path with valid cert; uninvited/removed identity denied at the gateway; direct LAN/WAN/tailnet access to 10274/10275 fails; no Funnel/public path; loopback bind and scoped firewall evidence. Approved notice was delivered before the first invitation/gateway collection (receipt exists in the restricted store, not Kanban).
T02 identity — NOT_RUN. Expected: no generic/shared admin; bootstrap closed; allowed_profiles/boards and reviewer_scope exact; account expiry <= scheduled demo end (hard max 7 days from issuance) rejects HTTP and per-message WS; gateway identity alone never yields an HCI role.
T03 cookies/TLS — NOT_RUN. Expected: Secure/HttpOnly/SameSite=Lax/host-only/unique name/intended browser lifetime, HTTPS-only entry and wss; no cookie/token leakage. Server session is rejected after the implemented absolute bound, which must be <= 2 h (policy max; 1 h + 15 min idle proposed); cookie Max-Age is NOT accepted as evidence of this. Against the unchanged candidate (24 h token TTL) this check is expected to FAIL and stays a G2 gate.
T04 proxy — NOT_RUN. Expected: client-supplied XFF/proto/identity cannot spoof attribution or bypass login/global limits (F1 hazard, card t_03d4deb8); direct local input and end-to-end gateway sanitization, IPv4/IPv6 and multiple identities, without harming live services.
T05 authorization/input — NOT_RUN. Expected: Demo Viewer cannot mutate board/tasks or terminal/filesystem/sessions/logs/secrets/users/gateway/config/restart/update/backup. Reviewer positive scripted test: one predefined safe label (C20/P04) on an approved synthetic ID succeeds and records the private true actor. Reviewer negative tests: arbitrary free text, upload, prompt, webhook, tool call, dispatch and labels on non-scoped IDs are rejected server-side with no stored side effect; disallowed profile/task returns 403/404 without existence/data leak; admin regression preserved.
T06 CSRF/session — NOT_RUN. Expected: missing/invalid CSRF and cross-origin mutations/WS fail; logout/password reset/deletion/expiry/role change deny previous cookie and open WS; after process restart and after old-build rollback a previously logged-out token is still denied via secret rotation or durable revocation — volatile in-memory logout is not accepted (F2 hazard, card t_71534a12).
T07 limits/audit — NOT_RUN. Expected: 429 at reviewed limits; recovery after window; true actor plus sanitized denial/decision/login/rotation events with no bodies/prompts/query strings/auth headers; audit gaps resolved (successful-read audit gap, t_2b292174) and a logging failure prevents GO.
T08 data and lifecycle — NOT_RUN. Expected: (a) only approved Class S synthetic fixtures visible; traversal, case/junction/alias marker outside root inaccessible; no real paths, memories, provider configs, usage/billing/customer/trading data; OS ACL/outbound boundary verified. (b) Reset between testers: tester B after reset sees the fixture baseline and none of tester A's decisions/workspace/temp/preview/browser-storage state. (c) Category clocks on a synthetic dry-run with frozen UTC deadlines: mutable data/workspaces/caches absent <= 24 h after demo end (including SQLite WAL/SHM and browser storage, not just UI); private mapping/security events/notice receipt absent <= 7 days after demo end; sanitized QA evidence deleted 7 days after creation; telemetry per the recorded processor inventory. Each deletion step uses a separately approved action and leaves a non-personal receipt.
T09 recovery/no-resurrection — NOT_RUN. Expected: default path rebuilds from Class S templates only; hashes/schema/fixtures match manifest; users store contains zero demo/tester accounts; a fresh signing secret version is used; measured RTO recorded; no mutable-data backup exists unless G1-P5 approved one (absence verified in the backup-location inventory). Only if an exception was approved: encrypted consistent copy restored to a COPY, and revoked/expired accounts, removed mappings, deleted records and the revoked signing key are NOT reinstated; exception copy deleted at its recorded expiry.
T10 disable/rollback — NOT_RUN. Expected: only demo ingress/process/grants removed via operator-verified node-scoped off/restore syntax (no reset/--all; service get/set-config not used for node listeners), existing operator unchanged, no residual WS/auto-restart; old-build start uses a users store with no demo records and a replaced signing secret, so old-account login and prior token fail (expiry alone is not accepted as the control); unrelated config preserved; renewed gate required for re-enable.

Documentation acceptance for this task (v2 adds F4a/F4b reconciliation, checked by validate_runbook_v2.py): all requested subjects and operator gates are covered; source revisions/provenance preserved; current plan distinguished from historical/runtime facts; existing work reused without conflicting edits; document coverage/source-hash checks logged. Independent documentation QA follows via Kanban. This check is NOT deployed-security QA, a restore drill, CI, or release acceptance.

## 14. Scoped directive to gorimentpm

Use this documentation packet as a supplement to existing draft PR #3; do not create a duplicate PR or alter someone else's worktree. ACK/BLOCKED in the linked Kanban card, reconcile static proxy/restart/session findings against existing Dev and CI lanes before routing any new fix, and require independent documentation review. Keep t_56a8d947/t_cb788474 NO-GO until real owner gateway/data/identity approval and Dev/Ops/Canary evidence exist. Review missing successful-read audit coverage as already recorded in t_2b292174, not a duplicate claim. Future implementation belongs to the correct bounded isolated owner and exact-SHA QA; no infrastructure/settings changes from this envelope.

Return a structured report with acknowledged scope/owner, changed paths + commit (or no source change), exact tests/log handles, severity and deduplicated finding/card IDs, unresolved owner gates, blockers and one next action. Card creation is a queue handoff, not proof of dispatch or implementation; require the actual worker acknowledgement/evidence before reporting execution.

## 15. v2 change log versus v1 (F4 repair)

- Section 0 (new): pinned privacy policy v1 hash 667791087fbb3084a9eb68490af2daeeb48c55a6e8bb9afffaff82065965c426 and its NOT-adopted status (research t_d21e61b4 BLOCKED on t_3e118c44; adoption t_1b88d032, review t_bd17ad8c); controls are a proposed conservative baseline. Hazard cards F1 t_03d4deb8, F2 t_71534a12, audit t_2b292174; re-review t_c2563df6; PR #3 consolidation t_7a15da2d; F3 corrections retained.
- Section 3: reviewer input limited to predefined safe labels (C20/P04); private actor mapping is personal data.
- Section 5: 1 h server TTL proposal compatible with policy 2 h max; neither enforced by cookie Max-Age; candidate token TTL remains 24 h.
- Section 7 (F4a/F4b): Class S vs Class M split; lifecycle table with reset between testers, <=24 h mutable cleanup, <=7 d private mapping/security/notice, QA evidence 7 d from creation, telemetry processor inventory; 7.3 source/template-only recovery default replacing v1 "backups inherit policy"; mutable-backup exception requires purpose/owner approval, protection/access, precise expiry/copies/deletion and no-resurrection safeguards.
- Section 8: G1-P1..P5 explicit privacy decisions (controller, processors, lawful basis, UTC deadlines, backup exception) as open placeholders, not invented or certified; G2-G5 aligned.
- Section 9: privacy preconditions before data creation; notice before invitation; between-tester reset (step 10) and post-event disposal clocks (step 11), none authorized here.
- Section 11: default recovery set is Class S only; template-only rebuild drill; mutable SQLite/auth/audit backup only under the approved exception.
- Section 12: backup keys only under exception; rotation captures Class S references.
- Section 13: T01-T10 explicitly NOT_RUN with concrete expected results; T05 scripted-input positive/negative; T08 reset and category clocks; T09 template default vs exception and no-resurrection.
- Unchanged: topology, identity, origin, proxy, cookie, rate, audit, rollback ordering (expiry never the old-build control; volatile logout never durable restart invalidation; gateway identity never an app role), rotation, operator contacts. Release decision: NO-GO.
