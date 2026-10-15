# Allocate money in whole minor units with burden-fair rounding

`src/domain/money.ts` is the money module ADR 0007 calls for. Amounts are
whole numbers of a currency's minor unit, with precision from an explicit
ISO 4217 exception table (two decimals unless listed) rather than `Intl`, so
every runtime agrees. Decimal entry is parsed as text; more decimals than the
currency has are invalid, never rounded.

An expense is allocated in one pass: exact amounts first, then the remainder
split by positive integer shares, computed with BigInt. Each share part gets
the floor or ceiling of its exact proportional amount. The extra units needed
to reach the total go to members whose exact amount is fractional, ordered by
lowest rounding burden in that currency, then largest fractional remainder,
then member id. The result does not depend on the order of participants, and
the caller keeps the returned burden per currency, so equal splits rotate
extras over time. Equal splits are one share each.

Balances are computed per currency from paid amounts, allocations, and
settlements; each currency nets to zero and never borrows from another.
Expenses carry their payers as a list, so multiple payers need no new model.

## Considered options

- **Decimal or floating-point amounts.** Rejected: sums drift and the same
  split can differ between runtimes.
- **Largest fractional remainder alone.** Rejected: identical equal splits
  would always give the extra unit to the same member.
- **Allocate in clients and store only inputs.** Rejected by ADR 0007; final
  allocations are persisted with each expense.

## Consequences

Expense commands will validate with `expenseBalances` and persist the
allocations and updated burden this module returns. `test/money.test.ts`
checks the exact-total, within-one-unit, order-independence, fairness, and
per-currency zero-sum properties; the convergence test should add the
zero-sum check once expenses synchronize.
