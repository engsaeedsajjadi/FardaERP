"""Unit tests for the pure flag registry (§35; no frappe needed)."""

import os
import sys
import unittest
from importlib.util import module_from_spec, spec_from_file_location

_CORE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "flags", "core.py"))
_spec = spec_from_file_location("farda_flags_core", _CORE_PATH)
core = module_from_spec(_spec)
sys.modules["farda_flags_core"] = core
_spec.loader.exec_module(core)


class TestFlagCore(unittest.TestCase):
	def test_vocabulary_exact(self):
		self.assertEqual(
			core.FLAG_NAMES, ("sms", "otp", "payment", "vat", "banking", "cheque", "reports")
		)

	def test_field_names_and_unknown_rejected(self):
		self.assertEqual(core.field_name("sms"), "farda_enable_sms")
		self.assertEqual(core.field_name("reports"), "farda_enable_reports")
		with self.assertRaises(ValueError):
			core.field_name("bogus")

	def test_parse_forms(self):
		cases = [
			(None, True, True), ("", False, False),
			(True, True, True), (0, True, False), (1, True, True),
			("0", True, False), ("1", True, True), ("false", True, False),
			("on", True, True), ("OFF", True, False), ("۰", True, False), ("۱", True, True),
			("garbage", True, True), ("garbage", False, False),
		]
		for raw, default, expected in cases:
			self.assertEqual(core.parse_flag_value(raw, default), expected, (raw, default))


if __name__ == "__main__":
	unittest.main()
