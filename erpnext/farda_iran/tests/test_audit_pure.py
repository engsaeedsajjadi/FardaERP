"""Frappe-free unit tests for the §24 audit sanitizer (redaction rules)."""

import importlib.util
import json
import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
_ADDED = _ROOT not in sys.path
if _ADDED:
	sys.path.insert(0, _ROOT)

_spec = importlib.util.spec_from_file_location(
	"farda_audit_service_test",
	os.path.join(_ROOT, "erpnext", "farda_iran", "audit", "service.py"),
)
# service.py imports frappe — patch a tiny stub for the pure functions
import types

_frappe_stub = types.ModuleType("frappe")
_frappe_stub._ = lambda s: s
sys.modules.setdefault("frappe", _frappe_stub)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

if _ADDED:
	sys.path.remove(_ROOT)


class TestAuditRedaction(unittest.TestCase):
	def test_secret_keys_fully_redacted(self):
		for key in ("password", "api_secret", "merchant_id", "otp_code", "auth_header", "code_hash", "api_key"):
			self.assertEqual(_mod.redact_value(key, "TOPSECRET-VALUE"), "***", key)

	def test_identity_keys_masked_to_last4(self):
		out = _mod.redact_value("farda_national_id", "0012345678")
		self.assertEqual(out, "…5678")
		self.assertNotIn("001234", out)
		self.assertEqual(_mod.redact_value("iban", "IR200170000000000123456789"), "…6789")
		self.assertEqual(_mod.redact_value("farda_card_number", "6037991234567890"), "…7890")
		# short identity values fully masked (no last-4 leak)
		self.assertEqual(_mod.redact_value("farda_national_id", "123"), "***")

	def test_plain_keys_pass_through(self):
		self.assertEqual(_mod.redact_value("status", "Deposited"), "Deposited")
		self.assertEqual(_mod.redact_value("default_rate", 12.5), "12.5")
		self.assertIsNone(_mod.redact_value("status", None))

	def test_redact_json_old_new_pairs(self):
		out = json.loads(_mod.redact_json({
			"status": ("Received", "Deposited"),
			"farda_national_id": ("0012345678", "0098765432"),
			"otp_code": ("12345", "12345"),
		}))
		self.assertEqual(out["status"], ["Received", "Deposited"])
		self.assertEqual(out["farda_national_id"], ["…5678", "…5432"])
		self.assertEqual(out["otp_code"], ["***", "***"])

	def test_redact_json_flat_and_unicode(self):
		out = json.loads(_mod.redact_json({"details": "وضعیت: وصول شده"}))
		self.assertEqual(out["details"], "وضعیت: وصول شده")

	def test_key_regex_is_case_insensitive(self):
		self.assertEqual(_mod.redact_value("MERCHANT_ID", "xyz"), "***")
		self.assertEqual(_mod.redact_value("IBAN", "IR001234"), "…1234")


if __name__ == "__main__":
	unittest.main()
