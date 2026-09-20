"""Pure registry of the Farda API namespaces (§21) — frappe-free.

Single source of truth for the namespace/action surface, the role gates and
the error-code vocabulary. The whitelisted dispatch layer
(`api/namespaces.py`) reads ONLY this module for its contract, so the surface
is auditable (and unit-testable) without frappe.

Error-format convention (uniform envelope, HTTP 200):
    {"ok": true,  "data": ...}
    {"ok": false, "error": {"code": <ERROR_CODES>, "message": <fa>}}

Audit behavior: the namespace surface is READ-ONLY by design — every mutating
path stays on the model layer, where `audit.service` doc_events produce the
audit trail (payment/cheque/VAT-change/identity). No namespace handler writes.
"""

from __future__ import annotations

ERROR_CODES = ("VALIDATION", "NOT_FOUND", "FORBIDDEN", "RATE_LIMITED", "UNKNOWN")

NAMESPACE_ACTIONS: dict[str, tuple[str, ...]] = {
	"tax": ("calculate_vat",),
	"party": ("get_profile", "search"),
	"bank": ("resolve",),
	"reports": ("run",),
}

NAMESPACE_ROLES: dict[str, frozenset[str]] = {
	"tax": frozenset({"Accounts User", "Accounts Manager", "Sales User", "Purchase User", "System Manager"}),
	"party": frozenset({"Sales User", "Purchase User", "Stock User", "Accounts User", "System Manager"}),
	"bank": frozenset({"Accounts User", "Accounts Manager", "System Manager"}),
	"reports": frozenset(
		{"Accounts User", "Accounts Manager", "Accounts Viewer", "Sales User", "System Manager"}
	),
}

# Reports executable through farda.reports.run — keep in sync with
# erpnext/farda_iran/report/ (unit test asserts the disk match).
REPORT_ALLOWLIST: frozenset[str] = frozenset(
	{
		"farda_sales_register",
		"farda_purchase_register",
		"farda_cheque_report",
		"farda_party_balance",
		"farda_vat_report",
		"farda_general_ledger",
		"farda_trial_balance",
		"farda_stock_balance",
	}
)

# API identity (snake) → Report doc name (Title Case, as stored in tabReport).
REPORT_DOC_NAMES: dict[str, str] = {
	"farda_sales_register": "Farda Sales Register",
	"farda_purchase_register": "Farda Purchase Register",
	"farda_cheque_report": "Farda Cheque Report",
	"farda_party_balance": "Farda Party Balance",
	"farda_vat_report": "Farda VAT Report",
	"farda_general_ledger": "Farda General Ledger",
	"farda_trial_balance": "Farda Trial Balance",
	"farda_stock_balance": "Farda Stock Balance",
}

# farda.reports.run per-user sliding-window budget (heavy aggregations).
REPORTS_RATE_LIMIT = (30, 60)  # (calls, window_seconds)
