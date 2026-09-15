"""FardaERP monetary service — the ONLY place where IRR <-> Toman exists.

Policy (never re-implement elsewhere):
- Accounting backend currency: **IRR** (Rial). All stored money is integral Rials.
- User-facing display currency: **Toman**.
- 1 Toman = 10 IRR. The ratio lives HERE and only here; overridable per site
  via `site_config.json` key `farda_iran_irr_per_toman` (no code change).

Pure Python core; frappe is optional (only consulted for the site override).
"""

from __future__ import annotations

import decimal
from decimal import Decimal

__all__ = [
	"IRR_PER_TOMAN",
	"get_irr_per_toman",
	"to_decimal",
	"toman_to_irr",
	"irr_to_toman",
	"irr_to_toman_rounded",
	"assert_integral_irr",
	"format_toman",
	"format_irr_as_toman",
]

# Single source of truth. 1 Toman = 10 IRR.
IRR_PER_TOMAN: Decimal = Decimal(10)

_ALLOWED = (int, Decimal, str)


def get_irr_per_toman() -> Decimal:
	"""Ratio IRR per Toman. Site config override > module constant."""
	try:
		import frappe

		value = frappe.get_conf().get("farda_iran_irr_per_toman") if frappe.local.site else None
		if value:
			ratio = Decimal(str(value))
			if ratio <= 0:
				raise ValueError("farda_iran_irr_per_toman must be positive")
			return ratio
	except Exception:
		pass  # running outside a frappe site — use the constant
	return IRR_PER_TOMAN


def to_decimal(value) -> Decimal:
	"""Strict money coercion: int/Decimal/str only; float via repr to avoid
	binary noise; NaN/Infinity rejected outright."""
	if isinstance(value, float):
		if value != value or value in (float("inf"), float("-inf")):
			raise ValueError(f"non-finite money value: {value!r}")
		value = repr(value)
	if not isinstance(value, _ALLOWED):
		raise TypeError(f"money value must be int/Decimal/str, got {type(value).__name__}")
	d = Decimal(value)
	if not d.is_finite():
		raise ValueError(f"non-finite money value: {value!r}")
	return d


def toman_to_irr(toman) -> Decimal:
	"""Toman -> Rial (exact multiply). Accepts fractional Toman (0.1T = 1R)."""
	return to_decimal(toman) * get_irr_per_toman()


def irr_to_toman(irr) -> Decimal:
	"""Rial -> Toman (exact; may carry one decimal, e.g. 15 R = 1.5 T)."""
	return to_decimal(irr) / get_irr_per_toman()


def irr_to_toman_rounded(irr) -> int:
	"""Rial -> whole Toman for display, ROUND_HALF_UP (15R -> 2T, 14R -> 1T)."""
	return int(irr_to_toman(irr).quantize(Decimal("1"), rounding=decimal.ROUND_HALF_UP))


def assert_integral_irr(irr) -> Decimal:
	"""Money stored in IRR must be whole Rials — raise otherwise."""
	d = to_decimal(irr)
	if d != d.to_integral_value():
		raise ValueError(f"IRR amounts must be whole Rials, got {irr!r}")
	return d


def format_toman(toman, persian_digits: bool = False, with_unit: bool = False) -> str:
	"""Human Toman formatting with thousands separators ('1,234,567.8')."""
	d = to_decimal(toman).normalize()
	if d == d.to_integral_value():
		d = d.quantize(Decimal("1"))
	text = f"{d:,}"
	if with_unit:
		text += " تومان"
	if persian_digits:
		text = text.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
	return text


def format_irr_as_toman(irr, persian_digits: bool = False, with_unit: bool = False) -> str:
	"""Convenience: format a stored IRR amount directly for the Toman UI."""
	return format_toman(irr_to_toman(irr), persian_digits=persian_digits, with_unit=with_unit)
