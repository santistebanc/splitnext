# Ticket progress and conditions

GitHub labels carry progress; the project board mirrors them.

| Progress | Label |
| --- | --- |
| New intent | `status:inbox` |
| Retained for later | `status:backlog` |
| Queued and ready | `status:ready` |
| Being developed | `status:in-progress` |
| Focused implementation verified | `status:implemented` |
| Included in an integration PR | `status:integrating` |
| Integrated into the shared version | `status:done` |
| Replaced with linked successors | `status:superseded` |
| Explicitly declined by owner | `status:declined` |

Conditions are independent: `needs-info` asks for an owner decision, `factory:blocked` records a blocker, and `factory:paused` stops automatic work. Types are `bug`, `enhancement` and `chore`. Size is optional scheduling guidance.
