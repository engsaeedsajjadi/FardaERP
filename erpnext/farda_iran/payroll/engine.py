"""Iranian payroll arithmetic (قانون کار + تأمین اجتماعی + مالیات حقوق). Pure stdlib.

All money is whole rials. Yearly figures come from `Rates` (stored per Jalali
year in «Farda Payroll Year», editable by the accountant); nothing is hard-coded
except the 1405 defaults used to seed that table.

Rules implemented (sources in docs/CORE-CHANGES.md, CORE-036):
- monthly wage = daily wage × days worked (31/30/29-day months are paid as such)
- پایه سنوات (daily) is paid like the wage
- کمک‌هزینه اقلام مصرفی، مسکن، حق تأهل: monthly amounts, prorated by
  days worked / days of the month
- حق اولاد: 3 × minimum daily wage per child per month, prorated the same way
- اضافه‌کاری: hours × (daily wage / 7.33) × 1.4; night work +35 %; holiday work +40 %
- insurance base = all insurable items (not حق اولاد), capped at
  7 × minimum daily wage × days; employee 7 %, employer 20 %, unemployment 3 %
- tax base = taxable earnings − 2/7 of the employee's insurance; monthly
  progressive table (1405: 40 m toman exempt, then 10/15/20/25/30 %)
- عیدی: 60 days' wage, max 90 days' minimum wage, prorated by days worked in
  the year; tax-exempt up to one month's exemption
- سنوات (end-of-service): 30 days' last wage per year of service, prorated
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal


def rial(value) -> int:
	return int(Decimal(str(value or 0)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


@dataclass
class Rates:
	year: int = 1405
	min_daily_wage: int = 5_541_850
	seniority_daily: int = 166_667  # پایه سنوات روزانه سال جاری (per year of service)
	grocery: int = 22_000_000  # کمک‌هزینه اقلام مصرفی خانوار (بن)
	housing: int = 9_000_000
	marriage: int = 5_000_000
	child_days: float = 3  # حق اولاد = ۳ روز حداقل مزد برای هر فرزند
	insurance_employee: float = 7
	insurance_employer: float = 20
	unemployment: float = 3
	insurance_cap_multiple: float = 7
	hours_per_day: float = 7.33
	overtime_factor: float = 1.4
	night_extra: float = 0.35
	holiday_factor: float = 1.4
	tax_insurance_exempt: float = 2 / 7
	# (upper bound of the slice in rial per month, rate %); None = no upper bound
	tax_brackets: list = field(
		default_factory=lambda: [
			(400_000_000, 0),
			(800_000_000, 10),
			(1_000_000_000, 15),
			(1_200_000_000, 20),
			(1_400_000_000, 25),
			(None, 30),
		]
	)
	eid_days: float = 60
	eid_cap_min_days: float = 90


@dataclass
class Employee:
	daily_wage: int  # مزد روزانه (حکم کارگزینی)
	days: float  # روزهای کارکرد این ماه
	month_days: int  # تعداد روزهای ماه جلالی (۲۹/۳۰/۳۱)
	seniority_daily: int = 0  # جمع پایه سنوات روزانه کارگر
	married: bool = False
	children: int = 0
	overtime_hours: float = 0
	night_hours: float = 0
	holiday_hours: float = 0
	# other earnings: (label, amount, insurable, taxable)
	other: list = field(default_factory=list)
	other_deductions: int = 0
	insured: bool = True
	housing: bool = True
	grocery: bool = True


def tax_for(taxable: int, brackets) -> int:
	"""Progressive monthly tax: each slice at its own rate."""
	tax, lower = Decimal(0), 0
	for upper, rate in brackets:
		top = taxable if upper is None else min(taxable, upper)
		if top > lower:
			tax += Decimal(top - lower) * Decimal(str(rate)) / 100
		if upper is None or taxable <= upper:
			break
		lower = upper
	return rial(tax)


def compute(emp: Employee, r: Rates) -> dict:
	share = Decimal(str(emp.days)) / Decimal(emp.month_days) if emp.month_days else Decimal(0)
	hour = Decimal(emp.daily_wage) / Decimal(str(r.hours_per_day))
	lines = []  # (key, label, amount, insurable, taxable)

	def add(key, label, amount, insurable=True, taxable=True):
		amount = rial(amount)
		if amount:
			lines.append((key, label, amount, insurable, taxable))

	add("base", "حقوق پایه", Decimal(emp.daily_wage) * Decimal(str(emp.days)))
	add("seniority", "پایه سنوات", Decimal(emp.seniority_daily) * Decimal(str(emp.days)))
	if emp.housing:
		add("housing", "حق مسکن", Decimal(r.housing) * share)
	if emp.grocery:
		add("grocery", "کمک‌هزینه اقلام مصرفی (بن)", Decimal(r.grocery) * share)
	if emp.married:
		add("marriage", "حق تأهل", Decimal(r.marriage) * share)
	if emp.children:
		child = Decimal(emp.children) * Decimal(str(r.child_days)) * Decimal(r.min_daily_wage) * share
		add("child", "حق اولاد", child, insurable=False)
	add("overtime", "اضافه‌کاری", Decimal(str(emp.overtime_hours)) * hour * Decimal(str(r.overtime_factor)))
	add("night", "نوبت‌کاری شب", Decimal(str(emp.night_hours)) * hour * Decimal(str(r.night_extra)))
	add("holiday", "تعطیل‌کاری", Decimal(str(emp.holiday_hours)) * hour * Decimal(str(r.holiday_factor)))
	for i, (label, amount, insurable, taxable) in enumerate(emp.other):
		add(f"other_{i}", label, amount, bool(insurable), bool(taxable))

	gross = sum(x[2] for x in lines)
	insurable = sum(x[2] for x in lines if x[3]) if emp.insured else 0
	cap = rial(Decimal(r.min_daily_wage) * Decimal(str(r.insurance_cap_multiple)) * Decimal(str(emp.days)))
	insurance_base = min(insurable, cap)
	ins_emp = rial(Decimal(insurance_base) * Decimal(str(r.insurance_employee)) / 100)
	ins_er = rial(Decimal(insurance_base) * Decimal(str(r.insurance_employer)) / 100)
	unemp = rial(Decimal(insurance_base) * Decimal(str(r.unemployment)) / 100)

	taxable_earnings = sum(x[2] for x in lines if x[4])
	tax_base = max(taxable_earnings - rial(Decimal(ins_emp) * Decimal(str(r.tax_insurance_exempt))), 0)
	tax = tax_for(tax_base, r.tax_brackets)

	deductions = ins_emp + tax + int(emp.other_deductions or 0)
	return {
		"lines": [{"key": k, "label": lbl, "amount": a, "insurable": i, "taxable": t} for k, lbl, a, i, t in lines],
		"gross": gross,
		"insurable": insurable,
		"insurance_cap": cap,
		"insurance_base": insurance_base,
		"insurance_employee": ins_emp,
		"insurance_employer": ins_er,
		"unemployment": unemp,
		"taxable": tax_base,
		"tax": tax,
		"deductions": deductions,
		"net": gross - deductions,
	}


def eid(daily_wage: int, days_worked_in_year: float, r: Rates, year_days: int = 365) -> dict:
	"""عیدی و پاداش پایان سال (قانون اصلاح ماده ۱۲۰): 60 days' wage, at most 90 days'
	minimum wage, prorated by days worked; tax-exempt up to one month's exemption."""
	full = min(Decimal(daily_wage) * Decimal(str(r.eid_days)), Decimal(r.min_daily_wage) * Decimal(str(r.eid_cap_min_days)))
	amount = rial(full * Decimal(str(days_worked_in_year)) / Decimal(year_days))
	exempt = min(amount, r.tax_brackets[0][0] or 0)
	return {"amount": amount, "tax_exempt": exempt, "taxable": amount - exempt}


def severance(last_daily_wage: int, years_of_service: float, days_per_year: float = 30) -> int:
	"""حق سنوات / پایان خدمت (ماده ۲۴ قانون کار): 30 days' last wage per year; tax-exempt."""
	return rial(Decimal(last_daily_wage) * Decimal(str(days_per_year)) * Decimal(str(years_of_service)))
