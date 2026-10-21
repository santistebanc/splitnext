# Store explicit repayments separately from expenses

Settlements are versioned records in the authoritative snapshot, with the same retry-safe offline commands and audit trail as expenses. Inferring repayments from expense allocations would misclassify legitimate spending and couple repayment to rounding; explicit records keep spending and rounding unchanged. Both member references are retained, including removed settlements, so removing a member cannot erase repayment history.
