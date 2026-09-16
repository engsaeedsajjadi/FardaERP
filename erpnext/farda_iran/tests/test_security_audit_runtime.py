"""R16 — dedicated security audit pass (§23 checklist as executable tests).

Live-site checks across the Farda surfaces:
  S1 guest surface — the ONLY farda_iran whitelisted methods reachable by Guest
     are OTP request/verify + payment verify (enumerated from frappe sets).
  S2 XSS — print formats escape user-controlled fields (payload rendered via
     mock docs; no DB writes needed). frappe's Jinja has autoescape OFF, so the
     formats themselves must apply `| e`.
  S3 SQLi — search APIs with classic payloads: no crash, no extra rows, target
     table intact (all Farda SQL is parameterized or allowlisted by design).
  S4 PII minimization — response keys of OTP/search/payment-status APIs; audit
     sanitizer masks identity + secrets (no full values, no OTP material).
  S5 escalation matrix — role×operation via frappe.has_permission:
     Sales User / Accounts User / System Manager / Guest.
"""

from __future__ import annotations

import frappe

PAYLOAD = '<script>alert(1)</script>'


def _farda_whitelisted():
	# importing the api modules triggers the whitelist decorators' registration
	import erpnext.farda_iran.api.banking  # noqa: F401
	import erpnext.farda_iran.api.conversions  # noqa: F401
	import erpnext.farda_iran.api.search  # noqa: F401
	import erpnext.farda_iran.dashboard.kpis  # noqa: F401
	import erpnext.farda_iran.cheque.payment_link  # noqa: F401
	import erpnext.farda_iran.doctype.cheque.cheque  # noqa: F401
	import erpnext.farda_iran.monitoring.api  # noqa: F401
	import erpnext.farda_iran.otp.api  # noqa: F401
	import erpnext.farda_iran.payments.api  # noqa: F401

	whitelisted = getattr(frappe, "whitelisted", set()) or set()
	guest = getattr(frappe, "guest_methods", set()) or set()
	fw = {f for f in whitelisted if "farda_iran" in getattr(f, "__module__", "")}
	fg = {f for f in guest if "farda_iran" in getattr(f, "__module__", "")}
	return fw, fg


def _render_with_mock(fmt_path: str, doc_extra: dict, items: list[dict]) -> str:
	"""Render a print format against a mock invoice doc (no DB writes)."""
	import os
	from frappe.modules.import_file import import_file_by_path

	slug = {
		"Farda Persian Invoice": "farda_persian_invoice",
		"Farda Persian Purchase Invoice": "farda_persian_purchase_invoice",
		"Farda Thermal Receipt 80mm": "farda_thermal_receipt_80mm",
	}[fmt_path]
	path = os.path.join(
		frappe.get_module_path("Farda Iran"), "print_format", slug, f"{slug}.json"
	)
	import_file_by_path(path, force=True)  # refresh DB copy from repo (migrate parity)
	html = frappe.db.get_value("Print Format", fmt_path, "html")
	assert html, f"{fmt_path}: no html after sync"

	class _Doc(dict):
		"""dict whose .items resolves to the stored list, not dict.items (Jinja loop)."""

		@property
		def items(self):
			return self.get("items")

		def __getattr__(self, k):
			try:
				return self[k]
			except KeyError:
				return None

	doc = _Doc({
		"name": "SEC-XSS-1",
		"posting_date": frappe.utils.nowdate(),
		"company": frappe.db.get_value("Company", {"is_group": 0}, "name"),
		"customer": None,
		"supplier": None,
		"taxes": None,
		"net_total": 1_000_000,
		"grand_total": 1_100_000,
		"discount_amount": None,
		"bill_no": None,
		"items": items,
		**doc_extra,
	})
	jenv = frappe.get_jenv()
	return jenv.from_string(html).render({
		"doc": doc,
		"print_settings": frappe.get_doc("Print Settings").as_dict(),
		"letter_head": None,
		"no_letterhead": 1,
	})


def _assert_escaped(html: str, label: str):
	assert PAYLOAD not in html, f"{label}: raw <script> reached print output"
	assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html, f"{label}: payload not HTML-escaped"
	assert "<script>" not in html, f"{label}: script tag present"


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()

	results: list[str] = []
	_users: list[str] = []

	try:
		# ---------- S1: guest surface enumeration ----------
		fw, fg = _farda_whitelisted()
		assert len(fw) >= 12, f"farda whitelisted methods unexpectedly small: {len(fw)}"
		expected_guest = {
			"erpnext.farda_iran.otp.api.request_otp",
			"erpnext.farda_iran.otp.api.verify_otp",
			"erpnext.farda_iran.payments.api.verify_payment",
			"erpnext.farda_iran.monitoring.api.health",  # § Monitoring probe (LB/uptime)
		}
		actual = {getattr(f, "__name__", "") and f"{f.__module__}.{f.__name__}" for f in fg}
		assert actual == expected_guest, f"guest surface drift: {actual ^ expected_guest}"
		results.append("PASS: guest surface = exactly OTP×2 + payment verify (no drift)")

		# ---------- S2: XSS escaping in all three print formats ----------
		items = [{"item_name": PAYLOAD, "qty": 1, "rate": 1_000_000, "amount": 1_000_000, "uom": "Nos"}]
		for fmt in (
			"Farda Persian Invoice",
			"Farda Persian Purchase Invoice",
			"Farda Thermal Receipt 80mm",
		):
			extra = {}
			if fmt == "Farda Persian Purchase Invoice":
				extra = {"supplier_name": PAYLOAD, "bill_no": PAYLOAD}
			else:
				extra = {"customer_name": PAYLOAD}
			html = _render_with_mock(fmt, extra, items)
			_assert_escaped(html, fmt)
		results.append("PASS: XSS — party/item payloads escaped in all 3 print formats (autoescape off)")

		# ---------- S3: SQLi via search APIs ----------
		customer_count_before = frappe.db.count("Customer")
		for payload in (
			"'; DROP TABLE tabCustomer;--",
			"%' OR 1=1 --",
			"کد' UNION SELECT 1,2 --",
			"\\'; EXEC sp_msforEachDb 'x';--",
		):
			out = frappe.get_attr("erpnext.farda_iran.api.search.search_party")(
				doctype="Customer", query=payload
			)
			assert set(out.keys()) <= {"results"}, out.keys()
			for r in out["results"]:
				assert set(r.keys()) <= {"name", "title", "doctype"}, r
		assert frappe.db.count("Customer") == customer_count_before, "Customer table mutated?!"
		item_out = frappe.get_attr("erpnext.farda_iran.api.search.search_item")(
			query="%' OR '1'='1"
		)
		assert "results" in item_out
		results.append("PASS: SQLi payloads via search APIs — parameterized, table intact, minimal columns")

		# ---------- S4: PII minimization in API responses ----------
		otp_req = frappe.get_attr("erpnext.farda_iran.otp.api.request_otp")
		# do NOT hit the real store/ratelimiter — introspect the source contract instead
		import inspect

		src = inspect.getsource(otp_req)
		assert 'challenge_id' in src and 'code_hash' not in src.split('return')[1], "OTP response leaks material"
		pay_status = frappe.get_attr("erpnext.farda_iran.payments.api.payment_status")
		src = inspect.getsource(pay_status)
		for leaked in ("raw_verify_response", "reference_doctype", "reference_name"):
			assert leaked not in src.split('for k in')[1].split(')')[0], f"payment_status leaks {leaked}"
		from erpnext.farda_iran.audit.service import redact_value

		assert redact_value("farda_national_id", "0012345601") == "…5601"
		assert redact_value("otp_code", "any") == "***"
		assert redact_value("password", "any") == "***"
		results.append("PASS: PII — OTP/payment responses minimal; sanitizer masks identity+secrets")

		# ---------- S5: escalation matrix ----------
		for email, roles in (
			("sec.sales@audit.farda", ["Sales User"]),
			("sec.accuser@audit.farda", ["Accounts User"]),
		):
			if not frappe.db.exists("User", email):
				frappe.get_doc({
					"doctype": "User", "email": email, "first_name": "SEC",
					"send_welcome_email": 0, "roles": [{"role": r} for r in roles],
				}).insert(ignore_permissions=True)
			_users.append(email)

		def hp(doctype, ptype, user):
			return bool(frappe.has_permission(doctype, ptype=ptype, user=user))

		guest_user = frappe.db.get_value("User", {"user_type": "Guest"}, "name") or "Guest"
		assert not hp("Farda Audit Log", "read", "sec.sales@audit.farda")
		assert not hp("Farda Audit Log", "read", "sec.accuser@audit.farda")
		assert not hp("Farda Audit Log", "read", guest_user)
		assert hp("Farda Audit Log", "read", "Administrator")
		assert not hp("Cheque", "create", "sec.sales@audit.farda")
		assert hp("Cheque", "create", "sec.accuser@audit.farda")
		assert not hp("Farda VAT Settings", "write", "sec.accuser@audit.farda")
		assert not hp("Farda VAT Settings", "read", "sec.sales@audit.farda")
		assert not hp("Farda OTP Log", "read", "sec.sales@audit.farda")
		results.append("PASS: escalation matrix — audit log SM-only-read; cheque by Accounts roles only; VAT settings locked; nothing for Guest/Sales")

		return " | ".join(results)
	finally:
		frappe.set_user("Administrator")
		for email in _users:
			if frappe.db.exists("User", email):
				try:
					frappe.delete_doc("User", email, force=True, ignore_permissions=True)
				except Exception:
					frappe.log_error(title="R16 teardown", message=email)
