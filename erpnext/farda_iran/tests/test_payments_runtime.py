"""E2E runtime test for the payment layer, executed against a live site.

Covers: start→Initialized log, verify→ACCEPT→PE draft, idempotent replay,
unknown-authority FAIL_UNKNOWN_TX, low-amount replay FAIL_AMOUNT, negative input
validation. Uses ZarinPal adapter with an injected fake transport (no real HTTP,
no real credentials). Rolls the whole transaction back at the end.
"""

from __future__ import annotations

import frappe


class _Resp:
	def __init__(self, payload):
		self._payload = payload

	def json(self):
		return self._payload


class _FakeZarinpalHTTP:
	"""Records requests; deterministic sandbox-shaped responses."""

	def __init__(self):
		self.calls: list[tuple[str, dict]] = []
		self.authorities: dict[str, int] = {}  # authority -> amount sent at request time
		self.verify_behaviour: dict[str, dict] = {}  # authority -> {"code":..., "amount":...}

	def post(self, url, json=None, timeout=None):
		self.calls.append((url, dict(json or {})))
		if url.endswith("/request.json"):
			authority = f"FAKEAUTH{len(self.authorities) + 1:06d}"
			self.authorities[authority] = int(json["amount"])
			self.verify_behaviour.setdefault(
				authority, {"code": 100, "amount": int(json["amount"])}
			)
			return _Resp({"data": {"code": 100, "message": "", "authority": authority}})
		if url.endswith("/verify.json"):
			authority = json["authority"]
			behaviour = self.verify_behaviour.get(
				authority, {"code": -50, "amount": int(json.get("amount", 0))}
			)
			payload = {
				"data": {
					"code": behaviour["code"],
					"message": "ok" if behaviour["code"] in (100, 101) else "failed",
					"amount": behaviour["amount"],
					"ref_id": 987654321,
				}
			}
			return _Resp(payload)
		raise AssertionError(f"unexpected url {url}")


def _make_customer_and_invoice(unique: str, rate: int):
	customer = frappe.get_doc({
		"doctype": "Customer",
		"customer_name": unique,
		"customer_type": "Individual",
	}).insert()
	item = frappe.get_doc({
		"doctype": "Item",
		"item_code": unique,
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
	}).insert()
	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	si = frappe.get_doc({
		"doctype": "Sales Invoice",
		"company": company,
		"customer": customer.name,
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"conversion_rate": 1,
		"posting_date": frappe.utils.nowdate(),
		"items": [{"item_code": item.name, "qty": 1, "rate": rate}],
	}).insert()
	si.submit()
	return si


def run() -> str:
	frappe.set_user("Administrator")
	import os

	os.environ.setdefault("ZARINPAL_MERCHANT_ID", "test-merchant-for-runtime-suite")

	from erpnext.farda_iran.payments import api as pay_api
	from erpnext.farda_iran.payments.core import Decision

	fake = _FakeZarinpalHTTP()
	real_gateway = pay_api._gateway
	pay_api._gateway = lambda name, transport=None: real_gateway(name, transport=fake)

	results: list[str] = []
	amount = 1_000_000
	try:
		si = _make_customer_and_invoice("PAYRT CUSTOMER", amount)

		# ---- negative inputs ----
		for bad_kwargs, label in (
			({"gateway": "zarinpal", "amount_irr": 0}, "zero amount rejected"),
			({"gateway": "paypal", "amount_irr": amount}, "unknown gateway rejected"),
			(
				{"gateway": "zarinpal", "amount_irr": amount, "reference_doctype": "Sales Order", "reference_name": "NOPE"},
				"missing reference rejected",
			),
		):
			try:
				pay_api.start_payment(**bad_kwargs)
			except frappe.exceptions.ValidationError:
				results.append(f"PASS: {label}")
			else:
				raise AssertionError(f"{label} was accepted")

		# ---- T1 happy path ----
		start = pay_api.start_payment(
			gateway="zarinpal", amount_irr=amount,
			reference_doctype="Sales Invoice", reference_name=si.name,
		)
		auth = start["authority"]
		assert start["redirect_url"].startswith("https://"), start
		assert fake.authorities[auth] == amount
		st = pay_api.payment_status(authority=auth)
		assert st["status"] == "Initialized" and st["amount_irr"] == amount, st
		results.append("PASS: start_payment → redirect URL + Initialized log row")

		ver = pay_api.verify_payment(gateway="zarinpal", authority=auth, amount_irr=amount)
		assert ver["decision"] == Decision.ACCEPT.value, ver
		assert ver["payment_entry"], ver
		pe = frappe.get_doc("Payment Entry", ver["payment_entry"])
		assert pe.docstatus == 0, "PE must stay a draft"
		assert pe.reference_no.startswith("FAKEAUTH"), pe.reference_no
		assert pe.farda_payment_authority == auth
		received = pe.paid_amount
		assert int(received) == amount, (received, amount)
		st = pay_api.payment_status(authority=auth)
		assert st["status"] == "Verified", st
		results.append(f"PASS: verify → ACCEPT → draft PE {pe.name} linked (paid {int(pe.paid_amount):,} IRR)")

		# ---- T2 idempotent replay ----
		ver2 = pay_api.verify_payment(gateway="zarinpal", authority=auth, amount_irr=amount)
		assert ver2["decision"] == Decision.ALREADY_SETTLED.value and ver2["already"], ver2
		assert ver2["payment_entry"] == ver["payment_entry"], ver2
		results.append("PASS: replay of settled authority → ALREADY_SETTLED (idempotent echo)")

		# ---- T3 unknown authority ----
		ver3 = pay_api.verify_payment(gateway="zarinpal", authority="FAKEUNKNOWN", amount_irr=amount)
		assert ver3["decision"] == Decision.FAIL_UNKNOWN_TX.value, ver3
		results.append("PASS: unknown authority → FAIL_UNKNOWN_TX")

		# ---- T4 low-amount replay before settlement ----
		start2 = pay_api.start_payment(gateway="zarinpal", amount_irr=amount)
		auth2 = start2["authority"]
		fake.verify_behaviour[auth2] = {"code": 100, "amount": 500_000}  # tampered amount
		ver4 = pay_api.verify_payment(gateway="zarinpal", authority=auth2, amount_irr=None)
		assert ver4["decision"] == Decision.FAIL_AMOUNT.value, ver4
		assert pay_api.payment_status(authority=auth2)["status"] == "Failed"
		results.append("PASS: gateway-reported amount ≠ requested → FAIL_AMOUNT (replay guard)")

		# ---- T5 gateway reject after settlement ----
		start3 = pay_api.start_payment(gateway="zarinpal", amount_irr=amount)
		auth3 = start3["authority"]
		fake.verify_behaviour[auth3] = {"code": -50, "amount": amount}  # gateway refused
		ver5 = pay_api.verify_payment(gateway="zarinpal", authority=auth3, amount_irr=amount)
		assert ver5["decision"] == Decision.FAIL_STATUS.value, ver5
		results.append("PASS: gateway refusal → FAIL_STATUS (no PE)")
	except Exception:
		frappe.db.rollback()
		raise
	finally:
		pay_api._gateway = real_gateway

	frappe.db.rollback()  # leave the site untouched; everything above was in-transaction
	return " | ".join(results)
