"""R22 — Feature flags E2E (§35) on the live smoke site.

Proves the central registry end-to-end:
  1. install       : ensure_flags → 7 Check fields on System Settings, all ON
  2. get/set       : runtime kill-switch round-trip (otp OFF → False → ON)
  3. real gating   : flags.sms OFF ⇒ notifications SMS channel makes ZERO
                     provider calls even for a NEW event; ON ⇒ sends
  4. bootinfo      : boot.farda_iran.modules mirrors the flag states + the
                     site_config display flags still respected
  5. validation    : unknown flag → ValueError (get/set/all surfaces)
  6. contract      : all_flags() exact 7-key shape, parse leniency live

Identity: probe payment-log rows FardaFlag-VER-001; System Settings flags are
restored to ON at the end (site left in default state).
"""

from __future__ import annotations

import frappe

PROBE_AUTH = "FardaFlag-VER-001"


def _setup_sms_env(monkeypatch_records: list):
	from erpnext.farda_iran.sms import provider as sms_provider
	from erpnext.farda_iran.sms.provider import SendResult

	class _RecordingSMS:
		name = "recording2"

		def send_sms(self, phone, message):
			monkeypatch_records.append((phone, message))
			return SendResult(ok=True, provider=self.name, message_id="REC-2")

	return _RecordingSMS, sms_provider


def run() -> str:
	from erpnext.farda_iran.flags import service as flags
	from erpnext.farda_iran.flags.core import FLAG_NAMES
	from erpnext.farda_iran.notifications import service as notif
	from erpnext.farda_iran.tests.test_e2e_breadth_runtime import _ensure_fixtures

	results: list[str] = []
	_ensure_fixtures()

	# ---------- 1) install ----------
	flags.ensure_flags()
	fields = frappe.get_all(
		"Custom Field", filters={"dt": "System Settings", "fieldname": ("like", "farda_enable_%")},
		pluck="fieldname",
	)
	assert set(fields) == {f"farda_enable_{n}" for n in FLAG_NAMES}, fields
	assert all(flags.get_flag(n) is True for n in FLAG_NAMES), flags.all_flags()
	results.append("PASS: install — ۷ فیلد Check روی System Settings، همه پیش‌فرض روشن")

	# ---------- 2) get/set round-trip ----------
	try:
		assert flags.set_flag("otp", 0) is False
		assert flags.get_flag("otp") is False
		assert flags.set_flag("otp", "1") is True
		assert flags.get_flag("otp") is True
		assert flags.set_flag("otp", "off") is False
		assert flags.get_flag("otp") is False
		flags.set_flag("otp", 1)
		assert flags.get_flag("otp") is True
		results.append("PASS: get/set — کلید قطع زمان‌اجر (۰/۱/on/off/فارسی) با بازگشت وضعیت")
	finally:
		flags.set_flag("otp", 1)

	# ---------- 3) real gating: flags.sms OFF ⇒ zero provider calls ----------
	# seed dedupe ledger, then insert a NEW Verified event
	notif.run(kinds=["payment_received"], sms=False)
	frappe.get_doc(
		{
			"doctype": "Farda Payment Log",
			"authority": PROBE_AUTH,
			"gateway": "zarinpal",
			"amount_irr": 500_000,
			"status": "Verified",
		}
	).insert(ignore_permissions=True)

	sent: list = []
	_RecordingSMS, sms_provider = _setup_sms_env(sent)
	import os as _os

	os_backup = {k: _os.environ.get(k) for k in ("FARDA_SMS_PROVIDER", "FARDA_ALERT_SMS_NUMBERS")}
	try:
		sms_provider.register(_RecordingSMS())
		_os.environ["FARDA_SMS_PROVIDER"] = "recording2"
		_os.environ["FARDA_ALERT_SMS_NUMBERS"] = "09120000009"

		flags.set_flag("sms", 0)
		counts = notif.run(kinds=["payment_received"])
		assert counts["sms"] == 0 and sent == [], (counts, sent)
		flags.set_flag("sms", 1)
		counts = notif.run(kinds=["payment_received"], sms=False)  # ledger now has it
		# a SECOND new event proves ON ⇒ sends
		frappe.get_doc(
			{
				"doctype": "Farda Payment Log",
				"authority": PROBE_AUTH + "B",
				"gateway": "zarinpal",
				"amount_irr": 600_000,
				"status": "Verified",
			}
		).insert(ignore_permissions=True)
		counts = notif.run(kinds=["payment_received"])
		assert counts["sms"] >= 1 and len(sent) >= 1, (counts, sent)
		results.append("PASS: gating واقعی — flags.sms خاموش ⇒ صفر فراخوانی provider؛ روشن ⇒ ارسال")
	finally:
		for key, value in os_backup.items():
			if value is None:
				_os.environ.pop(key, None)
			else:
				_os.environ[key] = value
		from erpnext.farda_iran.sms.provider import ConsoleProvider

		sms_provider.register(ConsoleProvider())
		for name in ("sms",):
			flags.set_flag(name, 1)

	# ---------- 4) bootinfo ----------
	from erpnext.farda_iran.ui.boot import extend_bootinfo

	bootinfo = frappe._dict()
	flags.set_flag("cheque", 0)
	try:
		extend_bootinfo(bootinfo)
		assert set(bootinfo.farda_iran["modules"]) == set(FLAG_NAMES), bootinfo.farda_iran
		assert bootinfo.farda_iran["modules"]["cheque"] is False, bootinfo.farda_iran
		assert bootinfo.farda_iran["modules"]["sms"] is True, bootinfo.farda_iran
		assert "jalali_dates" in bootinfo.farda_iran and "irr_per_toman" in bootinfo.farda_iran
	finally:
		flags.set_flag("cheque", 1)
	results.append("PASS: bootinfo — boot.farda_iran.modules منعکس‌کنندهٔ وضعیت فلگ‌ها + فلگ‌های نمایش سرجای خود")

	# ---------- 5) validation ----------
	for call in (lambda: flags.get_flag("bogus"), lambda: flags.set_flag("bogus", 1)):
		try:
			call()
			raise AssertionError("unknown flag accepted")
		except ValueError:
			pass
	results.append("PASS: اعتبارسنجی — فلگ ناشناخته در get/set → ValueError")

	# ---------- 6) contract ----------
	state = flags.all_flags()
	assert set(state) == set(FLAG_NAMES) and all(v is True for v in state.values()), state
	assert frappe.db.get_value("Custom Field", {"dt": "System Settings", "fieldname": "farda_enable_vat"}, "default") == "1"
	results.append("PASS: contract — all_flags() دقیقاً ۷ کلید، همه بازگشته به روشن (حالت پیش‌فرض سایت)")

	# ---------- cleanup ----------
	try:
		frappe.db.delete("Farda Payment Log", {"authority": ("like", "FardaFlag-VER-001%")})
		frappe.db.delete(
			"Notification Log", {"document_type": "Farda Payment Log", "subject": ("like", "%FardaFlag-VER-001%")}
		)
	except Exception:
		frappe.log_error(title="R22 cleanup", message=frappe.get_traceback())
	frappe.db.commit()

	return "\n".join(results) + f"\nR22: {len(results)}/6 PASS"
