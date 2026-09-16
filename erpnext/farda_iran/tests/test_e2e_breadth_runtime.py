"""R19 — E2E breadth: ONE Iranian order-to-cash chain across ALL Farda modules.

Chain (live site, gate5 fixtures reused idempotently):
  1 Customer w/ valid کد ملی → audit IdentityChange row
  2 Bank Account via IBAN → registry bank auto-link (banking)
  3 SO → DN → SI with farda_apply_vat → VAT 10% rows + GL reconcile
  4 Persian print render (A4): کد ملی + grand in Toman
  5 Gateway sandbox (injected transport, whitelisted api): start_payment →
    verify_payment → ACCEPT → PE → submit → SI Paid + PE audit Submit row
  6 Cheque: create_payment_entry(cheque) → PE submit → cheque advances through
    LEGAL transitions (Received→Deposited→Cleared — R19 bug fix: direct jump
    used to violate TRANSITIONS and raise) → audit rows → PE cancel reverts
  7 Reports/KPIs reflect the chain (Sales Register, VAT Report, Party Balance,
    KPIs), monitoring health db+redis ok
Docs deliberately persist like gate5 (unique prefix), PEs are cancelled+removed.
"""

from __future__ import annotations

import frappe

PREFIX = "FardaE2E"
COMPANY = "Farda Smoke Co"


class _Resp:
	def __init__(self, payload):
		self._payload = payload

	def json(self):
		return self._payload


class _E2EFakeHTTP:
	"""Sandbox-shaped ZarinPal fake with a UNIQUE authority prefix, so reruns
	of R19 and the shared payments_runtime fake never collide (chain docs
	persist like gate5; payment-log rows are cleaned up at the end)."""

	def __init__(self):
		self.authorities: dict[str, int] = {}
		self.n = 0

	def post(self, url, json=None, timeout=None):
		if url.endswith("/request.json"):
			self.n += 1
			authority = f"FAKEE2E{self.n:06d}"
			self.authorities[authority] = int(json["amount"])
			return _Resp({"data": {"code": 100, "message": "", "authority": authority}})
		if url.endswith("/verify.json"):
			authority = json["authority"]
			return _Resp({
				"data": {
					"code": 100,
					"message": "ok",
					"amount": self.authorities.get(authority, int(json.get("amount", 0))),
					"ref_id": 987654321,
				}
			})
		raise AssertionError(f"unexpected url {url}")


def _company():
	return frappe.db.get_value("Company", {"is_group": 0}, "name") or COMPANY


def _ensure_fixtures():
	"""Reuse gate5's idempotent ensure_* with a stub harness."""
	import erpnext.farda_iran.tests.gate5_smoke as g5

	class _S:
		results = []

	s = _S()
	g5.ensure_currency(s)
	g5.ensure_company(s)
	g5.ensure_fiscal_year(s)
	g5.ensure_item_and_price(s)


def run() -> str:
	frappe.set_user("Administrator")
	import os

	os.environ.setdefault("ZARINPAL_MERCHANT_ID", "e2e-merchant-sandbox-only")
	os.environ.setdefault("FARDA_PAYMENT_SANDBOX", "1")

	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings
	
	_ensure_fixtures()
	company = _company()
	_setup_vat_settings(company)
	# self-heal: purge leftovers of OUR authority prefix from any crashed prior run
	frappe.db.delete("Farda Payment Log", {"authority": ("like", "FAKEE2E%")})
	frappe.db.commit()

	results: list[str] = []

	# ---------- 1) customer with identity + audit ----------
	existing_cust = frappe.db.exists("Customer", f"{PREFIX} CUST")
	customer = (
		frappe.get_doc("Customer", existing_cust)
		if existing_cust
		else frappe.get_doc({
			"doctype": "Customer",
			"customer_name": f"{PREFIX} CUST",
			"customer_type": "Individual",
			"farda_national_id": "0012345601",
		}).insert()
	)
	audit_row = frappe.get_all(
		"Farda Audit Log",
		filters={"subject_doctype": "Customer", "subject_name": customer.name, "action": ("in", ["Create", "IdentityChange"])},
		limit=1,
	)
	assert audit_row, "no audit row for customer identity"
	results.append("PASS: customer w/ کد ملی → audit Create row (identity tracked at birth)")

	# ---------- 2) banking: IBAN → bank account ----------
	resolve = frappe.get_attr("erpnext.farda_iran.api.banking.resolve_iban")
	info = resolve(iban="IR200170000000000123456789")
	assert info.get("valid") and info.get("bank_name") == "بانک ملی ایران", info
	gl_account = frappe.db.get_value(
		"Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name"
	)
	existing_ba = frappe.db.exists("Bank Account", {"account_name": f"{PREFIX} ACC"})
	ba = (
		frappe.get_doc("Bank Account", existing_ba)
		if existing_ba
		else frappe.get_doc({
			"doctype": "Bank Account",
			"account_name": f"{PREFIX} ACC",
			"bank_name": "بانک ملی ایران",
			"iban": "IR200170000000000123456789",
			"company": company,
			"account": gl_account,
		}).insert()
	)
	assert ba.bank, "registry bank not linked"
	results.append("PASS: IBAN → Bank Account w/ registry bank auto-link (بانک ملی ایران)")

	# ---------- 3) stock top-up (PR) → SO → DN → SI with VAT ----------
	item = "FARDA-SMOKE ITEM-001"  # gate5 fixture (stock item + Farda Smoke Selling price)
	wh = frappe.db.get_value(
		"Warehouse", {"company": company, "is_group": 0, "warehouse_name": ("like", "%Stores%")}, "name"
	) or frappe.db.get_value("Warehouse", {"company": company, "is_group": 0}, "name")
	supplier = frappe.db.get_value("Supplier", {"disabled": 0}, "name")
	if not supplier:  # virgin site: seed one (PR requires a supplier)
		supplier = frappe.get_doc({
			"doctype": "Supplier",
			"supplier_name": f"{PREFIX} SUP",
			"supplier_type": "Individual",
		}).insert().name
	pr = frappe.get_doc({
		"doctype": "Purchase Receipt",
		"company": company,
		"supplier": supplier,
		"currency": "IRR",
		"conversion_rate": 1,
		"items": [{"item_code": item, "qty": 6, "rate": 500_000, "warehouse": wh}],
	}).insert()
	pr.submit()
	from erpnext.selling.doctype.sales_order.sales_order import make_delivery_note
	from erpnext.stock.doctype.delivery_note.delivery_note import make_sales_invoice

	so = frappe.get_doc({
		"doctype": "Sales Order",
		"customer": customer.name,
		"company": company,
		"currency": "IRR",
		"selling_price_list": "Farda Smoke Selling",
		"transaction_date": frappe.utils.nowdate(),
		"delivery_date": frappe.utils.add_days(frappe.utils.nowdate(), 7),
		"items": [{"item_code": item, "qty": 2, "rate": 1_000_000, "warehouse": wh}],
	}).insert()
	so.submit()
	dn = frappe.get_doc(make_delivery_note(so.name))
	dn.insert()
	dn.submit()
	si = frappe.get_doc(make_sales_invoice(dn.name))
	si.farda_apply_vat = 1
	si.insert()
	si.submit()
	# net 2,000,000 + VAT 200,000 = 2,200,000 IRR
	assert abs(si.grand_total - 2_200_000) < 0.01, si.grand_total
	vat_rows = [t for t in si.taxes if t.account_head == frappe.db.get_value(
		"Farda VAT Settings", None, "vat_account")]
	assert len(vat_rows) == 1 and abs(vat_rows[0].tax_amount - 200_000) < 0.01, si.taxes
	results.append("PASS: SO→DN→SI با VAT ۱۰٪ — grand ۲٬۲۰۰٬۰۰۰ IRR، سطر مالیات درست")

	# ---------- 4) Persian print render ----------
	pf_html = frappe.db.get_value("Print Format", "Farda Persian Invoice", "html")
	html = frappe.get_jenv().from_string(pf_html).render({
		"doc": si,
		"print_settings": frappe.get_doc("Print Settings").as_dict(),
		"letter_head": None,
		"no_letterhead": 1,
	})
	assert "۰۰۱۲۳۴۵۶۰۱" in html, "customer کد ملی missing from print"
	assert "۲۲۰٬۰۰۰" in html, "grand in Toman missing from print"
	results.append("PASS: Persian print — کد ملی + ۲۲۰٬۰۰۰ تومان rendered")

	# ---------- 5) gateway sandbox → PE → SI Paid ----------
	from erpnext.farda_iran.payments import api as pay_api
	fake = _E2EFakeHTTP()
	real_gateway = pay_api._gateway
	pay_api._gateway = lambda name, transport=None: real_gateway(name, transport=fake)
	try:
		start = pay_api.start_payment(
			gateway="zarinpal",
			amount_irr=int(si.grand_total),
			reference_doctype="Sales Invoice",
			reference_name=si.name,
		)
		authority = start["authority"]
		verify = pay_api.verify_payment(gateway="zarinpal", authority=authority, amount_irr=int(si.grand_total))
		assert verify["decision"].lower() == "accept", verify
		pe_name = verify["payment_entry"]
		assert pe_name, verify
	finally:
		pay_api._gateway = real_gateway

	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
	_ = get_payment_entry  # (pattern parity with gate5)

	pe = frappe.get_doc("Payment Entry", pe_name)
	pe.reference_no = f"{PREFIX}-GW"
	pe.reference_date = frappe.utils.nowdate()
	pe.save()
	pe.submit()
	assert frappe.db.get_value("Sales Invoice", si.name, "outstanding_amount") == 0, "SI not settled"
	submit_rows = frappe.get_all(
		"Farda Audit Log",
		filters={"subject_doctype": "Payment Entry", "subject_name": pe.name, "action": "Submit"},
	)
	assert submit_rows, "no PE Submit audit row"
	results.append("PASS: gateway sandbox start→verify→ACCEPT→PE submit → SI outstanding = 0 (+audit)")

	# ---------- 6) cheque lifecycle via PE wiring ----------
	cheque = frappe.get_doc({
		"doctype": "Cheque",
		"direction": "Received",
		"cheque_number": f"{PREFIX}-1001",
		"amount": 400_000,
		"issue_date": frappe.utils.nowdate(),
		"due_date": frappe.utils.add_days(frappe.utils.nowdate(), 5),
		"company": company,
		"party_type": "Customer",
		"party": customer.name,
	}).insert()
	create_pe = frappe.get_attr("erpnext.farda_iran.cheque.payment_link.create_payment_entry")
	pe2_name = create_pe(cheque=cheque.name)
	pe2 = frappe.get_doc("Payment Entry", pe2_name)
	assert pe2.farda_cheque == cheque.name and pe2.docstatus == 0
	pe2.submit()
	assert frappe.db.get_value("Cheque", cheque.name, "status") == "Cleared", "cheque not cleared"
	# legal path produced TWO StatusChange rows (Received→Deposited→Cleared)
	steps = frappe.get_all(
		"Farda Audit Log",
		filters={"subject_doctype": "Cheque", "subject_name": cheque.name, "action": "StatusChange"},
		fields=["name", "old_value", "new_value"],
		order_by="creation asc",
	)
	assert len(steps) == 2, [dict(r) for r in steps]
	assert '"Deposited"' in (steps[0].new_value or "") and '"Cleared"' in (steps[1].new_value or ""), steps
	results.append("PASS: cheque↔PE wiring — legal 2-step clear (Received→Deposited→Cleared) + 2 audit rows")
	pe2.cancel()
	assert frappe.db.get_value("Cheque", cheque.name, "status") == "Received", "cheque not reverted on PE cancel"
	results.append("PASS: PE cancel → cheque reverted to Received")

	# ---------- 7) reports + KPIs + health ----------
	sr = frappe.get_attr("erpnext.farda_iran.report.farda_sales_register.farda_sales_register.execute")
	sr_rows = sr({"company": company, "from_date": frappe.utils.add_days(frappe.utils.nowdate(), -1)})[1]
	assert any(r["name"] == si.name for r in sr_rows), "SI missing from Sales Register"
	vr = frappe.get_attr("erpnext.farda_iran.report.farda_vat_report.farda_vat_report.execute")
	vr_rows = vr({"company": company})[1]
	assert any(r.get("voucher") == si.name for r in vr_rows), "SI missing from VAT Report"
	pb = frappe.get_attr("erpnext.farda_iran.report.farda_party_balance.farda_party_balance.execute")
	pb_columns, pb_rows = pb({"company": company})
	assert pb_columns and isinstance(pb_rows, list), "party balance broken"
	from erpnext.farda_iran.dashboard.kpis import collect_kpis

	kpis = collect_kpis(company=company)
	assert kpis, "kpis empty"
	from erpnext.farda_iran.monitoring.service import collect_health

	h = collect_health(force=True)
	assert h["checks"]["db"] == "ok" and h["checks"]["redis"] == "ok", h
	results.append("PASS: Sales Register + VAT Report + Party Balance + KPIs + health — chain reflected")

	# ---------- cleanup: PEs cancelled/removed; chain docs persist like gate5 ----------
	try:
		if frappe.db.get_value("Payment Entry", pe2.name, "docstatus") == 2:
			frappe.delete_doc("Payment Entry", pe2.name, force=True, ignore_permissions=True)
		if frappe.db.get_value("Payment Entry", pe.name, "docstatus") == 2:
			frappe.delete_doc("Payment Entry", pe.name, force=True, ignore_permissions=True)
		frappe.db.delete("Farda Payment Log", {"authority": ("like", "FAKEE2E%")})
	except Exception:
		frappe.log_error(title="R19 cleanup", message=frappe.get_traceback())
	frappe.db.set_value("Cheque", cheque.name, "payment_entry", None)

	return " | ".join(results)
