"""Unit tests for the pure notification-trigger core (§33; no frappe needed)."""

import os
import sys
import unittest
from importlib.util import spec_from_file_location, module_from_spec

_CORE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "notifications", "core.py"))
_spec = spec_from_file_location("farda_notifications_core", _CORE_PATH)
core = module_from_spec(_spec)
sys.modules["farda_notifications_core"] = core
_spec.loader.exec_module(core)


class TestParseAlertNumbers(unittest.TestCase):
	def test_empty_and_none(self):
		self.assertEqual(core.parse_alert_numbers(None), [])
		self.assertEqual(core.parse_alert_numbers(""), [])
		self.assertEqual(core.parse_alert_numbers("   "), [])

	def test_mixed_forms_fold_and_dedupe(self):
		numbers = core.parse_alert_numbers("09121234567, +98 912 111 1111, ۰۹۱۲۱۲۳۴۵۶۷, 00989121234567")
		self.assertEqual(numbers, ["09121234567", "09121111111"])

	def test_invalid_entry_raises(self):
		with self.assertRaises(ValueError):
			core.parse_alert_numbers("09121234567, 12345")


class TestSmsText(unittest.TestCase):
	def test_label_and_truncation(self):
		text = core.sms_text("payment_received", "پرداخت X تأیید شد")
		self.assertTrue(text.startswith("[FardaERP] پرداخت تأیید شد: "))
		self.assertLessEqual(len(text), 160)
		long = core.sms_text("low_stock", "م" * 400)
		self.assertEqual(len(long), 160)

	def test_vocabulary_complete(self):
		self.assertEqual(set(core.TRIGGER_LABELS), set(core.TRIGGER_KINDS))


if __name__ == "__main__":
	unittest.main()
