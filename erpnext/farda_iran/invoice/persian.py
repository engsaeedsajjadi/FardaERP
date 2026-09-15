"""Invoice-facing Persian formatting façade.

Single place print formats / PDF renderers go to for:
- Persian digits, Toman money strings, Jalali dates, amount-in-words.
All IRR->Toman conversion and Jalali math is delegated to the central
services — this module only composes them.
"""

from __future__ import annotations

try:  # package-relative when frappe can import us; absolute fallback for path-loaded tests
	from .words import money_to_words_irr, money_to_words_toman, number_to_persian_words
except ImportError:  # pragma: no cover - direct path import in tests
	from farda_iran.invoice.words import (  # type: ignore
		money_to_words_irr,
		money_to_words_toman,
		number_to_persian_words,
	)

try:  # central services (pure cores; frappe optional inside them)
	from ..currency.service import format_irr_as_toman, irr_to_toman_rounded
	from ..jalali.service import format_jalali as _format_jalali
	from ..utilities.normalization import to_persian_digits
except ImportError:  # pragma: no cover - direct path import in tests
	from farda_iran.currency.service import (  # type: ignore
		format_irr_as_toman,
		irr_to_toman_rounded,
	)
	from farda_iran.jalali.service import format_jalali as _format_jalali  # type: ignore
	from farda_iran.utilities.normalization import to_persian_digits  # type: ignore

__all__ = [
	"fa",
	"format_jalali_date",
	"money_words_irr",
	"money_words_toman",
	"number_to_persian_words",
	"toman_str",
]


def fa(text) -> str:
	"""ASCII digits -> Persian digits (passes through everything else)."""
	return to_persian_digits("" if text is None else str(text))


def toman_str(amount_irr, persian_digits: bool = True, with_unit: bool = True) -> str:
	"""Stored IRR amount -> display Toman string via the central currency service."""
	return format_irr_as_toman(amount_irr, persian_digits=persian_digits, with_unit=with_unit)


def format_jalali_date(date_value, persian_digits: bool = True) -> str:
	"""Gregorian date (DB) -> Jalali display string via the central jalali service."""
	return _format_jalali(date_value, persian_digits=persian_digits)


def money_words_irr(amount_irr) -> str:
	return money_to_words_irr(int(amount_irr))


def money_words_toman(amount_irr) -> str:
	"""IRR amount -> Toman words; conversion through the central service."""
	return money_to_words_toman(int(irr_to_toman_rounded(amount_irr)))
