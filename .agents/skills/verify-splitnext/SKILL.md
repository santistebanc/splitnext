---
name: verify-splitnext
description: Select and execute Splitnext verification for code, behavior, build or tooling changes; interpret source-bound evidence and investigate failing gates. Does not authorize deployment or remote data changes.
---

Run `npm run verify -- discover` to select checks from the maintained
[feature map](../../../verification/features.json), then use `doctor` when runtime
prerequisites are uncertain. Commands, expected checks, side effects and limits
come from discovery rather than this skill.

Choose proportionate checks: types, schemas, pure rules and architecture changes
need deterministic gates and their focused tests; user-visible flows need their
browser regression. Changes affecting a registered promise also need that named
scenario. Keep the repository's required `check:fast` and pre-PR `check` gates.
Full e2e already includes expense recovery; a current `--built` stamp avoids a
second build. A stale stamp requires rebuilding, not bypassing validation.

Before delivery, inspect relevant run evidence through the executable `evidence`
command and account for every selected check. Evidence must match the source
being delivered; describe documentation-only differences explicitly. Preserve
failed, blocked and not-run states. A passing rerun does not erase an earlier
failure. Investigate named product assertions against the
[behavior contract](../../../docs/agents/expense-recovery.md); distinguish these
from missing fixtures, stale builds, occupied ports, harness failures and resource
contention. Categories are investigation leads, not automatic blame assignment.

Keep private traces, profiles, credentials and state local. Share only the
allowlisted public evidence, including failure records and explicit limits.
Use the workflow's bounded controls to validate changed detectors; its real-path
lost-outbox control is distinct from oracle-input corruption. Stop only owned
processes. Report commands, source identity, evidence locations and unresolved
failures rather than summarizing a partial run as green.
