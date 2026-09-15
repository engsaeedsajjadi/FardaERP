"""FardaERP Gate-5 Runtime Smoke Test.

Validates that the FardaERP baseline (ERPNext v16.34.2 + Frappe v16.33.1 +
HRMS v16.18.1) is functional end-to-end on a real site, before any Iranian
localization work begins. Run with:

    bench --site <site> execute erpnext.farda_iran.tests.gate5_smoke.run_all

Covers: Authentication, Company, Customers, Suppliers, Sales chain,
Purchase chain, Stock, Accounting, Reports, Permissions, HRMS.
Everything is created with the prefix `FARDA-SMOKE-` so it can be wiped
safely. This is a TEST-site harness — never run against production data.

Exit code: 0 = all PASS, 1 = at least one FAIL (failures are printed, never hidden).
"""

from __future__ import annotations

import traceback

import frappe
from frappe.utils import add_days, get_year_start, getdate, nowdate

RESULT_PREFIX = "FARDA-SMOKE"
COMPANY = "Farda Smoke Co"
COMPANY_ABBR = "FSM"
CURRENCY = "IRR"


class Smoke:
	def __init__(self):
		self.results: list[tuple[str, str, str]] = []

	def record(self, name: str, fn):
		sp = "sp_" + "".join(ch for ch in name if ch.isalnum())[:24]
		frappe.db.savepoint(sp)
		try:
			detail = fn() or "ok"
			self.results.append((name, "PASS", str(detail)))
			print(f"  PASS  {name} — {detail}")
		except Exception:
			frappe.db.rollback(save_point=sp)
			err = " | ".join(traceback.format_exc().strip().splitlines()[-3:])
			self.results.append((name, "FAIL", err))
			print(f"  FAIL  {name} — {err}")


def ensure_currency(s: Smoke):
	if not frappe.db.exists("Currency", CURRENCY):
		frappe.get_doc(
			{
				"doctype": "Currency",
				"currency_name": CURRENCY,
				"enabled": 1,
				"number_format": "#,###.##",
				"fraction": "Dinar",
				"fraction_units": 100,
				"smallest_currency_fraction_value": 1,
			}
		).insert()
	return f"Currency {CURRENCY} ready"


def ensure_company(s: Smoke):
	if frappe.db.exists("Company", COMPANY):
		return "already present"
	doc = frappe.get_doc(
		{
			"doctype": "Company",
			"company_name": COMPANY,
			"abbr": COMPANY_ABBR,
			"default_currency": CURRENCY,
			"country": "Iran",
			"chart_of_accounts": "Standard",
		}
	).insert()
	return f"company created; receivable={doc.default_receivable_account}"


def fiscal_year_name():
	year = getdate(nowdate()).year
	return f"{year}-{year + 1} (FARDA-SMOKE)"


def ensure_fiscal_year(s: Smoke):
	name = fiscal_year_name()
	if not frappe.db.exists("Fiscal Year", name):
		start = get_year_start(nowdate())
		frappe.get_doc(
			{
				"doctype": "Fiscal Year",
				"year": name,
				"year_start_date": start,
				"year_end_date": add_days(start, 364),
			}
		).insert()
	return f"fiscal year {name}"


def ensure_user_and_auth(s: Smoke):
	email = "smoke.user@fardasmoke.local"
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": "Smoke",
				"send_welcome_email": 0,
				"new_password": "FardaSmoke#2026",
				"roles": [{"role": "Accounts User"}, {"role": "Stock User"}, {"role": "HR User"}],
			}
		).insert()
	from frappe.utils.password import check_password

	check_password(email, "FardaSmoke#2026")
	try:
		check_password(email, "wrong-password")
		raise AssertionError("wrong password accepted!")
	except frappe.exceptions.AuthenticationError:
		pass
	return "check_password accepts valid + rejects invalid credentials"


def ensure_permission_enforcement(s: Smoke):
	"""Negative test: a user without Sales Master Manager must NOT create Customer."""
	email = "smoke.restricted@fardasmoke.local"
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": "Restricted",
				"send_welcome_email": 0,
				"new_password": "Restricted#2026",
			}
		).insert()
	frappe.set_user(email)
	try:
		frappe.get_doc(
			{"doctype": "Customer", "customer_name": "SHOULD-NOT-EXIST", "customer_type": "Company"}
		).insert()
		raise AssertionError("restricted user could create Customer!")
	except frappe.exceptions.PermissionError:
		return "PermissionError raised for role-less user ✓"
	finally:
		frappe.set_user("Administrator")


def ensure_customer(s: Smoke):
	name = f"{RESULT_PREFIX} Customer"
	if not frappe.db.exists("Customer", name):
		group = frappe.db.get_value(
			"Customer Group", {"is_group": 0, "name": ("!=", "")}, "name", order_by="creation asc"
		)
		territory = frappe.db.get_value("Territory", {"is_group": 0}, "name", order_by="creation asc")
		frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": name,
				"customer_type": "Company",
				"customer_group": group,
				"territory": territory,
			}
		).insert()
	if not frappe.db.exists("Address", f"{name}-Billing"):
		frappe.get_doc(
			{
				"doctype": "Address",
				"address_title": name,
				"address_type": "Billing",
				"address_line1": "Smoke Street 1",
				"city": "Tehran",
				"country": "Iran",
				"links": [{"link_doctype": "Customer", "link_name": name}],
			}
		).insert()
	if not frappe.db.exists("Contact", f"Contact {name}-1"):
		frappe.get_doc(
			{
				"doctype": "Contact",
				"first_name": "Smoke",
				"phone": "09120000000",
				"links": [{"link_doctype": "Customer", "link_name": name}],
			}
		).insert()
	return "customer + address + contact"


def ensure_supplier(s: Smoke):
	name = f"{RESULT_PREFIX} Supplier"
	if not frappe.db.exists("Supplier", name):
		sg = frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or frappe.get_doc(
			{
				"doctype": "Supplier Group",
				"supplier_group_name": "Farda Smoke Supplier Group",
				"is_group": 0,
			}
		).insert().name
		frappe.get_doc(
			{"doctype": "Supplier", "supplier_name": name, "supplier_group": sg, "country": "Iran"}
		).insert()
	return "supplier ready"


def ensure_item_and_price(s: Smoke):
	item_code = f"{RESULT_PREFIX} ITEM-001"
	if not frappe.db.exists("Item", item_code):
		ig = frappe.db.get_value("Item Group", {"is_group": 0}, "name", order_by="creation asc")
		uom = frappe.db.get_value("UOM", {"uom_name": "Unit"}, "uom_name") or frappe.get_doc(
			{"doctype": "UOM", "uom_name": "Unit", "must_be_whole_number": 1}
		).insert().uom_name
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": item_code,
				"item_name": "Smoke Widget",
				"item_group": ig,
				"stock_uom": uom,
				"is_stock_item": 1,
			}
		).insert()
	pl = "Farda Smoke Selling"
	if not frappe.db.exists("Price List", pl):
		frappe.get_doc(
			{"doctype": "Price List", "price_list_name": pl, "currency": CURRENCY, "selling": 1}
		).insert()
	if not frappe.db.exists("Item Price", {"item_code": item_code, "price_list": pl}):
		frappe.get_doc(
			{
				"doctype": "Item Price",
				"item_code": item_code,
				"price_list": pl,
				"price_list_rate": 1_000_000,  # 1,000,000 IRR
			}
		).insert()
	return f"item {item_code} + price 1,000,000 IRR"


def _main_warehouse():
	return frappe.db.get_value(
		"Warehouse",
		{"company": COMPANY, "is_group": 0, "warehouse_name": ("like", "%Stores%")},
		"name",
	) or frappe.db.get_value(
		"Warehouse", {"company": COMPANY, "is_group": 0}, "name", order_by="creation asc"
	)


def _company_cash():
	return frappe.db.get_value(
		"Account",
		{"company": COMPANY, "account_type": "Cash", "is_group": 0},
		"name",
	)


def sales_chain(s: Smoke):
	"""SO → DN → SI → Payment Entry (all submitted)."""
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
	from erpnext.selling.doctype.sales_order.sales_order import make_delivery_note
	from erpnext.stock.doctype.delivery_note.delivery_note import make_sales_invoice

	item = f"{RESULT_PREFIX} ITEM-001"
	customer = f"{RESULT_PREFIX} Customer"
	wh = _main_warehouse()
	so = frappe.get_doc(
		{
			"doctype": "Sales Order",
			"customer": customer,
			"company": COMPANY,
			"currency": CURRENCY,
			"selling_price_list": "Farda Smoke Selling",
			"transaction_date": nowdate(),
			"delivery_date": add_days(nowdate(), 7),
			"items": [{"item_code": item, "qty": 2, "rate": 1_000_000, "warehouse": wh}],
		}
	)
	so.insert()
	so.submit()
	dn = frappe.get_doc(make_delivery_note(so.name))
	dn.insert()
	dn.submit()
	si = frappe.get_doc(make_sales_invoice(dn.name))
	si.insert()
	si.submit()
	pe = get_payment_entry("Sales Invoice", si.name, bank_account=_company_cash())
	pe.reference_no = f"{RESULT_PREFIX}-PAY-S1"
	pe.reference_date = nowdate()
	pe.insert()
	pe.submit()
	status = frappe.db.get_value("Sales Invoice", si.name, "status")
	return f"SO {so.name} → DN → SI {si.name} ({status}) → PE {pe.name}"


def purchase_chain(s: Smoke):
	"""PO → PR → PI → Payment Entry (all submitted)."""
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
	from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_receipt
	from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_invoice

	item = f"{RESULT_PREFIX} ITEM-001"
	supplier = f"{RESULT_PREFIX} Supplier"
	po = frappe.get_doc(
		{
			"doctype": "Purchase Order",
			"supplier": supplier,
			"company": COMPANY,
			"currency": CURRENCY,
			"schedule_date": add_days(nowdate(), 3),
			"items": [{"item_code": item, "qty": 5, "rate": 600_000, "warehouse": _main_warehouse()}],
		}
	)
	po.insert()
	po.submit()
	pr = frappe.get_doc(make_purchase_receipt(po.name))
	pr.insert()
	pr.submit()
	pi = frappe.get_doc(make_purchase_invoice(pr.name))
	pi.insert()
	pi.submit()
	pe = get_payment_entry("Purchase Invoice", pi.name, bank_account=_company_cash())
	pe.reference_no = f"{RESULT_PREFIX}-PAY-P1"
	pe.reference_date = nowdate()
	pe.insert()
	pe.submit()
	return f"PO {po.name} → PR → PI {pi.name} → PE {pe.name}"


def stock_checks(s: Smoke):
	from erpnext.stock.utils import get_stock_balance

	item = f"{RESULT_PREFIX} ITEM-001"
	wh = _main_warehouse()
	balance = get_stock_balance(item, wh)
	if balance is None or balance < 3:
		raise AssertionError(f"unexpected stock balance {balance!r}")
	whs = frappe.db.get_value(
		"Warehouse", {"company": COMPANY, "is_group": 0, "name": ("!=", wh)}, "name"
	)
	if not whs:
		whs = (
			frappe.get_doc(
				{"doctype": "Warehouse", "warehouse_name": "Farda Smoke WH 2", "company": COMPANY}
			)
			.insert()
			.name
		)
	se = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Transfer",
			"company": COMPANY,
			"items": [
				{
					"item_code": item,
					"qty": 1,
					"s_warehouse": wh,
					"t_warehouse": whs,
					"basic_rate": 600_000,
				}
			],
		}
	)
	se.insert()
	se.submit()
	balance2 = get_stock_balance(item, wh)
	if balance2 != balance - 1:
		raise AssertionError(f"stock ledger did not move: {balance} → {balance2}")
	expense = frappe.db.get_value(
		"Account", {"company": COMPANY, "account_name": ("like", "%Stock Adjustment%")}, "name"
	) or frappe.db.get_value(
		"Account", {"company": COMPANY, "root_type": "Expense", "is_group": 0}, "name"
	)
	recon = frappe.get_doc(
		{
			"doctype": "Stock Reconciliation",
			"company": COMPANY,
			"purpose": "Stock Reconciliation",
			"expense_account": expense,
			"items": [{"item_code": item, "warehouse": wh, "qty": 5, "valuation_rate": 600_000}],
		}
	)
	recon.insert()
	recon.submit()
	final = get_stock_balance(item, wh)
	return f"ledger {balance}→{balance2}→recon {final} @ {wh}"


def accounting_checks(s: Smoke):
	accounts = frappe.db.count("Account", {"company": COMPANY})
	if accounts < 10:
		raise AssertionError(f"only {accounts} accounts")
	cash = _company_cash()
	sales_acc = frappe.db.get_value(
		"Account",
		{"company": COMPANY, "root_type": "Income", "is_group": 0, "account_name": ("like", "%Sales%")},
		"name",
	)
	je = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"company": COMPANY,
			"entry_type": "Journal Entry",
			"posting_date": nowdate(),
			"accounts": [
				{"account": cash, "debit_in_account_currency": 500_000},
				{"account": sales_acc, "credit_in_account_currency": 500_000},
			],
		}
	)
	je.insert()
	je.submit()
	gl = frappe.db.count("GL Entry", {"company": COMPANY})
	if gl < 5:
		raise AssertionError(f"only {gl} GL entries")
	res = frappe.desk.query_report.run(
		"Trial Balance", filters={"company": COMPANY, "fiscal_year": fiscal_year_name()}
	)
	if not res or "result" not in res:
		raise AssertionError("trial balance returned no result")
	res2 = frappe.desk.query_report.run("General Ledger", filters={"company": COMPANY})
	if not res2 or "result" not in res2:
		raise AssertionError("general ledger report returned no result")
	return f"COA {accounts} accounts, JE {je.name}, GL {gl} entries, TB+GL reports OK"


def hrms_checks(s: Smoke):
	dept = frappe.db.get_value("Department", {"company": COMPANY}, "name")
	if not dept:
		dept = (
			frappe.get_doc(
				{"doctype": "Department", "department_name": "Farda Smoke Dept", "company": COMPANY}
			)
			.insert()
			.name
		)
	desig = frappe.db.get_value("Designation", "Engineer", "name") or frappe.get_doc(
		{"doctype": "Designation", "designation_name": "Engineer"}
	).insert().name
	if not frappe.db.exists("Gender", "Male"):
		frappe.get_doc({"doctype": "Gender", "gender": "Male"}).insert()
	emp_number = f"{RESULT_PREFIX} EMP-001"
	if not frappe.db.exists("Employee", {"employee_number": emp_number}):
		frappe.get_doc(
			{
				"doctype": "Employee",
				"first_name": "Farda",
				"last_name": "Smoke",
				"employee_number": emp_number,
				"company": COMPANY,
				"department": dept,
				"designation": desig,
				"date_of_birth": "1990-01-01",
				"date_of_joining": nowdate(),
				"gender": "Male",
			}
		).insert()
	emp = frappe.db.get_value("Employee", {"employee_number": emp_number}, "name")
	lt = "Farda Smoke Leave"
	if not frappe.db.exists("Leave Type", lt):
		frappe.get_doc(
			{
				"doctype": "Leave Type",
				"leave_type_name": lt,
				"is_carry_forward": 0,
				"include_holiday": 0,
				"is_lwp": 0,
			}
		).insert()
	if not frappe.db.exists(
		"Leave Allocation",
		{"employee": emp, "leave_type": lt, "docstatus": 1},
	):
		frappe.get_doc(
			{
				"doctype": "Leave Allocation",
				"employee": emp,
				"leave_type": lt,
				"from_date": nowdate(),
				"to_date": add_days(nowdate(), 300),
				"new_leaves_allocated": 10,
			}
		).insert().submit()
	frappe.get_doc(
		{
			"doctype": "Attendance",
			"employee": emp,
			"company": COMPANY,
			"attendance_date": nowdate(),
			"status": "Present",
		}
	).insert().submit()
	return f"employee {emp}, dept, designation, leave allocation + attendance submitted"


def run_all():
	print("=" * 70)
	print("FardaERP Gate-5 Runtime Smoke Test")
	print(f"frappe {frappe.__version__} | site {frappe.local.site} | db {frappe.conf.get('db_type')}")
	print("=" * 70)
	frappe.set_user("Administrator")
	if frappe.get_conf(frappe.local.site).get("db_type") == "postgres":
		from erpnext.farda_iran.tests import pg_compat

		pg_compat.apply()
	s = Smoke()
	s.record("Currency (IRR)", lambda: ensure_currency(s))
	s.record("Company + default accounts", lambda: ensure_company(s))
	s.record("Fiscal Year", lambda: ensure_fiscal_year(s))
	s.record("Authentication (password check + rejection)", lambda: ensure_user_and_auth(s))
	s.record("Permissions (negative test)", lambda: ensure_permission_enforcement(s))
	s.record("Customer + Address + Contact", lambda: ensure_customer(s))
	s.record("Supplier", lambda: ensure_supplier(s))
	s.record("Item + Price List + Item Price", lambda: ensure_item_and_price(s))
	s.record("Sales chain SO->DN->SI->Payment", lambda: sales_chain(s))
	s.record("Purchase chain PO->PR->PI->Payment", lambda: purchase_chain(s))
	s.record("Stock ledger + transfer + reconciliation", lambda: stock_checks(s))
	s.record("Accounting COA + JE + GL + Reports", lambda: accounting_checks(s))
	s.record("HRMS Employee/Department/Leave/Attendance", lambda: hrms_checks(s))

	frappe.db.commit()
	print("=" * 70)
	passed = sum(1 for _, st, _ in s.results if st == "PASS")
	failed = sum(1 for _, st, _ in s.results if st == "FAIL")
	print(f"RESULT: {passed} PASS, {failed} FAIL, total {len(s.results)}")
	if failed:
		print("\nFAILED STEPS:")
		for name, st, err in s.results:
			if st == "FAIL":
				print(f"  - {name}: {err}")
	print("=" * 70)
	if failed:
		raise SystemExit(1)
	return f"Gate-5 smoke: {passed}/{len(s.results)} PASS"
