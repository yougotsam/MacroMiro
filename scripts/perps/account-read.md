# Read-only perps account diagnostic

Run on an already provisioned machine, after deliberately selecting the venue account:

```sh
bun scripts/perps/account-read.ts --subaccount <ACCOUNT_NUMBER> --subaccount-type <ACCOUNT_TYPE>
# Optional existing execution journal (read only): append --journal <PATH>
```

Supported types: cross, isolated, auto_rebalance, managed_isolated. No account/type default is provided; the previous no-argument invocation intentionally fails before importing the live transport. No universal account-number cap is assumed beyond a nonnegative safe integer.

Output is stdout only: single-origin stable parsed-JSON snapshot evidence; selected/other/unowned inventory; raw orders/fills; optional exact order-ID/CID log correlations. Every journal record remains unowned, including legacy exact matches. Invalid and blank lines are retained. Correlations do not establish routing, authorization, protection, lifecycle ownership or authoritative risk. No mixed-origin balance or fill-PnL summary is produced. No writes, mode changes, observation files, triggers or worker are activated.

An unreadable journal file or failed/incomplete reader causes a nonzero exit with no successful report. Malformed individual journal lines are preserved and reported as invalid evidence, not silently dropped. Source origin identifies the configured reader endpoint, not the credential principal. Successful pagination is complete only within that reader's filters; this is not an atomic or certified account history.

The report intentionally includes private account inventory and raw journal lines. Keep its output private; error-message redaction does not redact the report.

## Request-filter evidence

The diagnostic retains its original unfiltered-by-account snapshot (visibility is still limited by credentials). It additionally performs GET-only orders/fills reads with an explicit `subaccount` URL filter. For selected reported cross positions only, it also reads cross exit triggers with that same query selector. Other position modes are not routed through cross endpoints. Evidence records actual origin/method/path/selector separately from raw response JSON; it never stamps configured account/type onto a response row.

Official REST orders/fills need not report account/type. An exact legacy order-ID/CID correlation may therefore be shown separately under requestScopedOrders when request filtering is evidenced, the order is explicitly user-sourced, the original inventory view agrees on unique ids, and no reported account fields conflict. Unknown/system orders stay unresolved; every record remains unowned. Views can change between reads: missing or conflicting mappings remain unresolved rather than treated as an atomic account snapshot. Filtered fills remain raw evidence, not lifecycle or PnL attribution. Trigger evidence is not a protection-verification decision.

Sources: https://docs.kalshi.com/margin-rest/orders/get-orders.md ; https://docs.kalshi.com/margin-rest/portfolio/get-fills.md ; https://docs.kalshi.com/margin-rest/exit-triggers/get-cross-exit-triggers.md . No execution, CID, journal shape, strategy, live-worker or routing activation is included.

### Intended routing evidence (not authorization)

New scoped OMS rows may include `intendedRouting` and the exact `serializedRequest`
recorded before dispatch. The diagnostic labels these as intent only; conflicting
URL/body/account/CID/ticker evidence stays unresolved. Legacy rows remain unowned.
The cross-account diagnostic GET path shares the generic explicit-account transport
read boundary, with no production WriteIO binding. Neither this evidence, an ACK,
nor matching bracket snapshots verifies credentials, principal, ownership, or lifecycle
readiness. Production route and locks are unchanged; live/demo authorization,
authoritative risk inputs, and supervised lifecycle handling remain separate gates.

The proposed generic scoped OMS serializes local submissions. ONLY bulk
`killAndFlatten` orchestration is closed: it creates a local new-entry barrier,
not an account-wide emergency cancellation/flatten guarantee; existing venue
orders can still fill. Explicit single-position `submit(kind="exit")` AND
`submit(kind="flatten")` remain gated, reduce-only, quantity-capped capabilities,
including without prior entry history and after local KILL. With supplied WriteIO,
transport single/all-order and trigger cancellation capabilities remain callable
(and account-level trigger setters remain explicit transport capabilities).
None is production-activated or proof of ownership. OMS protection repair requires
consistent durable journal evidence AND shared unpoisoned transport association,
checked at prepare and actual dispatch; observed poison survives reuse/restore.
The inner recovery verifier never sends or writes success/clearance, while outer
`recover` persists failed audits; matching snapshots do not clear lifecycle unknown.

Rejected scoped order history invalidates all currently known intended associations
in that transport (including schema, immutable-field, side/source, account/type,
mapping and single-cancel association failures). This conservative poison remains
through later unique history and manager reuse; omitted account/type is allowed
but never certified. It does not infer ownership or disable explicit reduce-only
exit/flatten submissions.
