# FardaERP — Core Changes Ledger

> **Rule:** every modification to an upstream ERPNext/Frappe file in this
> repository MUST be recorded here: file, change, reason, risk, regression test.
> "No entry, no change." See docs/VERSION-BASELINE-AND-ARCHITECTURE.md §5.3.

| # | Date | File(s) | Change | Reason | Risk | Regression test |
|---|---|---|---|---|---|---|
| CORE-001 | 2026-09-15 | `erpnext/modules.txt` | Appended module `Farda Iran` (→ `erpnext/farda_iran/`) after upstream entry `Subcontracting`/`EDI` | Approved Single-Repository architecture: isolated module for all Iranian localization (docs/VERSION-BASELINE-AND-ARCHITECTURE.md §5) | Low — modules.txt is the sanctioned extension point; Frappe creates the Module Def on install | Site install succeeds; `frappe.get_modules()` includes `farda_iran`; upstream test suite unaffected |
