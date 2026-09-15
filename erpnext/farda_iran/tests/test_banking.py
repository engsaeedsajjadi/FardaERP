"""Unit tests for Iranian banking utilities — stdlib only."""

import os
import sys
import unittest

# Standalone-run bootstrap: make `farda_iran` importable as a top-level
# package, then drop the path again (erpnext/ contains modules like `gettext`
# that must never shadow the stdlib).
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_ADDED_PATH = _ROOT not in sys.path
if _ADDED_PATH:
	sys.path.insert(0, _ROOT)

from farda_iran import banking

if _ADDED_PATH:
	sys.path.remove(_ROOT)

VALID_IBAN = "IR200170000000000123456789"  # verified MOD-97 vector (bank 017)


class TestBankFromIBAN(unittest.TestCase):
	def test_bank_code_extracted(self):
		self.assertEqual(banking.bank_code_from_iban(VALID_IBAN), "017")

	def test_bank_name(self):
		self.assertEqual(banking.bank_name_from_iban(VALID_IBAN), "بانک ملی ایران")

	def test_unknown_code_returns_none_name(self):
		# syntactically valid MOD-97 IBAN whose 3-digit code is NOT in the registry
		import farda_iran.utilities.validators as v
		bban = "999" + "1700000000012345678"  # 24 digits with code 999
		cd = 98 - (int(bban + "1827" + "00") % 97)
		iban = f"IR{cd:02d}{bban}"
		self.assertTrue(v.is_valid_iriban(iban))
		self.assertIsNone(banking.bank_name_from_iban(iban))
		self.assertEqual(banking.iban_bank_info(iban), {"bank_code": "999"})

	def test_invalid_iban_no_bank(self):
		self.assertEqual(banking.iban_bank_info("IR200170000000000123456788"), {})
		self.assertEqual(banking.bank_name_from_iban("nonsense"), None)

	def test_registry_covers_majors(self):
		for code in ("011", "012", "013", "014", "015", "017", "018", "054", "056", "057", "062"):
			self.assertIn(code, banking.IRANIAN_BANK_CODES)


class TestCardNumber(unittest.TestCase):
	def test_luhn_valid(self):
		# universally used Luhn-valid test PAN
		self.assertTrue(banking.is_valid_card_number("4111111111111111"))

	def test_luhn_invalid(self):
		self.assertFalse(banking.is_valid_card_number("4111111111111112"))

	def test_wrong_length(self):
		self.assertFalse(banking.is_valid_card_number("41111111111111"))

	def test_persian_digits_folded(self):
		self.assertTrue(banking.is_valid_card_number("۴۱۱۱۱۱۱۱۱۱۱۱۱۱۱۱"))

	def test_spaces_tolerated(self):
		self.assertTrue(banking.is_valid_card_number("4111 1111 1111 1111"))


if __name__ == "__main__":
	unittest.main()
