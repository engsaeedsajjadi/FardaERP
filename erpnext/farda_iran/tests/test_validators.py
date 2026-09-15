"""Unit tests for Iranian identifier validators — stdlib only.

    python erpnext/farda_iran/tests/run_unit_tests.py
"""

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

from farda_iran.utilities import validators

if _ADDED_PATH:
	sys.path.remove(_ROOT)


class TestNationalID(unittest.TestCase):
	# Vectors: '0499370899' is a widely published valid example; the second was
	# generated independently from the official weights algorithm.
	VALID = ("0499370899", "0451234561", "0499370899".rjust(10, "0"))

	def test_valid(self):
		for code in self.VALID:
			self.assertTrue(validators.is_valid_national_id(code), code)

	def test_8_digit_code_zero_padded(self):
		# official practice: 8-digit codes are zero-padded to 10
		self.assertTrue(validators.is_valid_national_id("499370899"))

	def test_bad_check_digit(self):
		self.assertFalse(validators.is_valid_national_id("0499370890"))

	def test_repeated_digits_rejected(self):
		for code in ("0000000000", "1111111111", "9999999999"):
			self.assertFalse(validators.is_valid_national_id(code), code)

	def test_wrong_length(self):
		self.assertFalse(validators.is_valid_national_id("12345"))
		self.assertFalse(validators.is_valid_national_id("12345678901"))

	def test_non_digits(self):
		self.assertFalse(validators.is_valid_national_id("12345abcde"))

	def test_persian_digits_accepted(self):
		self.assertTrue(validators.is_valid_national_id("۰۴۹۹۳۷۰۸۹۹"))

	def test_known_invalid(self):
		self.assertFalse(validators.is_valid_national_id("1234567890"))


class TestLegalNationalID(unittest.TestCase):
	# Vector generated independently from the official algorithm (11 digits).
	VALID = ("24005678907",)

	def test_valid(self):
		for code in self.VALID:
			self.assertTrue(validators.is_valid_legal_national_id(code), code)

	def test_bad_check_digit(self):
		self.assertFalse(validators.is_valid_legal_national_id("24005678900"))

	def test_wrong_length(self):
		self.assertFalse(validators.is_valid_legal_national_id("1234567890"))
		self.assertFalse(validators.is_valid_legal_national_id("123456789012"))

	def test_repeated_digits_rejected(self):
		self.assertFalse(validators.is_valid_legal_national_id("11111111111"))


class TestIRIBAN(unittest.TestCase):
	# Vector: 26 chars (IR + 2 check + 22 BBAN), check computed via MOD-97 (=1).
	VALID = ("IR200170000000000123456789",)

	def test_valid(self):
		for iban in self.VALID:
			self.assertTrue(validators.is_valid_iriban(iban), iban)

	def test_single_bad_digit_fails(self):
		self.assertFalse(validators.is_valid_iriban("IR210170000000000123456789"))

	def test_wrong_length(self):
		self.assertFalse(validators.is_valid_iriban("IR2001700000000001234567"))
		self.assertFalse(validators.is_valid_iriban("IR20017000000000012345678901"))

	def test_lowercase_accepted(self):
		self.assertTrue(validators.is_valid_iriban("ir200170000000000123456789"))

	def test_non_ir_country_rejected_by_shape(self):
		self.assertFalse(validators.is_valid_iriban("DE89370400440532013000"))


class TestPostalCode(unittest.TestCase):
	def test_valid(self):
		self.assertTrue(validators.is_valid_postal_code("1234567890"))
		self.assertTrue(validators.is_valid_postal_code("1968743512"))

	def test_leading_zero_rejected(self):
		self.assertFalse(validators.is_valid_postal_code("0123456789"))

	def test_all_same_rejected(self):
		self.assertFalse(validators.is_valid_postal_code("1111111111"))

	def test_wrong_length(self):
		self.assertFalse(validators.is_valid_postal_code("123456789"))
		self.assertFalse(validators.is_valid_postal_code("12345678901"))


class TestEconomicCode(unittest.TestCase):
	def test_valid_12_digit(self):
		self.assertTrue(validators.is_valid_economic_code("411366512345"))

	def test_valid_legacy_short(self):
		self.assertTrue(validators.is_valid_economic_code("4113"))

	def test_too_short(self):
		self.assertFalse(validators.is_valid_economic_code("123"))

	def test_too_long(self):
		self.assertFalse(validators.is_valid_economic_code("1234567890123456"))

	def test_all_same_rejected(self):
		self.assertFalse(validators.is_valid_economic_code("4444"))


class TestNormalizationBridge(unittest.TestCase):
	def test_separators_tolerated(self):
		self.assertTrue(validators.is_valid_national_id("0499370899"))
		self.assertTrue(validators.is_valid_iriban("IR20 0170 0000 0000 0123 456 789".replace(" ", "")))


if __name__ == "__main__":
	unittest.main()
