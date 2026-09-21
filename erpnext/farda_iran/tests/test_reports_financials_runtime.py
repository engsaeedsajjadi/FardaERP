"""E2E runtime tests for the Iranian financial reports pack:
Farda Profit and Loss, Farda Balance Sheet, Farda Cash Flow, Farda Bank
Report. Three Journal Entries (capital, sale, expense, bank receipt) put the
books into a known balanced state:

  DR Cash 10,000,000 / CR Equity 10,000,000      (opening capital)
  DR AR    5,000,000 / CR Income 5,000,000       (credit sale)
  DR Expense 2,000,000 / CR Cash 2,000,000       (expense paid in cash)
  DR Bank  4,000,000 / CR AR 4,000,000           (customer pays via bank)

Expected (IRR → Toman ÷10): P&L profit 300,000 T; Balance Sheet assets
13,000,000 T = equity 10,000,000 T + profit 3,000,000 T (liabilities 0);
Cash Flow closing 12,000,000 T (cash 8M + bank 4M); Bank Report closing
4,000,000 T. Real data, rollback at the end.
"""

from __future__ import annotations

import frappe


def _p2f(s) -> float:
	return float(str(s).replace("٬", "").replace("-", "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")) or 0)


def _ensure(report: str, folder: str) -> None:
	if frappe.db.exists("Report", report):
		return
	from frappe.modules.import_file import import_file_by_path
	import os

	path = os.path.join(frappe.get_module_path("Farda Iran"), "report", folder, folder + ".json")
	import_file_by_path(path, force=True)
	if not frappe.db.exists("Report", report):
		raise AssertionError(f"{report} failed to sync")


def _leaf(root_type: str) -> str:
	name = frappe.db.get_value(
		"Account", {"company": frappe.db.get_value("Company", {"is_group": 0}, "name"),
					"root_type": root_type, "is_group": 0}, "name")
	if not name:
		raise AssertionError(f"no {root_type} leaf account")
	return name


def _cash() -> str:
	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	return frappe.db.get_value(
		"Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")


def _bank_account(company: str) -> str:
	existing = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
	if existing:
		return existing
	parent = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 1}, "name")
	doc = {"doctype": "Account", "company": company, "account_type": "Bank", "is_group": 0,
		   "account_name": "Farda Fin Bank", "parent_account": parent,
		   "account_currency": frappe.db.get_value("Company", company, "default_currency")}
	return frappe.get_doc(doc).insert().name


def _je(company: str, rows: list[dict], cost_center: str | None = None) -> None:
	for r in rows:
		if cost_center:
			r["cost_center"] = cost_center
	frappe.get_doc({
		"doctype": "Journal Entry", "company": company, "entry_type": "Journal Entry",
		"posting_date": frappe.utils.nowdate(),
		"accounts": rows,
	}).insert().submit()


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	# self-seed the site baseline exactly like the gate-5 smoke does
	from erpnext.farda_iran.tests import gate5_smoke

	gate5_smoke.ensure_currency(gate5_smoke.Smoke())
	gate5_smoke.ensure_company(gate5_smoke.Smoke())
	gate5_smoke.ensure_fiscal_year(gate5_smoke.Smoke())
	company = gate5_smoke.COMPANY
	from erpnext.farda_iran.tests import sandbox_seeds

	sandbox_seeds.run()  # Party Type account_type etc. on fresh PG installs
	# JE rows hitting Receivable/Payable accounts need a party; fresh PG COAs
	# leave the default receivable account without its account_type set
	ar_account = frappe.db.get_value("Company", company, "default_receivable_account")
	if frappe.db.get_value("Account", ar_account, "account_type") != "Receivable":
		frappe.db.set_value("Account", ar_account, "account_type", "Receivable")
	# JE rows hitting Receivable/Payable accounts need a party
	customer = frappe.db.get_value("Customer", {"customer_name": "Farda Fin Cust"}, "name") \
		or frappe.get_doc({"doctype": "Customer", "customer_name": "Farda Fin Cust",
						   "customer_type": "Individual", "company": company}).insert().name

	cost_center = frappe.db.get_value("Cost Center", {"company": company, "is_group": 0}, "name")
	bank = _bank_account(company)
	_je(company, [
		{"account": _cash(), "debit_in_account_currency": 10_000_000},
		{"account": _leaf("Equity"), "credit_in_account_currency": 10_000_000},
	])
	_je(company, [
		{"account": ar_account,
		 "debit_in_account_currency": 5_000_000, "party_type": "Customer", "party": customer},
		{"account": _leaf("Income"), "credit_in_account_currency": 5_000_000},
	], cost_center)
	_je(company, [
		{"account": _leaf("Expense"), "debit_in_account_currency": 2_000_000},
		{"account": _cash(), "credit_in_account_currency": 2_000_000},
	], cost_center)
	_je(company, [
		{"account": bank, "debit_in_account_currency": 4_000_000},
		{"account": ar_account,
		 "credit_in_account_currency": 4_000_000, "party_type": "Customer", "party": customer},
	])

	today = frappe.utils.nowdate()
	period = {"company": company, "from_date": today, "to_date": today}

	# ---- Farda Profit and Loss ----
	_ensure("Farda Profit and Loss", "farda_profit_and_loss")
	pl = frappe.get_attr("erpnext.farda_iran.report.farda_profit_and_loss.farda_profit_and_loss.execute")
	columns, data = pl(period)
	assert data[-1]["account"] == "سود (زیان) خالص دوره", data[-1]
	assert _p2f(data[-1]["farda_amount"]) == 300_000, data[-1]   # 3,000,000 IRR profit
	assert _p2f(data[-3]["farda_amount"]) == 500_000, data[-3]   # income total
	assert _p2f(data[-2]["farda_amount"]) == 200_000, data[-2]   # expense total
	results.append("PASS: P&L — income 500k T, expense 200k T, net profit 300k T")

	# ---- Farda Balance Sheet ----
	_ensure("Farda Balance Sheet", "farda_balance_sheet")
	bs = frappe.get_attr("erpnext.farda_iran.report.farda_balance_sheet.farda_balance_sheet.execute")
	columns, data = bs({"company": company, "as_on": today})
	by_account = {r["account"]: r for r in data}
	totals = {r["account"]: _p2f(r["farda_balance"]) for r in data if r.get("farda_section") == "جمع"}
	assets = next(v for k, v in totals.items() if k == "دارایی‌ها")
	equity = next(v for k, v in totals.items() if k == "حقوق صاحبان سهام")
	liab = next(v for k, v in totals.items() if k == "بدهی‌ها")
	profit_row = by_account["سود (زیان) انباشته دوره‌ها"]
	balance_row = by_account["تراز ترازنامه"]
	assert liab == 0, totals
	assert abs(assets * 10 - 13_000_000) < 0.01, (assets, totals)
	assert abs((equity + _p2f(profit_row["farda_balance"])) * 10 - assets * 10) < 0.01, (equity, profit_row, assets)
	assert abs(_p2f(balance_row["farda_balance"]) * 10 - 13_000_000) < 0.01, balance_row
	results.append("PASS: Balance Sheet — assets 13M T = equity 10M T + retained profit 3M T (balanced)")

	# ---- Farda Cash Flow ----
	_ensure("Farda Cash Flow", "farda_cash_flow")
	cf = frappe.get_attr("erpnext.farda_iran.report.farda_cash_flow.farda_cash_flow.execute")
	columns, data = cf(period)
	tot = data[-1]
	assert tot["account"] == "جمع کل", tot
	assert _p2f(tot["farda_inflow"]) == 1_400_000, tot   # 10M cash + 4M bank
	assert _p2f(tot["farda_outflow"]) == 200_000, tot    # 2M cash out
	assert _p2f(tot["farda_closing"]) == 1_200_000, tot  # 12M IRR
	results.append("PASS: Cash Flow — direct movement in 1.4M T / out 200k T / closing 1.2M T")

	# ---- Farda Bank Report ----
	_ensure("Farda Bank Report", "farda_bank_report")
	bank_rep = frappe.get_attr("erpnext.farda_iran.report.farda_bank_report.farda_bank_report.execute")
	columns, data = bank_rep(period)
	assert data and data[-1]["account"] == "جمع کل", data
	assert _p2f(data[-1]["farda_debit"]) == 400_000, data[-1]     # 4,000,000 IRR in
	assert _p2f(data[-1]["farda_closing"]) == 400_000, data[-1]   # opening 0
	results.append("PASS: Bank Report — bank account opening/debit/closing 400k T")

	frappe.db.rollback()
	return " | ".join(results)
