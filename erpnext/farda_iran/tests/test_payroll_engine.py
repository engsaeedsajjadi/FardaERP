"""Unit tests: Iranian payroll engine 1405 (frappe-free)."""

import unittest

try:
	from farda_iran.payroll import engine as e
except ImportError:
	from erpnext.farda_iran.payroll import engine as e

R = e.Rates()


class PayrollEngineTests(unittest.TestCase):
	def test_minimum_wage_worker_1405(self):
		# 30-day month, single, no children: 30 × 5,541,850 + bon + housing
		x = e.compute(e.Employee(daily_wage=R.min_daily_wage, days=30, month_days=30), R)
		items = {l["key"]: l["amount"] for l in x["lines"]}
		self.assertEqual(items["base"], 166_255_500)
		self.assertEqual(items["grocery"], 22_000_000)
		self.assertEqual(items["housing"], 9_000_000)
		self.assertEqual(x["gross"], 197_255_500)
		self.assertEqual(x["insurance_employee"], 13_807_885)  # 7 %
		self.assertEqual(x["insurance_employer"], 39_451_100)  # 20 %
		self.assertEqual(x["unemployment"], 5_917_665)  # 3 %
		self.assertEqual(x["tax"], 0)  # below 400 m rial exemption
		self.assertEqual(x["net"], 197_255_500 - 13_807_885)

	def test_child_allowance_not_insurable(self):
		x = e.compute(e.Employee(daily_wage=R.min_daily_wage, days=31, month_days=31, married=True, children=2), R)
		items = {l["key"]: l["amount"] for l in x["lines"]}
		self.assertEqual(items["child"], 2 * 3 * R.min_daily_wage)  # 33,251,100
		self.assertEqual(items["marriage"], 5_000_000)
		self.assertEqual(x["insurable"], x["gross"] - items["child"])

	def test_partial_month_prorates_allowances(self):
		x = e.compute(e.Employee(daily_wage=R.min_daily_wage, days=15, month_days=30), R)
		items = {l["key"]: l["amount"] for l in x["lines"]}
		self.assertEqual(items["housing"], 4_500_000)
		self.assertEqual(items["grocery"], 11_000_000)

	def test_insurance_ceiling(self):
		x = e.compute(e.Employee(daily_wage=60_000_000, days=30, month_days=30), R)
		self.assertEqual(x["insurance_base"], 7 * R.min_daily_wage * 30)
		self.assertEqual(x["insurance_employee"], round(7 * R.min_daily_wage * 30 * 0.07))

	def test_progressive_tax_published_example(self):
		# 90 m toman taxable -> 5.5 m toman (40 exempt, 40 × 10 %, 10 × 15 %)
		self.assertEqual(e.tax_for(900_000_000, R.tax_brackets), 55_000_000)
		self.assertEqual(e.tax_for(400_000_000, R.tax_brackets), 0)
		self.assertEqual(e.tax_for(2_000_000_000, R.tax_brackets), 40_000_000 + 30_000_000 + 40_000_000 + 50_000_000 + 180_000_000)

	def test_tax_uses_two_sevenths_insurance_exemption(self):
		x = e.compute(e.Employee(daily_wage=20_000_000, days=30, month_days=30), R)
		self.assertEqual(x["taxable"], x["gross"] - round(x["insurance_employee"] * 2 / 7))
		self.assertEqual(x["tax"], e.tax_for(x["taxable"], R.tax_brackets))

	def test_overtime(self):
		x = e.compute(e.Employee(daily_wage=R.min_daily_wage, days=30, month_days=30, overtime_hours=10), R)
		items = {l["key"]: l["amount"] for l in x["lines"]}
		self.assertEqual(items["overtime"], round(R.min_daily_wage / 7.33 * 1.4 * 10))

	def test_other_items_flags(self):
		x = e.compute(e.Employee(daily_wage=R.min_daily_wage, days=30, month_days=30, other=[("پاداش", 10_000_000, 0, 1)]), R)
		self.assertEqual(x["insurable"], x["gross"] - 10_000_000)

	def test_eid_and_severance(self):
		full = e.eid(R.min_daily_wage, 365, R)
		self.assertEqual(full["amount"], 60 * R.min_daily_wage)
		capped = e.eid(30_000_000, 365, R)
		self.assertEqual(capped["amount"], 90 * R.min_daily_wage)
		self.assertEqual(e.severance(R.min_daily_wage, 2), 60 * R.min_daily_wage)


if __name__ == "__main__":
	unittest.main()
