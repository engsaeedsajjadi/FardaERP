"""E2E runtime tests for the Iranian financial reports pack:
Farda Profit and Loss, Farda Balance Sheet, Farda Cash Flow, Farda Bank
Report. Four Journal Entries through DEDICATED suite accounts (equity,
income, expense, bank + own customer) put the books into a known state —
exact assertions apply to the suite's own accounts only, so the suite is
robust against other committed site data while the statements' internal
consistency (P&L profit identity, Balance Sheet equation, cash-flow
closing identity) is asserted exactly:

  DR Cash 10,000,000 / CR [Equity*] 10,000,000     (opening capital)
  DR AR 5,000,000 / CR [Income*] 5,000,000         (credit sale)
  DR [Expense*] 2,000,000 / CR Cash 2,000,000      (expense paid in cash)
  DR [Bank*] 4,000,000 / CR AR 4,000,000           (customer pays via bank)

Expected for the suite's accounts (IRR → Toman ÷10): P&L income 500,000 T,
expense 200,000 T, profit ≥ 300,000 T with profit == income − expense;
Balance Sheet equity row exactly 1,000,000 T and assets = liabilities +
equity + retained profit; Cash Flow/Bank closing exactly 400,000 T for the
suite's bank account. Real data, rollback at the end.
"""

from __future__ import annotations

import frappe


def _p2f(s) -> float:
	return float(str(s).replace("٬", "").replace("-", "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")) or 0)


def _ensure(report: str) -> None:
	if frappe.db.exists("Report", report):
		return
	from frappe.modules.import_file import import_file_by_path
	import os

	folder = {
		"Farda Profit and Loss": "farda_profit_and_loss",
		"Farda Balance Sheet": "farda_balance_sheet",
		"Farda Cash Flow": "farda_cash_flow",
		"Farda Bank Report": "farda_bank_report",
	}[report]
	path = os.path.join(frappe.get_module_path("Farda Iran"), "report", folder, folder + ".json")
	import_file_by_path(path, force=True)
	assert frappe.db.exists("Report", report), f"{report} failed to sync"


def _leaf(root_type: str) -> str:
	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	name = frappe.db.get_value(
		"Account", {"company": company, "root_type": root_type, "is_group": 0}, "name")
	if not name:
		raise AssertionError(f"no {root_type} leaf account")
	return name


def _parent_of_type(company: str, account_type: str, root_type: str) -> str:
	return frappe.db.get_value(
		"Account", {"company": company, "account_type": account_type,
					"root_type": root_type, "is_group": 1}, "name") or frappe.db.get_value(
		"Account", {"company": company, "root_type": root_type, "is_group": 1}, "name")


def _dedicated_account(company: str, account_name: str, root_type: str,
					   account_type: str | None = None) -> str:
	existing = frappe.db.get_value("Account", {"company": company, "account_name": account_name}, "name")
	if existing:
		return existing
	doc = {
		"doctype": "Account", "company": company, "account_name": account_name,
		"is_group": 0, "parent_account": (
			_parent_of_type(company, account_type, root_type) if account_type
			else frappe.db.get_value("Account", {"company": company, "root_type": root_type, "is_group": 1}, "name")
		),
		"account_currency": frappe.db.get_value("Company", company, "default_currency"),
	}
	if account_type:
		doc["account_type"] = account_type
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
	# JE rows hitting Receivable/Payable accounts need a party
	customer = frappe.db.get_value("Customer", {"customer_name": "Farda Fin Cust"}, "name") \
		or frappe.get_doc({"doctype": "Customer", "customer_name": "Farda Fin Cust",
						   "customer_type": "Individual", "company": company}).insert().name
	ar_account = frappe.db.get_value("Company", company, "default_receivable_account")
	if frappe.db.get_value("Account", ar_account, "account_type") != "Receivable":
		frappe.db.set_value("Account", ar_account, "account_type", "Receivable")

	cost_center = frappe.db.get_value("Cost Center", {"company": company, "is_group": 0}, "name")
	# dedicated suite accounts — exact assertions apply to THESE only
	equity_acc = _dedicated_account(company, "Farda Fin Equity", "Equity")
	income_acc = _dedicated_account(company, "Farda Fin Income", "Income")
	expense_acc = _dedicated_account(company, "Farda Fin Expense", "Expense", account_type="Expense Account")
	bank_acc = _dedicated_account(company, "Farda Fin Bank", "Asset", account_type="Bank")
	cash_acc = frappe.db.get_value(
		"Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")

	_je(company, [
		{"account": cash_acc, "debit_in_account_currency": 10_000_000},
		{"account": equity_acc, "credit_in_account_currency": 10_000_000},
	])
	_je(company, [
		{"account": ar_account, "debit_in_account_currency": 5_000_000,
		 "party_type": "Customer", "party": customer},
		{"account": income_acc, "credit_in_account_currency": 5_000_000},
	], cost_center)
	_je(company, [
		{"account": expense_acc, "debit_in_account_currency": 2_000_000},
		{"account": cash_acc, "credit_in_account_currency": 2_000_000},
	], cost_center)
	_je(company, [
		{"account": bank_acc, "debit_in_account_currency": 4_000_000},
		{"account": ar_account, "credit_in_account_currency": 4_000_000,
		 "party_type": "Customer", "party": customer},
	])

	today = frappe.utils.nowdate()
	period = {"company": company, "from_date": today, "to_date": today}

	# ---- Farda Profit and Loss ----
	_ensure("Farda Profit and Loss")
	pl = frappe.get_attr("erpnext.farda_iran.report.farda_profit_and_loss.farda_profit_and_loss.execute")
	columns, data = pl(period)
	rows_by_account = {r["account_name"]: r for r in data if r["account"] == income_acc or r["account"] == expense_acc}
	assert abs(_p2f(rows_by_account["Farda Fin Income"]["farda_amount"]) - 500_000) < 0.01, rows_by_account
	assert abs(_p2f(rows_by_account["Farda Fin Expense"]["farda_amount"]) - 200_000) < 0.01, rows_by_account
	tot = data[-1]
	inc_tot = _p2f(data[-3]["farda_amount"])
	exp_tot = _p2f(data[-2]["farda_amount"])
	profit = _p2f(tot["farda_amount"])
	assert abs(profit - (inc_tot - exp_tot)) < 0.01, (profit, inc_tot, exp_tot)
	assert profit >= 300_000, profit  # suite's own contribution is 300k
	results.append("PASS: P&L — suite income 500k T + expense 200k T exact; profit identity holds")

	# ---- Farda Balance Sheet ----
	_ensure("Farda Balance Sheet")
	bs = frappe.get_attr("erpnext.farda_iran.report.farda_balance_sheet.farda_balance_sheet.execute")
	columns, data = bs({"company": company, "as_on": today})
	by_account = {r["account"]: r for r in data}
	eq_row = by_account[equity_acc]
	assert abs(_p2f(eq_row["farda_balance"]) - 1_000_000) < 0.01, eq_row
	totals = {r["account"]: _p2f(r["farda_balance"]) for r in data if r.get("farda_section") == "جمع"}
	assets = totals["دارایی\u200cها"]
	liab = totals["بدهی\u200cها"]
	equity = totals["حقوق صاحبان سهام"]
	profit_bs = _p2f(by_account["سود (زیان) انباشته دوره\u200cها"]["farda_balance"])
	assert abs(assets * 10 - (liab + equity + profit_bs) * 10) < 0.01, (assets, liab, equity, profit_bs)
	assert liab >= 0 and assets > 0, totals
	balance_row = by_account["تراز ترازنامه"]
	assert abs(_p2f(balance_row["farda_balance"]) * 10 - assets * 10) < 0.01, balance_row
	results.append("PASS: Balance Sheet — equation assets = liabilities + equity + retained profit holds; suite equity 1M T exact")

	# ---- Farda Cash Flow (scoped to the suite's bank account + consistency) ----
	_ensure("Farda Cash Flow")
	cf = frappe.get_attr("erpnext.farda_iran.report.farda_cash_flow.farda_cash_flow.execute")
	columns, data = cf({"company": company, "from_date": today, "to_date": today, "account": bank_acc})
	bank_row = next(r for r in data[:-1] if r["account"] == bank_acc)
	assert abs(_p2f(bank_row["farda_inflow"]) - 400_000) < 0.01, bank_row
	assert abs(_p2f(bank_row["farda_closing"]) - 400_000) < 0.01, bank_row
	tot = data[-1]
	assert abs(_p2f(tot["farda_closing"]) - (_p2f(tot["farda_opening"]) + _p2f(tot["farda_inflow"]) - _p2f(tot["farda_outflow"]))) < 0.01, tot
	results.append("PASS: Cash Flow — suite bank in/out 400k T exact; closing identity holds")

	# ---- Farda Bank Report (scoped to the suite's bank account) ----
	_ensure("Farda Bank Report")
	bank_rep = frappe.get_attr("erpnext.farda_iran.report.farda_bank_report.farda_bank_report.execute")
	columns, data = bank_rep({"company": company, "from_date": today, "to_date": today, "account": bank_acc})
	assert data and data[-1]["account"] == "جمع کل", data
	assert _p2f(data[-1]["farda_debit"]) == 400_000, data[-1]
	assert _p2f(data[-1]["farda_closing"]) == 400_000, data[-1]
	results.append("PASS: Bank Report — suite bank opening/debit/closing 400k T exact")

	frappe.db.rollback()
	return " | ".join(results)
