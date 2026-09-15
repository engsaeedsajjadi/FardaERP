# FardaERP — Core Changes Ledger

> **Rule:** every modification to an upstream ERPNext/Frappe file in this
> repository MUST be recorded here: file, change, reason, risk, regression test.
> "No entry, no change." See docs/VERSION-BASELINE-AND-ARCHITECTURE.md §5.3.

| # | Date | File(s) | Change | Reason | Risk | Regression test |
|---|---|---|---|---|---|---|
| CORE-001 | 2026-09-15 | `erpnext/modules.txt` | Appended module `Farda Iran` (→ `erpnext/farda_iran/`) after upstream entry `Subcontracting`/`EDI` | Approved Single-Repository architecture: isolated module for all Iranian localization (docs/VERSION-BASELINE-AND-ARCHITECTURE.md §5) | Low — modules.txt is the sanctioned extension point; Frappe creates the Module Def on install | Site install succeeds; `frappe.get_modules()` includes `farda_iran`; upstream test suite unaffected |
| CORE-002 | 2026-09-15 | `.github/workflows/*` (upstream Frappe/ERPNext CI) | Removed all upstream workflow files; FardaERP will add its own pipelines in the CI/CD phase | (1) GitHub App used by this environment cannot push workflow modifications (no `workflows` permission); (2) upstream release/translation automation must never run on the FardaERP fork | Low — CI-only files, no runtime code; upstream restore possible from tag `v16.34.2` at any sync | G-gates + future CI run green |
