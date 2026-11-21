"""Company defaults for the Iranian chart of accounts (CORE-030).

ERPNext fills a new company's default accounts by picking *some* account of each
account type, and the income account by the English name "Sales". With the
Iranian chart that picked e.g. «علی‌الحساب کارکنان» as the default receivable
and «حقوق و دستمزد پرداختنی» as the default payable. This hook sets every
default explicitly from the chart's account numbers, only for companies built
from the Iranian template and only where the current value is not one the user
chose deliberately (empty, or a different account of the same family).
"""

import frappe

IRAN_CHART = "ایران - کدینگ استاندارد فردا"

# Company field -> account number in ir_farda_standard_chart_of_accounts.json
DEFAULTS = {
	"default_cash_account": "110101",
	"default_bank_account": "11010301",
	"default_receivable_account": "110301",
	"default_payable_account": "210101",
	"default_inventory_account": "110501",
	"default_income_account": "4101",
	"default_expense_account": "5101",
	"cost_of_goods_sold_account": "5101",
	"stock_adjustment_account": "5102",
	"expenses_included_in_valuation": "5103",
	"expenses_included_in_asset_valuation": "5104",
	"stock_received_but_not_billed": "210501",
	"asset_received_but_not_billed": "210502",
	"round_off_account": "5402",
	"depreciation_expense_account": "5209",
	"accumulated_depreciation_account": "120201",
	"capital_work_in_progress_account": "120107",
	"default_advance_received_account": "210401",
	"default_advance_paid_account": "110601",
}


def apply_iran_chart_defaults(doc, method=None):
	if doc.get("chart_of_accounts") != IRAN_CHART:
		return
	if doc.flags.get("farda_defaults_applied"):
		return
	meta = frappe.get_meta("Company")
	numbers = list(set(DEFAULTS.values()))
	accounts = {
		r.account_number: r.name
		for r in frappe.get_all(
			"Account",
			filters={"company": doc.name, "account_number": ["in", numbers], "is_group": 0},
			fields=["name", "account_number"],
		)
	}
	if not accounts:
		return  # chart not created yet (e.g. ignore_chart_of_accounts)
	changes = {}
	for field, number in DEFAULTS.items():
		target = accounts.get(number)
		if not target or not meta.has_field(field):
			continue
		current = doc.get(field)
		if current == target:
			continue
		# only replace an empty value or one ERPNext auto-picked inside this company
		if not current or frappe.db.get_value("Account", current, "company") == doc.name and _auto_picked(doc, field):
			changes[field] = target
	if changes:
		frappe.db.set_value("Company", doc.name, changes, update_modified=False)
		for k, v in changes.items():
			doc.set(k, v)
	doc.flags.farda_defaults_applied = True
	_ensure_vat_account(accounts, doc.name)


def _auto_picked(doc, field):
	"""True right after creation: the company was inserted in this request and
	the user has not saved it again since (no manual choice to protect)."""
	return bool(doc.flags.get("in_insert") or doc.is_new() or doc.get("__islocal") or doc.creation == doc.modified)


def _ensure_vat_account(accounts, company):
	if not frappe.db.exists("DocType", "Farda VAT Settings"):
		return
	if frappe.db.get_single_value("Farda VAT Settings", "vat_account"):
		return
	vat = frappe.db.get_value("Account", {"company": company, "account_number": "210301", "is_group": 0}, "name")
	if vat:
		frappe.db.set_single_value("Farda VAT Settings", "vat_account", vat)
