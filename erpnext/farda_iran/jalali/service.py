"""FardaERP Jalali (Solar Hijri) calendar service.

THE single conversion point for Gregorian <-> Jalali in FardaERP.
Database dates stay Gregorian (ISO) — this service owns all presentation-
layer conversion. Never scatter conversion logic elsewhere.

Algorithm: standard 33-year-cycle Jalali lattice (accurate ~1178..1633 AP),
anchored to the verified real date 2025-03-21 == 1404/01/01.

Pure Python — no frappe dependency, usable from bench, jobs and unit tests.
"""

from __future__ import annotations

import datetime
import re

__all__ = [
    "MONTH_NAMES_FA",
    "MONTH_NAMES_EN",
    "JALALI_EPOCH_ANCHOR",
    "is_jalali_leap",
    "jalali_month_length",
    "jalali_year_length",
    "date_to_jalali",
    "jalali_to_date",
    "format_jalali",
    "parse_jalali",
    "jalali_month_name",
    "jalali_today",
    "validate_jalali",
]

MONTH_NAMES_FA = (
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
)
MONTH_NAMES_EN = (
    "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
    "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand",
)

# Verified anchor: Nowruz 1404 == 2025-03-21 (Gregorian)
JALALI_EPOCH_ANCHOR = (1404, 1, 1)
_ANCHOR_GREGORIAN = datetime.date(2025, 3, 21)


def is_jalali_leap(jy: int) -> bool:
    """Kabiseh (leap) years follow the standard 33-year cycle:
    (jy % 33) in {1, 5, 9, 13, 17, 22, 26, 30}. 1399/1403/1408 are leap."""
    return jy % 33 in (1, 5, 9, 13, 17, 22, 26, 30)


def jalali_month_length(jy: int, jm: int) -> int:
	if not isinstance(jm, int) or not 1 <= jm <= 12:
		raise ValueError(f"Jalali month out of range (1..12): {jm!r}")
	if jm <= 6:
		return 31
	if jm <= 11:
		return 30
	return 30 if is_jalali_leap(jy) else 29


def jalali_year_length(jy: int) -> int:
    return 366 if is_jalali_leap(jy) else 365


def validate_jalali(jy: int, jm: int, jd: int) -> None:
    if not isinstance(jy, int) or not 1 <= jy <= 1600:
        raise ValueError(f"Jalali year out of range (1..1600): {jy!r}")
    if not isinstance(jm, int) or not 1 <= jm <= 12:
        raise ValueError(f"Jalali month out of range (1..12): {jm!r}")
    if not isinstance(jd, int) or not 1 <= jd <= jalali_month_length(jy, jm):
        raise ValueError(f"Invalid Jalali day {jd!r} for {jy}/{jm:02d}")


def _jdn(jy: int, jm: int, jd: int) -> int:
    """Jalali day number relative to the 1404/01/01 anchor (may be negative)."""
    validate_jalali(jy, jm, jd)
    days = jd - 1
    for m in range(1, jm):
        days += jalali_month_length(jy, m)
    if jy >= 1404:
        for y in range(1404, jy):
            days += jalali_year_length(y)
    else:
        for y in range(jy, 1404):
            days -= jalali_year_length(y)
    return days


def jalali_to_date(jy: int, jm: int, jd: int) -> datetime.date:
    return datetime.date.fromordinal(_ANCHOR_GREGORIAN.toordinal() + _jdn(jy, jm, jd))


def _coerce_date(date_value: datetime.date | str) -> datetime.date:
    if isinstance(date_value, str):
        return datetime.date.fromisoformat(to_english_digits(date_value).strip())
    if isinstance(date_value, datetime.datetime):
        return date_value.date()
    return date_value


def date_to_jalali(date_value: datetime.date | str) -> tuple[int, int, int]:
    date_value = _coerce_date(date_value)
    target = date_value.toordinal() - _ANCHOR_GREGORIAN.toordinal()
    # estimate then walk to the exact year (loop runs at most a few times)
    jy = 1404 + int(target // 365.2422)
    while _jdn(jy + 1, 1, 1) <= target:
        jy += 1
    while _jdn(jy, 1, 1) > target:
        jy -= 1
    remaining = target - _jdn(jy, 1, 1)
    for jm in range(1, 13):
        ml = jalali_month_length(jy, jm)
        if remaining < ml:
            return jy, jm, remaining + 1
        remaining -= ml
    raise AssertionError("unreachable")  # pragma: no cover


_ENGLISH_DIGITS_X = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")


def to_english_digits(text: str) -> str:
    return str(text).translate(_ENGLISH_DIGITS_X)


_PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
_ENGLISH_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")

_JALALI_DATE_RE = re.compile(r"^\s*(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*$")


def format_jalali(
    date_value: datetime.date,
    template: str = "{jd:02d}/{jm:02d}/{jy:04d}",
    persian_digits: bool = False,
    month_name: bool = False,
) -> str:
    """Format a Gregorian date (or ISO string) as Jalali. Default: DD/MM/YYYY."""
    jy, jm, jd = date_to_jalali(date_value)
    if month_name:
        text = template.format(jy=jy, jm=jm, jd=jd, month_name=MONTH_NAMES_FA[jm - 1])
        # if the caller did not use {month_name}, fall back to plain format
        if "{month_name}" not in template:
            text = f"{jd:02d} {MONTH_NAMES_FA[jm - 1]} {jy:04d}"
    else:
        text = template.format(jy=jy, jm=jm, jd=jd)
    return text.translate(_PERSIAN_DIGITS) if persian_digits else text


def parse_jalali(text: str) -> datetime.date:
    """Parse a Jalali date string (1405/06/24, ۱۴۰۵-۶-۲۴, 1405.6.24 …) to Gregorian."""
    if text is None:
        raise ValueError("empty Jalali date")
    normalized = str(text).translate(_ENGLISH_DIGITS)
    m = _JALALI_DATE_RE.match(normalized)
    if not m:
        raise ValueError(f"unrecognized Jalali date: {text!r}")
    jy, jm, jd = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return jalali_to_date(jy, jm, jd)


def jalali_month_name(jm: int) -> str:
    if not isinstance(jm, int) or not 1 <= jm <= 12:
        raise ValueError(f"Jalali month out of range (1..12): {jm!r}")
    return MONTH_NAMES_FA[jm - 1]


def jalali_today() -> tuple[int, int, int]:
    return date_to_jalali(datetime.date.today())
