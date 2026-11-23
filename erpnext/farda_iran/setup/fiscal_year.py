"""Jalali fiscal-year names (CORE-050).

ERPNext's setup wizard names a fiscal year after its Gregorian years
("2026-2027"). Iranian books say «سال مالی ۱۴۰۵». After the setup wizard of a
Persian site, fiscal years still carrying such a Gregorian name are renamed to
their Jalali year ("1405", or "1405-1406" for a year that is not Farvardin–
Esfand), with frappe.rename_doc so every link (Global Defaults, companies,
budgets…) follows. Existing sites are never renamed behind the user's back;
`rename_existing()` is available for an admin to run on purpose.
"""

from __future__ import annotations

import re

_GREG = re.compile(r"^(?:19|20)\d{2}(?:-(?:19|20)\d{2})?$")


def jalali_fy_name(start, end) -> str:
	try:
		from ..jalali.service import date_to_jalali
	except ImportError:  # pragma: no cover
		from farda_iran.jalali.service import date_to_jalali
	a = date_to_jalali(start)[0]
	b = date_to_jalali(end)[0]
	return str(a) if a == b else f"{a}-{b}"


def is_gregorian_name(name: str) -> bool:
	return bool(_GREG.match((name or "").strip()))


def _persian_site() -> bool:
	import frappe

	return (frappe.db.get_single_value("System Settings", "language") or "").startswith("fa")


def rename_existing() -> list[tuple[str, str]]:
	import frappe

	done = []
	for fy in frappe.get_all("Fiscal Year", fields=["name", "year_start_date", "year_end_date"]):
		if not is_gregorian_name(fy.name):
			continue
		new = jalali_fy_name(fy.year_start_date, fy.year_end_date)
		if new == fy.name or frappe.db.exists("Fiscal Year", new):
			continue
		frappe.rename_doc("Fiscal Year", fy.name, new, force=True, show_alert=False)
		done.append((fy.name, new))
	if done:
		frappe.db.commit()
	return done


def after_setup_wizard(args=None) -> None:
	"""setup_wizard_complete hook: Persian sites start with «1405», not «2026-2027»."""
	import frappe

	try:
		if _persian_site():
			rename_existing()
	except Exception:
		frappe.log_error("farda_iran: Jalali fiscal-year rename failed")  # never block setup
