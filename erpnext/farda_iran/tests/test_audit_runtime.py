"""R14 — §24 audit trail E2E against the live site.

Proves on a real site:
  1. VAT settings change → SettingsChange row with old/new rate + user + IP
  2. Cheque create → Create row; legal transition → StatusChange (old→new status)
  3. Payment Entry submit + cancel → Submit + Cancel rows
  4. Party identity change → IdentityChange with MASKED old/new (last-4 only)
  5. Sanitizer: secrets (password/otp/merchant) never stored; identity masked
  6. Permissions: low-priv user can neither read nor create audit rows
  7. Append-only: editing/deleting an audit row raises even for Administrator
Every artifact rolls back; audit rows are intentionally KEPT (append-only).
"""

from __future__ import annotations

import json

import frappe

AUDIT = "Farda Audit Log"
IP = "203.0.113.77"


def _run():  # noqa: C901
	frappe.set_user("Administrator")
	# upstream strict-PostgreSQL shims are per-process: SI/PE submits in this
	# test touch the payment-ledger outstanding query (PG-13 family)
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()

	# fresh schema + hooks cache for this process
	if not frappe.db.exists("DocType", AUDIT):
		frappe.reload_doc("farda_iran", "doctype", "farda_audit_log")
	frappe.clear_cache(doctype=AUDIT)
	frappe.clear_cache()

	from erpnext.farda_iran.audit import service as audit

	results: list[str] = []
	created = {"customers": [], "cheques": [], "pes": [], "sis": []}

	# simulated web request IP for the whole run
	frappe.local.request_ip = IP

	def rows_for(subject_doctype, subject_name):
		return frappe.get_all(
			AUDIT,
			filters={"subject_doctype": subject_doctype, "subject_name": subject_name},
			fields=["name", "action", "old_value", "new_value", "details", "ip_address", "owner"],
			order_by="creation asc",
		)

	try:
		# ---------- 1) VAT settings change ----------
		vat = frappe.get_doc("Farda VAT Settings")
		old_rate = vat.default_rate
		vat.default_rate = 12.5
		vat.save()
		vrows = rows_for("Farda VAT Settings", vat.name)
		last = [r for r in vrows if r.action == "SettingsChange"][-1]
		assert json.loads(last.new_value)["default_rate"] == "12.5", last
		assert json.loads(last.old_value)["default_rate"] == str(old_rate), last
		assert last.ip_address == IP, last
		assert last.owner == "Administrator", last
		results.append("PASS: VAT settings change → SettingsChange row (old/new rate, user, IP)")
		vat.default_rate = old_rate
		vat.save()

		# ---------- 2) cheque lifecycle ----------
		ch = frappe.get_doc({
			"doctype": "Cheque",
			"direction": "Received",
			"cheque_number": "AUDIT-1001",
			"amount": 500_000,
			"issue_date": frappe.utils.today(),
			"due_date": frappe.utils.add_days(frappe.utils.today(), 10),
			"company": frappe.db.get_value("Company", {"is_group": 0}, "name"),
			"party_type": "Customer",
			"party": frappe.db.get_value("Customer", {"disabled": 0}, "name"),
		}).insert()
		created["cheques"].append(ch.name)
		crows = rows_for("Cheque", ch.name)
		assert any(r.action == "Create" for r in crows), crows
		ch.status = "Deposited"
		ch.save()
		crows = rows_for("Cheque", ch.name)
		sc = [r for r in crows if r.action == "StatusChange"][-1]
		assert json.loads(sc.old_value)["status"] == "Received", sc
		assert json.loads(sc.new_value)["status"] == "Deposited", sc
		results.append("PASS: cheque Create + legal transition → StatusChange row (old→new)")

		# ---------- 3) payment entry submit + cancel ----------
		cust = frappe.get_doc({
			"doctype": "Customer",
			"customer_name": "AUDIT CUST",
			"customer_type": "Individual",
		}).insert()
		created["customers"].append(cust.name)
		si = frappe.get_doc({
			"doctype": "Sales Invoice",
			"company": frappe.db.get_value("Company", {"is_group": 0}, "name"),
			"customer": cust.name,
			"currency": frappe.db.get_value("Company", {"is_group": 0}, "default_currency"),
			"items": [{"item_code": frappe.db.get_value("Item", {"disabled": 0, "is_stock_item": 0}, "name") or frappe.db.get_value("Item", {"disabled": 0}, "name"), "qty": 1, "rate": 1_000_000}],
		}).insert()
		si.submit()
		created["sis"].append(si.name)
		from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

		pe = get_payment_entry(si.doctype, si.name)
		pe.reference_no = "AUDIT-REF-1"
		pe.reference_date = frappe.utils.today()
		pe.insert()
		pe.submit()
		pe.cancel()
		created["pes"].append(pe.name)
		prows = rows_for("Payment Entry", pe.name)
		actions = [r.action for r in prows]
		assert "Submit" in actions and "Cancel" in actions, (actions, prows)
		results.append("PASS: Payment Entry submit → Submit row + cancel → Cancel row")

		# ---------- 4) identity change masked ----------
		nid = "0012345601"  # valid check-digit (party validate enforces)
		cust.db_set("farda_national_id", nid)
		cust.reload()
		cust.farda_national_id = "0098765401"
		cust.save()
		irows = rows_for("Customer", cust.name)
		ic = [r for r in irows if r.action == "IdentityChange"][-1]
		stored = (ic.old_value or "") + (ic.new_value or "")
		assert "…5601" in stored and "…5401" in stored, ic
		assert nid not in stored and "0098765401" not in stored, ic  # full values never stored
		results.append("PASS: identity change → IdentityChange row, values masked to last-4")

		# ---------- 5) sanitizer direct ----------
		assert audit.redact_value("password", "x") == "***"
		assert audit.redact_value("merchant_id", "z") == "***"
		assert audit.redact_value("otp_code", "1") == "***"
		results.append("PASS: sanitizer — password/merchant/otp keys never storable")

		# ---------- 6) permission negatives ----------
		frappe.set_user("Guest")
		try:
			frappe.get_list(AUDIT, limit=1)  # permission-aware API
			raise AssertionError("Guest could read the audit log")
		except frappe.PermissionError:
			pass
		try:
			frappe.get_doc({
				"doctype": AUDIT,
				"subject_doctype": "Customer",
				"subject_name": "X",
				"action": "Create",
			}).insert()
			raise AssertionError("Guest could create an audit row via API")
		except frappe.PermissionError:
			pass
		frappe.set_user("Administrator")
		results.append("PASS: low-priv user cannot read or create audit rows")

		# ---------- 7) append-only ----------
		row = frappe.get_all(AUDIT, limit=1, order_by="creation desc")[0]
		audit_doc = frappe.get_doc(AUDIT, row.name)
		audit_doc.details = "tampered"
		try:
			audit_doc.save()
			raise AssertionError("audit row was editable")
		except frappe.ValidationError:
			pass
		try:
			audit_doc.delete()
			raise AssertionError("audit row was deletable")
		except (frappe.ValidationError, frappe.PermissionError):
			pass
		results.append("PASS: append-only — edit/delete of audit rows blocked even for Administrator")

		return " | ".join(results)
	finally:
		# rollback business artifacts (audit rows are KEPT — append-only by design)
		frappe.set_user("Administrator")
		for pe_name in created["pes"]:
			if frappe.db.exists("Payment Entry", pe_name):
				frappe.delete_doc("Payment Entry", pe_name, force=True, ignore_permissions=True)
		for si_name in created["sis"]:
			if frappe.db.exists("Sales Invoice", si_name):
				if frappe.db.get_value("Sales Invoice", si_name, "docstatus") == 1:
					frappe.get_doc("Sales Invoice", si_name).cancel()
				frappe.delete_doc("Sales Invoice", si_name, force=True, ignore_permissions=True)
		for ch_name in created["cheques"]:
			if frappe.db.exists("Cheque", ch_name):
				frappe.delete_doc("Cheque", ch_name, force=True, ignore_permissions=True)
		for cu in created["customers"]:
			if frappe.db.exists("Customer", cu):
				frappe.delete_doc("Customer", cu, force=True, ignore_permissions=True)
		if getattr(frappe.local, "request_ip", None) == IP:
			frappe.local.request_ip = None


def run() -> str:
	return _run()
