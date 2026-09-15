"""Whitelisted conversion endpoints (Jalali + IRR/Toman)."""

from __future__ import annotations

import datetime

import frappe
from erpnext.farda_iran.api.limiter import is_allowed
from frappe import _

RATE_LIMIT = 120          # hits
RATE_WINDOW = 60          # seconds, per user per bucket


def _throttle(bucket: str) -> None:
	if not is_allowed(bucket, frappe.session.user, RATE_LIMIT, RATE_WINDOW):
		frappe.throw(_("تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید."), frappe.RateLimitExceededError)


# ---------------- Jalali ----------------


@frappe.whitelist(methods=["GET", "POST"])
def to_jalali(date: str | None = None, persian_digits: bool = False, month_name: bool = False) -> dict:
	"""Gregorian ISO (or date) -> Jalali components + formatted strings."""
	_throttle("jalali")
	from erpnext.farda_iran.jalali import service as svc

	value = date or frappe.utils.nowdate()
	jy, jm, jd = svc.date_to_jalali(value)
	return {
		"jy": jy,
		"jm": jm,
		"jd": jd,
		"formatted": svc.format_jalali(frappe.utils.getdate(value)),
		"formatted_persian_digits": svc.format_jalali(frappe.utils.getdate(value), persian_digits=True),
		"month_name": svc.jalali_month_name(jm),
		"month_name_display": svc.format_jalali(frappe.utils.getdate(value), month_name=month_name or True),
	}


@frappe.whitelist(methods=["GET", "POST"])
def to_gregorian(jy: int, jm: int, jd: int) -> dict:
	"""Jalali components -> Gregorian ISO date."""
	_throttle("jalali")
	from erpnext.farda_iran.jalali import service as svc

	g = svc.jalali_to_date(int(jy), int(jm), int(jd))
	return {"gregorian": g.isoformat(), "weekday": g.strftime("%A")}


# ---------------- Currency ----------------


@frappe.whitelist(methods=["GET", "POST"])
def toman_to_irr(toman) -> dict:
	_throttle("currency")
	from erpnext.farda_iran.currency import service as svc

	return {"irr": str(svc.toman_to_irr(toman))}


@frappe.whitelist(methods=["GET", "POST"])
def irr_to_toman(irr) -> dict:
	_throttle("currency")
	from erpnext.farda_iran.currency import service as svc

	return {"toman": str(svc.irr_to_toman(irr)), "toman_rounded": svc.irr_to_toman_rounded(irr)}


@frappe.whitelist(methods=["GET", "POST"])
def format_money(irr, persian_digits: bool = False, with_unit: bool = True) -> dict:
	_throttle("currency")
	from erpnext.farda_iran.currency import service as svc

	return {
		"toman": svc.format_irr_as_toman(irr, persian_digits=bool(persian_digits), with_unit=bool(with_unit)),
		"irr": str(svc.assert_integral_irr(irr)),
	}
