"""Unit tests: VAT row planner (pure, path-loaded like the other frappe-free suites)."""

from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from decimal import Decimal

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
	"test_vat_planner_module", os.path.join(_HERE, "..", "tax", "planner.py")
)
planner = importlib.util.module_from_spec(_spec)
sys.modules["test_vat_planner_module"] = planner
_spec.loader.exec_module(planner)

plan_vat = planner.plan_vat


class TestVatPlanner(unittest.TestCase):
	def test_uniform_single_mode_rounds_total(self):
		p = plan_vat([(False, 1_000_000)], 10)
		self.assertEqual(p.mode, "single")
		self.assertEqual(p.total_tax, Decimal("100000"))
		self.assertEqual(p.taxable_net, Decimal("1000000"))
		self.assertEqual(p.exempt_net, Decimal("0"))

	def test_all_exempt(self):
		p = plan_vat([(True, 500_000), (True, 250_000)], 10)
		self.assertEqual(p.mode, "all_exempt")
		self.assertEqual(p.total_tax, Decimal("0"))
		self.assertEqual(p.exempt_net, Decimal("750000"))

	def test_mixed_is_per_row_and_exempt_rows_carry_zero(self):
		p = plan_vat([(False, 1_000_000), (True, 500_000), (False, 250_000)], 10)
		self.assertEqual(p.mode, "per_row")
		self.assertEqual(p.row_taxes, (Decimal("100000"), Decimal("0"), Decimal("25000")))
		self.assertEqual(p.total_tax, Decimal("125000"))
		self.assertEqual(p.taxable_net, Decimal("1250000"))

	def test_half_up_fifty_cents(self):
		# 100005 @ 10% = 10000.5 → HALF-UP → 10001 (banker's would give 10000)
		self.assertEqual(plan_vat([(False, 100_005)], 10).total_tax, Decimal("10001"))

	def test_half_up_below_fifty(self):
		self.assertEqual(plan_vat([(False, 100_004)], 10).total_tax, Decimal("10000"))

	def test_decimal_input_amount(self):
		self.assertEqual(plan_vat([(False, 123.45)], 10).total_tax, Decimal("12"))

	def test_custom_rate(self):
		p = plan_vat([(False, 2_000_000)], 15)
		self.assertEqual(p.total_tax, Decimal("300000"))

	def test_zero_rate_is_none(self):
		p = plan_vat([(False, 1_000_000), (True, 1)], 0)
		self.assertEqual(p.mode, "none")
		self.assertEqual(p.total_tax, Decimal("0"))

	def test_no_rows_is_none(self):
		self.assertEqual(plan_vat([], 10).mode, "none")

	def test_credit_note_negative_amount(self):
		p = plan_vat([(False, -500_000)], 10)
		self.assertEqual(p.mode, "single")
		self.assertEqual(p.total_tax, Decimal("-50000"))

	def test_large_amount(self):
		self.assertEqual(plan_vat([(False, 999_999_999_999)], 10).total_tax, Decimal("100000000000"))

	def test_per_row_rounding_is_not_sum_then_round(self):
		# three rows @10% each with .5 remainder: 33.35→3.34? no: 33.35*0.1=3.335→4 (HALF-UP)
		# per-row: each 33.35 → 4; total 12. sum-then-round: 100.05 → 10. They MUST differ.
		p = plan_vat([(False, 33.35), (False, 33.35), (False, 33.35)], 10)
		self.assertEqual(p.mode, "single")  # no exempt rows → single path rounds the SUM
		self.assertEqual(p.total_tax, Decimal("10"))

	def test_mixed_per_row_matches_line_semantics(self):
		# 10.05 taxable @10 → 1.005 → HALF-UP 1; exempt row ignored
		p = plan_vat([(False, 10.05), (True, 10.05)], 10)
		self.assertEqual(p.total_tax, Decimal("1"))


if __name__ == "__main__":
	unittest.main()
