"""R20 — Notifications E2E (§33) on the live smoke site.

Proves the five §22 triggers on real data + the SMS channel wiring:
  1. low_stock       : Bin below reorder level → Alert (deduped on rerun)
  2. invoice_overdue : submitted SI, outstanding>0, due<today → Alert
  3. payment_received / payment_failed : Farda Payment Log statuses → Alerts
  4. approval_pending : stale draft SI → Alert
  5. SMS channel: recording provider, env recipients (Persian digits + +98),
     body contract `[FardaERP] …`, exactly one send per NEW event × recipient
  6. contract: run() counts all kinds, unknown kind raises, live hooks wiring

Identity: authorities prefixed FARDANOTIF (unique namespace, self-healed at
start/end). Notification Log rows are cleaned by exact document identity
(Bin / payment-log subject marker / the SIs this suite created).
"""

from __future__ import annotations

import os

import frappe

PREFIX = "FARDANOTIF"


def _cleanup_payment_logs() -> None:
	frappe.db.delete("Farda Payment Log", {"authority": ("like", f"{PREFIX}%")})


def _cleanup_notif_rows(bin_name: str | None, si_names: list[str]) -> None:
	if bin_name:
		frappe.db.delete("Notification Log", {"document_type": "Bin", "document_name": bin_name})
	frappe.db.delete(
		"Notification Log", {"document_type": "Farda Payment Log", "subject": ("like", f"%{PREFIX}%")}
	)
	if si_names:
		frappe.db.delete("Notification Log", {"document_type": "Sales Invoice", "document_name": ("in", si_names)})


def _safe_remove_si(name: str, submitted: bool) -> None:
	try:
		if submitted and frappe.db.get_value("Sales Invoice", name, "docstatus") == 1:
			frappe.get_doc("Sales Invoice", name).cancel()
		frappe.delete_doc("Sales Invoice", name, force=True, ignore_permissions=True)
	except Exception:
		frappe.log_error(title="R20 cleanup SI", message=frappe.get_traceback())


def _make_so_si(company: str, customer: str, item: str, wh: str):
	"""Submitted SO + mapped draft SI (farda_apply_vat=1). Returns (so, si)."""
	from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

	so = frappe.get_doc(
		{
			"doctype": "Sales Order",
			"customer": customer,
			"company": company,
			"currency": "IRR",
			"conversion_rate": 1,
			"selling_price_list": "Farda Smoke Selling",
			"transaction_date": frappe.utils.nowdate(),
			"delivery_date": frappe.utils.add_days(frappe.utils.nowdate(), 7),
			"items": [{"item_code": item, "qty": 1, "rate": 1_000_000, "warehouse": wh}],
		}
	).insert()
	so.submit()
	si = frappe.get_doc(make_sales_invoice(so.name))
	si.farda_apply_vat = 1
	return so, si


def run() -> str:
	from erpnext.farda_iran.notifications import service as notif
	from erpnext.farda_iran.tests.test_e2e_breadth_runtime import _company, _ensure_fixtures
	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings

	results: list[str] = []
	created_sis: list[str] = []
	created_sos: list[str] = []

	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()

	_ensure_fixtures()
	company = _company()
	_setup_vat_settings(company)

	item = "FARDA-SMOKE ITEM-001"
	wh = frappe.db.get_value(
		"Warehouse", {"company": company, "is_group": 0, "warehouse_name": ("like", "%Stores%")}, "name"
	) or frappe.db.get_value("Warehouse", {"company": company, "is_group": 0}, "name")
	# self-seed the R19 fixture customer (idempotent; must not depend on
	# committed data from previous sessions)
	customer = frappe.db.get_value("Customer", {"customer_name": "FardaE2E CUST"}, "name") \
		or frappe.get_doc({"doctype": "Customer", "customer_name": "FardaE2E CUST",
						   "customer_type": "Individual", "company": company}).insert().name
	frappe.db.commit()
	assert customer, "R19 fixture customer missing"

	# self-heal: purge this suite's leftovers from crashed prior runs
	_cleanup_payment_logs()
	_cleanup_notif_rows(None, [])
	frappe.db.commit()

	users = notif._finance_users()
	assert users, "no finance recipient available"

	# ---------- 1) low stock ----------
	bin_row = frappe.db.get_value("Bin", {"item_code": item}, ["name", "warehouse", "actual_qty"], as_dict=True)
	assert bin_row, "Bin for smoke item missing"
	bin_name, wh_bin = bin_row.name, bin_row.warehouse
	# v16 reorder level lives on Item Reorder (child) — set 50 on the BIN's warehouse
	it = frappe.get_doc("Item", item)
	it.set(
		"reorder_levels",
		[
			{
				"warehouse_group": wh_bin,
				"warehouse": wh_bin,
				"warehouse_reorder_level": 50,
				"warehouse_reorder_qty": 100,
				"material_request_type": "Purchase",
			}
		],
	)
	it.save(ignore_permissions=True)
	assert frappe.db.exists("Item Reorder", {"parent": item, "warehouse": wh_bin}), "reorder row not saved"
	try:
		counts = notif.run(kinds=["low_stock"])
		assert counts["low_stock"] >= len(users), counts
		counts2 = notif.run(kinds=["low_stock"])
		assert counts2["low_stock"] == 0, counts2
		row = frappe.get_all(
			"Notification Log",
			filters={"document_type": "Bin", "document_name": bin_name, "type": "Alert"},
			fields=["subject"],
			limit=1,
		)
		assert row and "زیر نقطه سفارش" in row[0].subject, row
		results.append("PASS: low_stock — Bin زیر نقطه سفارش → Alert + dedupe اجرای دوم")
	finally:
		it2 = frappe.get_doc("Item", item)
		it2.set("reorder_levels", [])
		it2.save(ignore_permissions=True)

	# ---------- 2) invoice overdue ----------
	so1, si1 = _make_so_si(company, customer, item, wh)
	created_sos.append(so1.name)
	si1.insert()
	si1.submit()
	# backdate AFTER submit (validate rejects pre-submit) — direct db write
	frappe.db.set_value(
		"Sales Invoice", si1.name, "due_date", frappe.utils.add_days(frappe.utils.nowdate(), -1),
		update_modified=False,
	)
	created_sis.append(si1.name)
	try:
		counts = notif.run(kinds=["invoice_overdue"])
		assert counts["invoice_overdue"] >= len(users), counts
		row = frappe.get_value(
			"Notification Log",
			{"document_type": "Sales Invoice", "document_name": si1.name, "type": "Alert"},
			"subject",
		)
		assert row and "سررسید گذشته" in row and "تومان" in row, row
		results.append("PASS: invoice_overdue — فاکتور واخورده با ماندهٔ تومانی → Alert")
	finally:
		_safe_remove_si(si1.name, submitted=True)
		_cleanup_notif_rows(None, [si1.name])  # free the series name for later steps

	# ---------- 3) payment received / failed ----------
	assert frappe.db.exists("DocType", "Farda Payment Log")
	for authority, status, reason in (
		(f"{PREFIX}-VER-001", "Verified", None),
		(f"{PREFIX}-FAIL-001", "Failed", "insufficient funds"),
	):
		frappe.get_doc(
			{
				"doctype": "Farda Payment Log",
				"authority": authority,
				"gateway": "zarinpal",
				"amount_irr": 1_100_000,
				"status": status,
				"fail_reason": reason,
			}
		).insert(ignore_permissions=True)
	counts = notif.run(kinds=["payment_received", "payment_failed"])
	assert counts["payment_received"] >= len(users) and counts["payment_failed"] >= len(users), counts
	ver_name = frappe.db.get_value("Farda Payment Log", {"authority": f"{PREFIX}-VER-001"}, "name")
	fail_name = frappe.db.get_value("Farda Payment Log", {"authority": f"{PREFIX}-FAIL-001"}, "name")
	ver_subj = frappe.get_value(
		"Notification Log", {"document_type": "Farda Payment Log", "document_name": ver_name}, "subject"
	)
	fail_subj = frappe.get_value(
		"Notification Log", {"document_type": "Farda Payment Log", "document_name": fail_name}, "subject"
	)
	assert ver_subj and "تأیید شد" in ver_subj, ver_subj
	assert fail_subj and "ناموفق" in fail_subj and "insufficient funds" in fail_subj, fail_subj
	results.append("PASS: payment_received/failed — لاگ پرداخت → Alert با دلیل شکست")

	# ---------- 4) approval pending ----------
	so2, si2 = _make_so_si(company, customer, item, wh)
	created_sos.append(so2.name)
	si2.insert()
	created_sis.append(si2.name)
	frappe.db.set_value(
		"Sales Invoice",
		si2.name,
		"modified",
		frappe.utils.add_days(frappe.utils.nowdate(), -10),
		update_modified=False,
	)
	try:
		counts = notif.run(kinds=["approval_pending"])
		assert counts["approval_pending"] >= len(users), counts
		row = frappe.get_value(
			"Notification Log",
			{"document_type": "Sales Invoice", "document_name": si2.name, "type": "Alert"},
			"subject",
		)
		assert row and "در انتظار بررسی" in row, row
		results.append("PASS: approval_pending — پیش‌نویس ۱۰روزه → Alert")
	finally:
		_safe_remove_si(si2.name, submitted=False)
		_cleanup_notif_rows(None, [si2.name])

	# ---------- 5) SMS channel (recording provider) ----------
	# Pre-seed the dedupe ledger for ALL existing Verified rows (no SMS), so the
	# channel assertion below sees EXACTLY the one new event this test inserts.
	notif.run(kinds=["payment_received"], sms=False)

	from erpnext.farda_iran.sms import provider as sms_provider
	from erpnext.farda_iran.sms.provider import SendResult

	class _RecordingSMS:
		name = "recording"
		sent: list[tuple[str, str]] = []

		def send_sms(self, phone, message):
			type(self).sent.append((phone, message))
			return SendResult(ok=True, provider=self.name, message_id="REC-1")

	env_backup = {k: os.environ.get(k) for k in ("FARDA_SMS_PROVIDER", "FARDA_ALERT_SMS_NUMBERS")}
	try:
		sms_provider.register(_RecordingSMS())
		os.environ["FARDA_SMS_PROVIDER"] = "recording"
		os.environ["FARDA_ALERT_SMS_NUMBERS"] = "۰۹۱۲۰۰۰۰۰۰۱, +98 912 000 0002"

		frappe.get_doc(
			{
				"doctype": "Farda Payment Log",
				"authority": f"{PREFIX}-VER-002",
				"gateway": "zarinpal",
				"amount_irr": 900_000,
				"status": "Verified",
			}
		).insert(ignore_permissions=True)
		counts = notif.run(kinds=["payment_received"])
		assert counts["sms"] == 2, counts  # ONE new event × TWO recipients
		phones = {p for p, _ in _RecordingSMS.sent}
		assert phones == {"09120000001", "09120000002"}, phones  # fa-digits/+98 folded
		bodies = [m for _, m in _RecordingSMS.sent]
		assert all(b.startswith("[FardaERP] پرداخت تأیید شد: ") for b in bodies), bodies
		assert all("تأیید شد" in b for b in bodies), bodies

		# dedupe: same event again → no new SMS
		counts = notif.run(kinds=["payment_received"])
		assert counts["sms"] == 0 and len(_RecordingSMS.sent) == 2, (counts, _RecordingSMS.sent)
		results.append("PASS: SMS channel — گیرندگان env (ارقام فارسی/+98) + بدنهٔ [FardaERP] + dedupe")
	finally:
		for key, value in env_backup.items():
			if value is None:
				os.environ.pop(key, None)
			else:
				os.environ[key] = value
		sms_provider.register(sms_provider.ConsoleProvider())  # restore registry

	# ---------- 6) contract: full run, unknown kind, live hooks wiring ----------
	from erpnext.farda_iran.notifications.core import TRIGGER_KINDS

	counts = notif.run(kinds=list(TRIGGER_KINDS))
	assert set(counts) == {
		"cheque_due",
		"low_stock",
		"invoice_overdue",
		"payment_received",
		"payment_failed",
		"approval_pending",
		"sms",
	}, counts
	try:
		notif.run(kinds=["bogus"])
		raise AssertionError("unknown kind accepted")
	except ValueError:
		pass
	daily = (frappe.get_hooks("scheduler_events") or {}).get("daily") or []
	assert "erpnext.farda_iran.notifications.service.run" in daily, daily
	results.append("PASS: contract — run() همهٔ انواع + رد نوع ناشناخته + سیم‌کشی زندهٔ scheduler")

	# ---------- cleanup ----------
	try:
		_cleanup_payment_logs()
		_cleanup_notif_rows(bin_name, created_sis)
		for name in created_sos:
			if frappe.db.get_value("Sales Order", name, "docstatus") == 1:
				frappe.get_doc("Sales Order", name).cancel()
			frappe.delete_doc("Sales Order", name, force=True, ignore_permissions=True)
	except Exception:
		frappe.log_error(title="R20 cleanup", message=frappe.get_traceback())
	frappe.db.commit()

	return "\n".join(results) + f"\nR20: {len(results)}/6 PASS"
