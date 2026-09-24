# Separate audit history from synchronization

Record every applied transition in an append-only audit history with actor,
time, target, and before and after state, but do not use that history as the
client synchronization protocol. Reversals are new compensating commands rather
than history rewrites. This keeps synchronization compact while preserving
attribution, explainability, and the ability to reconstruct a group at a chosen
point for recovery.
