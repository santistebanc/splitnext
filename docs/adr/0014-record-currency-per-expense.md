# Record currency per expense and keep balances separate

Trips can include expenses in several currencies, so currency belongs to each
expense and settlement; groups have no currency setting. Calculate and show
balances separately for each member and currency, with no cross-currency
netting or converted total, preserving original amounts and allowing offline
work without an exchange-rate dependency. Allocation precision and accumulated
rounding burden belong to each currency, and repayments reduce only balances
in the settlement's currency.
