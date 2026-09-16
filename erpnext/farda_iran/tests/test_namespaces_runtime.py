"""R21 — API namespaces E2E (§34) on the live smoke site.

Proves the §21 contract end-to-end through the whitelisted dispatchers:
  1. farda.tax.calculate_vat  → envelope ok + HALF-UP numbers (10% default)
  2. bad input                → VALIDATION code
  3. farda.party.get_profile  → identity fields + farda_search_key; NOT_FOUND
  4. farda.party.search       → normalized hit for FardaE2E CUST
  5. farda.bank.resolve       → بانک ملی ایران + linked accounts; invalid → VALIDATION
  6. farda.reports.run        → real report rows; non-allowlisted → VALIDATION;
                                rate-limit branch → RATE_LIMITED
  7. authz                    → Guest + roleless user both FORBIDDEN; unknown
                                action → VALIDATION

Identity: roleless probe user FARDANS-PROBE created and deleted in-suite.
Read-only surface: no Notification/Audit rows asserted-changed by handlers.
"""

from __future__ import annotations

import frappe

PROBE_USER = "fardans-probe@example.local"


def _cleanup_probe_user() -> None:
	if frappe.db.exists("User", PROBE_USER):
		frappe.delete_doc("User", PROBE_USER, force=True, ignore_permissions=True)
	frappe.db.delete("Has Role", {"parent": PROBE_USER})


def run() -> str:
	from erpnext.farda_iran.api import namespaces as ns
	from erpnext.farda_iran.tests.test_e2e_breadth_runtime import _company, _ensure_fixtures

	results: list[str] = []
	_ensure_fixtures()
	_company()  # fixtures warm-up (name unused here)
	_cleanup_probe_user()
	frappe.db.commit()

	as_admin = frappe.session.user  # Administrator

	# ---------- 1) tax.calculate_vat ----------
	out = ns.tax(action="calculate_vat", net_amount=1_000_000)
	assert out["ok"] is True, out
	data = out["data"]
	assert data["total_tax"] == 100_000.0 and data["gross"] == 1_100_000.0, data
	assert data["rate"] == 10.0, data
	out = ns.tax(action="calculate_vat", net_amount=1_000_000, rate=0)
	assert out["ok"] and out["data"]["total_tax"] == 0.0, out  # configurable rate
	results.append("PASS: farda.tax.calculate_vat — پاکت ok + نرخ پیش‌فرض ۱۰٪ و نرخ صفر قابل‌تنظیم")

	# ---------- 2) validation errors ----------
	out = ns.tax(action="calculate_vat", net_amount="abc")
	assert out["ok"] is False and out["error"]["code"] == "VALIDATION", out
	out = ns.tax(action="bogus")
	assert out["ok"] is False and out["error"]["code"] == "VALIDATION", out
	results.append("PASS: خطای فرمت — ورودی خراب/action ناشناخته → VALIDATION")

	# ---------- 3) party.get_profile ----------
	customer = frappe.db.get_value("Customer", {"customer_name": "FardaE2E CUST"}, "name")
	assert customer
	out = ns.party(action="get_profile", party_type="Customer", name=customer)
	assert out["ok"] is True, out
	assert out["data"]["farda_national_id"] == "0012345601", out["data"]
	assert out["data"]["farda_search_key"], out["data"]
	out = ns.party(action="get_profile", party_type="Customer", name="NOPE-404")
	assert out["ok"] is False and out["error"]["code"] == "NOT_FOUND", out
	results.append("PASS: farda.party.get_profile — فیلدهای هویتی + کلید جستجو؛ ناشناخته → NOT_FOUND")

	# ---------- 4) party.search ----------
	out = ns.party(action="search", query="cust", party_type="Customer")
	assert out["ok"] is True and any(r["name"] == customer for r in out["data"]["results"]), out
	results.append("PASS: farda.party.search — یافتن مشتری با نرمال‌سازی فارسی")

	# ---------- 5) bank.resolve ----------
	out = ns.bank(action="resolve", iban="IR200170000000000123456789")
	assert out["ok"] is True, out
	assert out["data"].get("bank_name") == "بانک ملی ایران", out["data"]
	assert isinstance(out["data"].get("linked_accounts"), list), out["data"]
	out = ns.bank(action="resolve", iban="IR000000000000000000000000")
	assert out["ok"] is False and out["error"]["code"] == "VALIDATION", out
	results.append("PASS: farda.bank.resolve — تشخیص بانک از شبا + حساب‌های متصل؛ نامعتبر → VALIDATION")

	# ---------- 6) reports.run + rate-limit branch ----------
	out = ns.reports(action="run", report="farda_sales_register", filters={})
	assert out["ok"] is True, out
	assert "result" in out["data"], list(out["data"])[:5]
	out = ns.reports(action="run", report="General Ledger")
	assert out["ok"] is False and out["error"]["code"] == "VALIDATION", out
	original_rate_ok = ns._reports_rate_ok
	try:
		ns._reports_rate_ok = lambda user: False
		out = ns.reports(action="run", report="farda_sales_register")
		assert out["ok"] is False and out["error"]["code"] == "RATE_LIMITED", out
	finally:
		ns._reports_rate_ok = original_rate_ok
	results.append("PASS: farda.reports.run — سطرهای واقعی + allowlist + شاخهٔ RATE_LIMITED")

	# ---------- 7) authorization ----------
	frappe.set_user("Guest")
	try:
		out = ns.party(action="search", query="cust")
		assert out["ok"] is False and out["error"]["code"] == "FORBIDDEN", out
	finally:
		frappe.set_user(as_admin)
	frappe.get_doc(
		{
			"doctype": "User",
			"email": PROBE_USER,
			"first_name": "NS Probe",
			"send_welcome_email": 0,
		}
	).insert(ignore_permissions=True)
	frappe.set_user(PROBE_USER)
	try:
		out = ns.bank(action="resolve", iban="IR200170000000000123456789")
		assert out["ok"] is False and out["error"]["code"] == "FORBIDDEN", out
		out = ns.reports(action="run", report="farda_sales_register")
		assert out["ok"] is False and out["error"]["code"] == "FORBIDDEN", out
	finally:
		frappe.set_user(as_admin)
	results.append("PASS: authz — Guest و کاربر بی‌نقش هر دو → FORBIDDEN")

	# ---------- cleanup ----------
	try:
		_cleanup_probe_user()
	except Exception:
		frappe.log_error(title="R21 cleanup", message=frappe.get_traceback())
	frappe.db.commit()

	return "\n".join(results) + f"\nR21: {len(results)}/7 PASS"
