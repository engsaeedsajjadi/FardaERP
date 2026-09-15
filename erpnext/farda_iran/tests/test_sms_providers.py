"""Unit tests for the SMS provider architecture (no network; console/registry)."""

import os
import sys
import unittest

# load provider.py by path: erpnext/__init__ needs frappe; provider.py is
# self-sufficient once `farda_iran` (imported by earlier test modules) is in
# sys.modules for its validators import.
import importlib.util

_PROVIDER_PATH = os.path.abspath(
	os.path.join(os.path.dirname(__file__), "..", "sms", "provider.py")
)
_spec = importlib.util.spec_from_file_location("farda_sms_provider", _PROVIDER_PATH)
sms = importlib.util.module_from_spec(_spec)
sys.modules["farda_sms_provider"] = sms
_spec.loader.exec_module(sms)


class TestNormalizeMobile(unittest.TestCase):
	def test_forms(self):
		self.assertEqual(sms.normalize_ir_mobile("09121234567"), "09121234567")
		self.assertEqual(sms.normalize_ir_mobile("+989121234567"), "09121234567")
		self.assertEqual(sms.normalize_ir_mobile("989121234567"), "09121234567")
		self.assertEqual(sms.normalize_ir_mobile("00989121234567"), "09121234567")
		self.assertEqual(sms.normalize_ir_mobile("۰۹۱۲۱۲۳۴۵۶۷"), "09121234567")

	def test_invalid_rejected(self):
		for bad in ("0912", "0912123", "2123456789", "08121234567", "abcdefghijk"):
			with self.assertRaises(ValueError):
				sms.normalize_ir_mobile(bad)


class TestConsoleProvider(unittest.TestCase):
	def test_send_ok(self):
		p = sms.ConsoleProvider()
		result = p.send_sms("09121234567", "سلام")
		self.assertTrue(result.ok)
		self.assertEqual(result.provider, "console")

	def test_template_render(self):
		p = sms.ConsoleProvider()
		result = p.send_template("09121234567", "کد {code} برای {purpose}", {"code": "123456", "purpose": "ورود"})
		self.assertTrue(result.ok)


class TestRegistry(unittest.TestCase):
	def test_available_contains_adapters(self):
		for name in ("console", "kavenegar", "melipayamak", "ghasedak"):
			self.assertIn(name, sms.available())

	def test_resolve_by_env(self):
		os.environ["FARDA_SMS_PROVIDER"] = "console"
		try:
			self.assertIsInstance(sms.resolve(), sms.ConsoleProvider)
		finally:
			del os.environ["FARDA_SMS_PROVIDER"]

	def test_resolve_unknown_raises(self):
		with self.assertRaises(ValueError):
			sms.resolve("does-not-exist")

	def test_credentials_coming_from_env_only(self):
		# constructing a real provider without env credentials must fail
		saved = os.environ.pop("KAVENEGAR_API_KEY", None)
		try:
			with self.assertRaises(ValueError):
				sms.KavenegarProvider()
		finally:
			if saved is not None:
				os.environ["KAVENEGAR_API_KEY"] = saved


class TestOtpTemplate(unittest.TestCase):
	def test_send_otp_message_shape(self):
		p = sms.ConsoleProvider()
		result = p.send_otp("09121234567", "918273", "ورود")
		self.assertTrue(result.ok)


if __name__ == "__main__":
	unittest.main()
