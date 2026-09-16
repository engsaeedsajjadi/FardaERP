# FardaERP — Performance (§ Performance / R18)

> Executed 2026-09-16. Two parts: (1) static N+1 audit of `farda_iran`, (2) budgeted
> runtime guards on the critical paths (`tests/test_performance_runtime.py`, R18 5/5
> live, idempotent). Budgets are deliberately generous — they guard against
> PATHOLOGICAL regressions (N+1 blowups, missing batch reads), not hardware.

## 1) Static N+1 audit (AST scan: query calls inside loops, non-test code)

| Site | Verdict | Action |
|---|---|---|
| `tax/service.py::_get_exempt_flags` | **false positive** — one batched `get_all(Item, name in codes)` then map-join | none (already optimal) |
| `cheque/reminders.py::notify_cheques_due` | **real N+1** — one EXISTS per due cheque (+insert per cheque×user) | **fixed in R18**: already-notified pairs read in ONE batched query; inserts only for unseen pairs; second run creates 0 (asserted) |
| `setup/install.py` (ensure_* loops) | acceptable — cold path (install/migrate), idempotent ensure over small config lists | documented, none |
| test files | loops over small fixed lists | out of scope |

## 2) Runtime guards (R18, live site smoke.farda.local, PG 16.2)

| Path | Budget | Measured (R18) |
|---|---|---|
| `search_party` ×25 sequential | avg ≤ 60 ms, total ≤ 2 s | **avg 2.0 ms · 51 ms total** |
| SI insert (VAT planner + audit hooks) | max ≤ 1.5 s, avg ≤ 1 s | **max 295 ms · avg 140 ms** |
| `collect_kpis` (dashboard) | ≤ 800 ms | **13 ms** |
| Sales print format render (Jinja) | ≤ 800 ms | **24 ms** |
| 4 reports (Sales Register / Party Balance / VAT / Cheque) | ≤ 1.2 s each | all pass |
| `audit.record` (append-only insert) | ≤ 300 ms | **5 ms** |
| reminders dedupe (2nd run) | == 0 created, ≤ 2 s | **0 rows · 78 ms** |

## 3) Schema support

- Composite index `subject_doctype, subject_name` on `Farda Audit Log`
  (`ensure_audit_index` in setup, runs on install + before_migrate; idempotent —
  asserted in R18).
- Fold-at-rest `farda_search_key` keeps search to a single indexed-candidate
  table scan per call with `limit ≤ 50` (b-tree can't serve `%like%` anyway).

## 4) Method & re-run rule

Budgets live in code (`test_performance_runtime.py`) so the CI pipeline unit/
integration stages execute them on every run. Re-baseline intentionally (edit
budgets + note here) when hardware or data shape changes — never by deleting.
