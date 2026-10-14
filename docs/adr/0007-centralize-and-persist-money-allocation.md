# Centralize and persist money allocation

Put exact amounts, shares, mixed allocation, and deterministic minor-unit
rounding behind one pure money module, then persist its finalized allocations
with each expense in its own currency. Track rounding burden across expenses
of the same currency so unavoidable extra minor units can be distributed fairly
over time. This prevents clients, routes,
and storage adapters from independently reproducing financially sensitive
logic and leaves one seam for later multi-payer support.
