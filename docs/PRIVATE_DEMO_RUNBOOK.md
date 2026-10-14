# Private demo runbook (proposal; NO-GO)

Board: goriment-control / t_56a8d947. Prepared 2026-10-11.

## Proposed bounded environment

Use a separate demo instance on loopback 127.0.0.1:10275, leaving the operator instance on 10274 unchanged. Proposed data root: D:/GORIMENT/DemoData/hci-private-synthetic. This is a proposal, not an approved dataset or an applied configuration. Use only invented tasks, prompts, profiles, names and artifacts; never copy the real Hermes home, sessions, logs, user store, provider configuration or credentials into it.

Set HERMES_CONTROL_HOME and HCI_AUTH_HOME to a dedicated synthetic Hermes home under that root; HERMES_PROJECTS_ROOT and HERMES_CONTROL_ROOTS must point only to the synthetic root. HOST must remain 127.0.0.1. Separate per-instance session signing material and per-person expiring demo accounts are required. Do not reuse operator/admin credentials. Do not reuse live kanban boards or gateway actions.

Proposed gateway: existing Tailscale Serve, because Tailscale is already installed. This avoids adding another service; the owner still must choose the gateway and enable Serve in the tailnet console. Cloudflare Access remains an alternative requiring separately reviewed provisioning. Tailscale Funnel/public access is outside this release.

## Before enable

1. Obtain independent acceptance of the exact RBAC commit and review its baseline changes. Current patch candidate: c46ecdbd165a40405f953889c78729a7d9445e1d, draft PR #1 (supersedes the stale 9967aa5 reference; re-read the PR #1 head before use, it is not exact-head CI evidence). Obtain PM gate review (draft PR #2), privacy classification and UX acceptance.
2. Record owner choice of gateway, synthetic data root, invited identities and narrow tailnet access policy. Export existing Serve configuration before changing any listener. Confirm the tailnet feature is enabled; do not alter exit-node/network settings.
3. Verify isolated process environment and loopback bind; confirm no production files appear in the synthetic dataset. Use a dedicated reviewed copy of the approved SHA. Never run the unreviewed dirty live checkout for the demo.
4. Confirm no direct inbound firewall allowance or port proxy exposes demo port 10275. Test direct access is denied from an unauthorized device and allowed gateway access requires an invited identity.

## Enable only after recorded approval

The installed CLI advertises `tailscale serve --bg --https=<port> <target>`. Select a dedicated HTTPS listener after reviewing existing Serve config (proposed 8443), proxy to http://127.0.0.1:10275, and keep all access tailnet-private. Do not overwrite existing listeners or enable Funnel. Verify the displayed private URL rather than inventing a host name.

Verify actual Set-Cookie includes Secure, HttpOnly and SameSite; enforce account expiry within seven days, immediate logout/password-change revocation and scoped board/profile/task access. Verify CSRF, rate limits, expiry on WebSocket sessions, negative authorization and correct audit actors over HTTPS. Attach identity, exact SHA, timestamps, command results and approved URL to the Ops and independent QA cards.

## Disable and rollback

Remove only the demo node Serve listener. Installed Tailscale 1.102.3 help scopes `serve get-config` / `serve set-config` to service configuration (`--service`), not to a node listener backup/restore, and `set-config --all` overwrites all endpoint handlers for all services; do not use set-config, `clear`, `--all` or `tailscale serve reset` to restore node listeners. The node-scoped disable/restore form (for example a per-listener `tailscale serve --https=8443 off`) is OPERATOR-VERIFIED-BEFORE-EXECUTE: confirm the exact syntax against the installed CLI help and current `tailscale serve status --json` for exactly this one listener before running it; nothing here was executed. Retain every unrelated Serve listener/service unchanged; if the pre-enable node status was empty, removing the sole demo listener must return empty status, otherwise compare against the exported baseline and explain any difference. Stop the isolated demo process, revoke demo accounts, verify the private URL stops responding and check loopback/public listeners. Restore only demo-specific environment/config from the pre-enable copy; the live operator instance must remain unchanged. Canary must execute and evidence this rollback before GO.

## Data and retention proposal

Allowed: synthetic task/status/agent data. Mask internal absolute paths, operational identifiers and account names. Prohibit credentials, tokens, secrets, real sessions/logs/uploads and provider/billing metadata. Review sanitized denial/audit evidence before attaching it. Proposed deletion: remove synthetic dataset and demo accounts after the demonstration; retain sanitized QA evidence for seven days unless the owner records another retention period. Privacy/notice and retention acceptance is still owned by t_d21e61b4, not established by this proposal.

## Incident ownership

Ops disables the demo listener/process; Canary preserves sanitized evidence; PM coordinates remediation and records NO-GO; the owner authorizes any new exposure. Record real contact identities in the private board, never invent incident contacts in public documentation.

## Detailed supplement and open hazards

The detailed private HTTPS staging/rollback supplement is docs/PRIVATE_HTTPS_STAGING_RUNBOOK.md, committed byte-identical to the QA-passed v2 packet (SHA256 c9f96bacde33c994ba12d0af2e4f565e1c0a57c84a7a6a75cafa039db56eb0de; authored on t_3cbf5e9d, independently re-reviewed PASS on t_c2563df6, validator validate_runbook_v2.py SHA256 603b1450cd4db860f5e7c0b4291d6634db65cc33abc0b8add34187e02461980a). Where this short proposal and the supplement differ, the supplement governs. Neither document is GO.

Open hazards (static/documentation findings, no runtime exploit claim; none resolved by this document):
- F1 trusted-proxy / first X-Forwarded-For attribution of login and global rate limits: t_03d4deb8.
- F2 logout revocation is an in-memory map lost on process restart: t_71534a12. The "immediate logout revocation" requirement above is therefore NOT met durably by the candidate; secret rotation plus fresh accounts is the containment fallback.
- Successful-read audit gap: already tracked in t_2b292174 (its docs, line 123); complete audit coverage is not claimed.
- The candidate's server token TTL is hard-coded 24 hours; setting cookie Max-Age (for example HCI_SESSION_COOKIE_MAX_AGE=3600) does NOT shorten it.
- Session-control proposal (1 hour absolute / 15 minute idle server session, versus the pinned privacy-policy 2 hour maximum) is UNADOPTED and unimplemented, pending the t_b9e54840 G-decision.

Release remains NO-GO under t_56a8d947, t_cb788474 and t_f945ce69.

## Current evidence limits

CLI Serve help and repository configuration were inspected. No gateway, firewall, live environment, credentials or demo process were changed. The owner gateway/data decisions and positive HTTPS/rollback/independent staging evidence are still outstanding.
