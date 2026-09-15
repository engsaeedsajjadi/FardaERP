# FardaERP — Core Changes Ledger

> **Rule:** every modification to an upstream ERPNext/Frappe file in this
> repository MUST be recorded here: file, change, reason, risk, regression test.
> "No entry, no change." See docs/VERSION-BASELINE-AND-ARCHITECTURE.md §5.3.

| # | Date | File(s) | Change | Reason | Risk | Regression test |
|---|---|---|---|---|---|---|
| CORE-001 | 2026-09-15 | `erpnext/modules.txt` | Appended module `Farda Iran` (→ `erpnext/farda_iran/`) after upstream entry `Subcontracting`/`EDI` | Approved Single-Repository architecture: isolated module for all Iranian localization (docs/VERSION-BASELINE-AND-ARCHITECTURE.md §5) | Low — modules.txt is the sanctioned extension point; Frappe creates the Module Def on install | Site install succeeds; `frappe.get_modules()` includes `farda_iran`; upstream test suite unaffected |
| CORE-002 | 2026-09-15 | `.github/workflows/*` (upstream Frappe/ERPNext CI) | Removed all upstream workflow files; FardaERP will add its own pipelines in the CI/CD phase | (1) GitHub App used by this environment cannot push workflow modifications (no `workflows` permission); (2) upstream release/translation automation must never run on the FardaERP fork | Low — CI-only files, no runtime code; upstream restore possible from tag `v16.34.2` at any sync | G-gates + future CI run green |
| CORE-003 | 2026-09-15 | `erpnext/hooks.py` (appended section only) | Added `before_migrate` hook + `doc_events.update({Customer/Supplier/Company/Sales Invoice/Purchase Invoice → farda_iran validators & VAT service})` at end of file | Wiring the isolated `farda_iran` localization into the framework — hooks are the sanctioned extension point; no upstream handler modified (dict `.update()` merge only) | Low — validators are no-ops when custom fields are empty; VAT applies only when `farda_apply_vat` is checked | `tests/test_integration_iran.run` (5 PASS incl. negative validation) + Gate-5 smoke 13/13 regression-free |

## Environment-level patches (outside this repo, /opt/fardabench)

| # | File (upstream install tree) | Change | Reason |
|---|---|---|---|
| ENV-1 | apps/hrms/.../patches/post_install/update_employee_advance_status.py | `(advance.return_amount)` → `(advance.return_amount > 0)`, `(advance.claimed_amount & advance.return_amount)` → `(advance.claimed_amount > 0) & (advance.return_amount > 0)` | bare numeric column as boolean is MySQL-only; PostgreSQL raises "argument of AND must be type boolean" during hrms after_install. Must be re-applied if the hrms tree is re-synced (finish_env.sh step 5 does it). |
| ENV-2 | PG cluster init | re-initdb `--encoding=UTF8 --no-locale` | pgserver wheel initialized SQL_ASCII; non-ASCII DocType data crashed inserts with UnicodeEncodeError. Persian-first ERP requires UTF8 storage. |

## Test-infrastructure fixes in this repo

| Commit | File | Bug |
|---|---|---|
| f0c810f | farda_iran/tests/test_integration_iran.py | `frappe.db.savepoint()` returns None; using its value as `save_point=` made `frappe.db.rollback(None)` run a FULL rollback, silently wiping uncommitted VAT settings mid-test. Now uses frappe's `savepoint()` context-manager with `catch=()`. |

## hooks.py (upstream file) — Farda additions

| Date | Section | Addition | Reason |
|---|---|---|---|
| 2026-09-15 | `jinja.methods` | 6 methods: `farda_iran.invoice.persian.{fa, format_jalali_date, money_words_irr, money_words_toman, toman_str}` + `farda_iran.tax.service.invoice_totals` | Persian print formats (Farda Persian Invoice) need Jalali/Toman/Persian-digits/amount-in-words/VAT summary inside server-side Jinja rendering. |
