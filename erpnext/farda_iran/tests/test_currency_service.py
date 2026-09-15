"""Unit tests for the FardaERP monetary (IRR/Toman) service — stdlib only.

    PYTHONPATH=<repo>/erpnext python -m unittest erpnext.farda_iran.tests.test_currency_service
"""

import decimal
import os
import sys
import unittest
from decimal import Decimal

# Standalone-run bootstrap: make `farda_iran` importable as a top-level
# package, then drop the path again (erpnext/ contains modules like `gettext`
# that must never shadow the stdlib).
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_ADDED_PATH = _ROOT not in sys.path
if _ADDED_PATH:
	sys.path.insert(0, _ROOT)

from farda_iran import currency

if _ADDED_PATH:
	sys.path.remove(_ROOT)


class TestCoreRatio(unittest.TestCase):
	def test_ratio_constant(self):
		self.assertEqual(currency.IRR_PER_TOMAN, Decimal(10))

	def test_one_toman_is_ten_rials(self):
		self.assertEqual(currency.toman_to_irr(1), Decimal(10))

	def test_hundred_toman_is_thousand_rials(self):
		self.assertEqual(currency.toman_to_irr(100), Decimal(1000))

	def test_fractional_toman(self):
		self.assertEqual(currency.toman_to_irr("0.5"), Decimal(5))
		self.assertEqual(currency.toman_to_irr(Decimal("0.1")), Decimal(1))


class TestConversions(unittest.TestCase):
	def test_irr_to_toman_exact(self):
		self.assertEqual(currency.irr_to_toman(10), Decimal(1))
		self.assertEqual(currency.irr_to_toman(15), Decimal("1.5"))
		self.assertEqual(currency.irr_to_toman(1_000_000), Decimal("100000"))

	def test_irr_to_toman_rounded_display(self):
		self.assertEqual(currency.irr_to_toman_rounded(15), 2)  # HALF_UP
		self.assertEqual(currency.irr_to_toman_rounded(14), 1)
		self.assertEqual(currency.irr_to_toman_rounded(1_000_004), 100_000)
		self.assertEqual(currency.irr_to_toman_rounded(1_000_005), 100_001)

	def test_negative_values(self):
		self.assertEqual(currency.toman_to_irr(-25), Decimal(-250))
		self.assertEqual(currency.irr_to_toman(-250), Decimal(-25))
		self.assertEqual(currency.irr_to_toman_rounded(-15), -2)

	def test_large_values(self):
		big = 10**15
		self.assertEqual(currency.toman_to_irr(big), Decimal(10**16))
		self.assertEqual(currency.irr_to_toman(10**16), Decimal(10**15))

	def test_double_conversion_is_identity(self):
		for amount in (0, 1, 7, 12345, 999_999_999_999):
			self.assertEqual(currency.irr_to_toman(currency.toman_to_irr(amount)), Decimal(amount))

	def test_float_input_coerced_via_repr(self):
		self.assertEqual(currency.toman_to_irr(100.25), Decimal("1002.5"))

	def test_rejects_bad_input(self):
		for bad in (None, [100], {"a": 1}, float("nan"), float("inf"), float("-inf")):
			with self.assertRaises((TypeError, ValueError)):
				currency.toman_to_irr(bad)


class TestStoragePolicy(unittest.TestCase):
	def test_integral_rials_enforced(self):
		self.assertEqual(currency.assert_integral_irr(150_000), Decimal(150_000))
		with self.assertRaises(ValueError):
			currency.assert_integral_irr("1000.5")  # half a Rial is not storable


class TestFormatting(unittest.TestCase):
	def test_format_toman_thousands(self):
		self.assertEqual(currency.format_toman(1234567.8), "1,234,567.8")
		self.assertEqual(currency.format_toman(1_000_000), "1,000,000")

	def test_format_from_irr(self):
		self.assertEqual(currency.format_irr_as_toman(12_345_678), "1,234,567.8")
		self.assertEqual(currency.format_irr_as_toman(1_000_000, with_unit=True), "100,000 تومان")

	def test_format_persian_digits(self):
		self.assertEqual(currency.format_irr_as_toman(1_000_000, persian_digits=True), "۱۰۰,۰۰۰")

	def test_vat_sample_arithmetic(self):
		# illustrative end-to-end arithmetic the VAT module will reuse:
		# subtotal 1,000,000 IRR, 10% tax, all in integral Rials
		subtotal = currency.assert_integral_irr(1_000_000)
		rate = Decimal("0.10")
		tax = int((subtotal * rate).quantize(Decimal("1"), rounding=decimal.ROUND_HALF_UP))
		self.assertEqual(tax, 100_000)
		self.assertEqual(currency.assert_integral_irr(subtotal + tax), Decimal(1_100_000))
		self.assertEqual(currency.format_irr_as_toman(subtotal + tax), "110,000")


if __name__ == "__main__":
	unittest.main()
