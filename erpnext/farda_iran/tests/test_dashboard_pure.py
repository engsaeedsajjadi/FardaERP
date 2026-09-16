"""Unit tests: KPI payload builder (pure — §18 composition layer)."""

from __future__ import annotations

import os
import sys
import unittest
import importlib.util

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
	"test_dashboard_pure_module",
	os.path.join(_HERE, "..", "dashboard", "kpis_pure.py"),
)
mod = importlib.util.module_from_spec(_spec)
sys.modules["test_dashboard_pure_module"] = mod
_spec.loader.exec_module(mod)

build = mod.build_kpi_payload


class TestKpiPayload(unittest.TestCase):
	def test_full_payload_shapes_and_labels(self):
		out = build({
			"sales": 1_375_000, "purchases": 880_000,
			"receivables": 600_000, "payables": 880_000,
			"vat_sales": 125_000, "vat_purchases": 80_000,
			"cash_balance": 2_000_000, "inventory_value": 5_000_000,
			"orders": 3_000_000,
		})
		self.assertEqual(out["currency"], "Toman")
		self.assertEqual(out["sales"]["label_fa"], "فروش")
		self.assertEqual(out["sales"]["toman_fa"], "۱۳۷٬۵۰۰ تومان")  # 1,375,000 IRR
		self.assertEqual(out["purchases"]["toman_fa"], "۸۸٬۰۰۰ تومان")
		self.assertEqual(out["profit"]["irr"], 495_000)
		self.assertEqual(out["profit"]["toman_fa"], "۴۹٬۵۰۰ تومان")
		self.assertEqual(out["net_ar_ap"]["irr"], -280_000)  # 600k - 880k
		self.assertEqual(out["net_ar_ap"]["toman_fa"], "-۲۸٬۰۰۰ تومان")
		self.assertEqual(out["vat_net"]["irr"], 45_000)
		self.assertEqual(out["vat_net"]["toman_fa"], "۴٬۵۰۰ تومان")
		self.assertEqual(out["inventory_value"]["toman_fa"], "۵۰۰٬۰۰۰ تومان")

	def test_none_and_missing_treated_as_zero(self):
		out = build({})
		for key in ("sales", "receivables", "vat_net"):
			self.assertEqual(out[key]["irr"], 0)
		self.assertEqual(out["cash_balance"]["toman_fa"], "۰ تومان")

	def test_ratio_only_via_central_service(self):
		"""IRR→Toman must match the central service exactly."""
		try:
			from farda_iran.invoice.persian import toman_str
		except ImportError:
			from erpnext.farda_iran.invoice.persian import toman_str

		raw = {"sales": 123_456_789}
		out = build(raw)
		self.assertEqual(out["sales"]["toman_fa"], toman_str(123_456_789, persian_digits=True, with_unit=True))


if __name__ == "__main__":
	unittest.main()
