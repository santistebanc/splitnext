# Use intent-specific convergence rules

Resolve concurrent offline work with deterministic rules and preconditions
specific to each command, producing applied, no-effect, superseded, or rejected
outcomes. Share these pure transitions between server authority and optimistic
client projection. This preserves valid independent edits without the
complexity of CRDTs or a generic conflict engine and without rejecting every
command from a stale group revision.

Members with the same name are distinct members, so concurrent creations never
merge; ADR 0020 replaced the earlier merge-by-name rule and its member aliases.
