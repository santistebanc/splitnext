# Deal in plain numbers without currency

Splitnext shows amounts as plain numbers with two decimals, such as 42.50, and
never asks for or shows a currency. Friends splitting costs already know what
they paid in. Choosing a currency on every expense added a step and a picker,
and splitting balances by currency made the summaries harder to read.

There are no currencies anywhere. Expenses, repayments, commands, and the
money module carry no currency code. Amounts are whole hundredths, each member
has one balance, and the rounding burden and the settle-up plan cover the
whole group.

Nothing reads older records specially. A stored record that still has a
currency field is read as a plain amount, and the field is ignored. There is
no conversion and no separate balance for it.

This supersedes [ADR 0014](./0014-record-currency-per-expense.md) and the
per-currency parts of ADR 0007, ADR 0017, and ADR 0019.
