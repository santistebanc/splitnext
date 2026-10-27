# Deal in plain numbers without currency

Splitnext shows amounts as plain numbers with two decimals, such as 42.50, and
never asks for or shows a currency. Friends splitting costs already know what
they paid in. Choosing a currency on every expense added a step and a picker,
and splitting balances by currency made the summaries harder to read.

The ledger and money module are unchanged: every expense and settlement still
records a currency code, and balances, rounding burden, and the settle-up plan
are still kept per code. The app records the ISO 4217 code for no currency,
XXX, which has two decimal places. Keeping the code means no storage
migration, and the app can return to real currencies later without new data.

Records made with a real currency before this decision keep their code. Their
balances stay separate from plain amounts and appear as a second unlabelled
figure rather than being converted or merged.

This supersedes the display and entry parts of
[ADR 0014](./0014-record-currency-per-expense.md); its per-code arithmetic
still holds.
