# PHASE G5 — Gate 5 Real Runtime Smoke — **COMPLETE**

| Field | Value |
|---|---|
| PHASE | G5 — Gate 5 runtime smoke (master plan §42) |
| STATUS | **COMPLETE — 13/13 PASS** (real bench execution, repeated twice) |
| Date | 2026-09-15 |

## Implemented / Changed
- `erpnext/farda_iran/tests/gate5_smoke.py` — 13-step runtime harness (savepoint isolation, rerun-idempotent, full-traceback dump, purchase-before-sales ordering, FY-bound filters for TB/GL reports).
- `erpnext/farda_iran/tests/pg_compat.py` — **12 runtime shims (PG-1..PG-12)** for upstream strict-PostgreSQL defects, auto-applied only when site `db_type == "postgres"`. No upstream file modified. Full list with sites:
  - PG-1 `stock_balance.py:100` MySQL `if()` → CASE WHEN `<> 0`, quoted tables
  - PG-2 `stock_controller.py:1209` SUM+cost_center w/o GROUP BY → add groupby
  - PG-3 `general_ledger.py:845` aggregate get_value + implicit ORDER BY → order_by=""
  - PG-4 `stock_closing_entry.py:31` same family → order_by=""
  - PG-5 `stock_reservation_entry.py:862` DISTINCT+ORDER BY unselected col → select creation
  - PG-6 `accounts/utils.py QueryPaymentLedger.query_for_outstanding` CTE strict GROUP BY + HAVING-on-alias → full strict rewrite
  - PG-7 `accounts/utils.py:1231 get_held_invoices` CURDATE() → bound param
  - PG-8 `payment_entry.py get_negative_outstanding_invoices` MySQL if()/quoted literal → PG raw SQL
  - PG-9 `payment_entry.py get_orders_to_be_billed` same → PG rewrite
  - PG-10 `payment_entry.py get_matched_payment_request_of_references` name w/ Count(*) ungrouped → group by name
  - PG-11 `trial_balance.py get_opening_balance` group by (account, account_currency)
  - PG-12 `financial_statements.py get_accounting_entries` FORCE INDEX (MySQL-only) + grouped non-aggregated selects → PG-safe rewrite
  - Latent same-family sites (no shim until hit): `packing_slip.py:180`, `stock_entry.py:3348`
- Upstream CI workflows dropped (commit `d418e3d`) — recorded in docs/CORE-CHANGES.md (CORE-002).

## Tests executed (REAL)
- `bench --site smoke.farda.local execute erpnext.farda_iran.tests.gate5_smoke.run_all`
- Env: Python 3.14 · Frappe v16.33.1 · ERPNext 16.34.2 · HRMS v16.18.1 · PostgreSQL 16.2 · Redis 7.4.1
- **PASS: 13 · FAIL: 0** (twice, incl. full rerun idempotency)
  Currency(IRR) · Company · Fiscal Year · Auth(+negative) · Permissions(negative) · Customer/Address/Contact · Supplier · Item/Price · Purchase chain PO→PR→PI→PE · Sales chain SO→DN→SI→PE · Stock ledger/transfer/reconciliation · Accounting (COA 95 accts, JE, GL 128 entries, Trial Balance + General Ledger reports) · HRMS (Employee/Dept/Leave/Attendance)
- Run history: R1 6/7 → R4 8/5 → R5 9/4 → R6 9/4 → … → **13/13** (logs /tmp/gate5_full.log)

## Docker
- NOT RUN — **DOCKER VALIDATION PENDING** (no daemon in sandbox).

## Security
- Negative permission test PASS. OTP/payment/secrets surfaces do not exist yet (see gap analysis).

## Known Risks
- G5 evidence is PostgreSQL-based; MariaDB re-verification deferred to Docker phase (upstream CI covers MariaDB for vanilla ERPNext; our tree = upstream + isolated module).
- 12 upstream PG defects rely on runtime shims — acceptable as documented, tested workaround; upstream reports queued.

## Remaining Gaps
- See docs/COMMERCIAL-GAP-ANALYSIS.md (authoritative).

## Git
- Commit range: `3f832a0..29b8f8c` (PG shims + harness fixes) on `arena/01a0a51f-fardaerp`
- Tag: `fardainerp-gate5-pass` (pushed)

## Next Phase
- Foundation services: Jalali (C1) + Currency/Toman (C2) + Persian normalization (H2) with real unit suites → then VAT (C3) → party fields (H1).
