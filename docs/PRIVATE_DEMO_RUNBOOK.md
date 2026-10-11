# Private demo runbook (proposal; NO-GO)

Board: goriment-control / t_56a8d947. Prepared 2026-10-11.

## Proposed bounded environment

Use a separate demo instance on loopback 127.0.0.1:10275, leaving the operator instance on 10274 unchanged. Proposed data root: D:/GORIMENT/DemoData/hci-private-synthetic. This is a proposal, not an approved dataset or an applied configuration. Use only invented tasks, prompts, profiles, names and artifacts; never copy the real Hermes home, sessions, logs, user store, provider configuration or credentials into it.

Set HERMES_CONTROL_HOME and HCI_AUTH_HOME to a dedicated synthetic Hermes home under that root; HERMES_PROJECTS_ROOT and HERMES_CONTROL_ROOTS must point only to the synthetic root. HOST must remain 127.0.0.1. Separate per-instance session signing material and per-person expiring demo accounts are required. Do not reuse operator/admin credentials. Do not reuse live kanban boards or gateway actions.

Proposed gateway: existing Tailscale Serve, because Tailscale is already installed. This avoids adding another service; the owner still must choose the gateway and enable Serve in the tailnet console. Cloudflare Access remains an alternative requiring separately reviewed provisioning. Tailscale Funnel/public access is outside this release.

## Before enable

1. Obtain independent acceptance of the exact RBAC commit and review its baseline changes. Current patch candidate: 9967aa5, draft PR #1. Obtain PM gate review (draft PR #2), privacy classification and UX acceptance.
2. Record owner choice of gateway, synthetic data root, invited identities and narrow tailnet access policy. Export existing Serve configuration before changing any listener. Confirm the tailnet feature is enabled; do not alter exit-node/network settings.
3. Verify isolated process environment and loopback bind; confirm no production files appear in the synthetic dataset. Use a dedicated reviewed copy of the approved SHA. Never run the unreviewed dirty live checkout for the demo.
4. Confirm no direct inbound firewall allowance or port proxy exposes demo port 10275. Test direct access is denied from an unauthorized device and allowed gateway access requires an invited identity.

## Enable only after recorded approval

The installed CLI advertises `tailscale serve --bg --https=<port> <target>`. Select a dedicated HTTPS listener after reviewing existing Serve config (proposed 8443), proxy to http://127.0.0.1:10275, and keep all access tailnet-private. Do not overwrite existing listeners or enable Funnel. Verify the displayed private URL rather than inventing a host name.

Verify actual Set-Cookie includes Secure, HttpOnly and SameSite; enforce account expiry within seven days, immediate logout/password-change revocation and scoped board/profile/task access. Verify CSRF, rate limits, expiry on WebSocket sessions, negative authorization and correct audit actors over HTTPS. Attach identity, exact SHA, timestamps, command results and approved URL to the Ops and independent QA cards.

## Disable and rollback

Remove only the demo Serve listener or restore the exact exported previous Serve configuration using the installed CLI's reviewed set-config syntax. Never use blanket reset when other services are configured. Stop the isolated demo process, revoke demo accounts, verify the private URL stops responding and check loopback/public listeners. Restore only demo-specific environment/config from the pre-enable copy; the live operator instance must remain unchanged. Canary must execute and evidence this rollback before GO.

## Data and retention proposal

Allowed: synthetic task/status/agent data. Mask internal absolute paths, operational identifiers and account names. Prohibit credentials, tokens, secrets, real sessions/logs/uploads and provider/billing metadata. Review sanitized denial/audit evidence before attaching it. Proposed deletion: remove synthetic dataset and demo accounts after the demonstration; retain sanitized QA evidence for seven days unless the owner records another retention period. Privacy/notice and retention acceptance is still owned by t_d21e61b4, not established by this proposal.

## Incident ownership

Ops disables the demo listener/process; Canary preserves sanitized evidence; PM coordinates remediation and records NO-GO; the owner authorizes any new exposure. Record real contact identities in the private board, never invent incident contacts in public documentation.

## Current evidence limits

CLI Serve help and repository configuration were inspected. No gateway, firewall, live environment, credentials or demo process were changed. The owner gateway/data decisions and positive HTTPS/rollback/independent staging evidence are still outstanding.
