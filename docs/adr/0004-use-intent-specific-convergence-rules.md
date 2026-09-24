# Use intent-specific convergence rules

Resolve concurrent offline work with deterministic rules and preconditions
specific to each command, producing applied, no-effect, superseded, or rejected
outcomes. Share these pure transitions between server authority and optimistic
client projection. This preserves valid independent edits without the
complexity of CRDTs or a generic conflict engine and without rejecting every
command from a stale group revision.

When two offline devices add a member with the same name, the later creation
merges into the existing member instead of being superseded. Its client-generated
id is stored as a server-side alias rather than in the snapshot, so recording it
does not advance the revision, and every later command resolves through it.
Clients also rewrite not-yet-sent commands that name the alias.
