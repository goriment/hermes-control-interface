# RBAC path isolation review round 2

Date: 2026-10-11 (Asia/Bangkok)
Board: goriment-control; implementation card t_2b292174.
Base: 64c7ff8ad5d9f12cae40d1294f98ac697f95c5e6.

The worktree already contained uncommitted canonical-path and workspace guards from the prior implementation. These changes are preserved in this follow-up. The additional change denies unclassified default-profile root entries and adds API regression tests that exercise an account with both alpha and default access.

Coverage: profiles/Profiles/PROFILES/pRoFiLeS and mixed-case profile names on Windows; GET file, GET files/list, POST file; workspace file reads/writes and listings; a real Windows junction from an allowed profile to a denied profile; explorer filtering; unknown default-root directories; positive reads of an allowed profile; denied writes leave the other profile unchanged.

Validation on Windows, Node v24.18.0:
- node --test test/rbac.test.js: exit 0, 28 passed, 0 failed, 0 skipped (process 9044).
- node --test test/*.test.js: exit 0, 41 passed, 0 failed, 0 skipped (process 30724).
- Tests launch the real server using temporary synthetic Hermes home and test accounts. No production credentials or datasets are used.

This is implementer validation. Independent Canary review on the exact follow-up commit remains required. No live server update, merge, staging exposure or release GO is included. Existing RBAC branch baseline contains unrelated earlier modifications; reviewers must assess them separately before merge.
