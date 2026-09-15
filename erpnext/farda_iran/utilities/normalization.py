"""FardaERP Persian text normalization — the single fold point for search,
uniqueness comparison and display digit policy.

Handles: Arabic <-> Persian letter confusion (ي/ی، ك/ک، ة/ه …), Arabic-Indic
and Extended Arabic-Indic digits <-> ASCII, ZWNJ consistency, tatweel, and
Unicode compatibility forms (NFKC).
"""

from __future__ import annotations

import unicodedata

__all__ = [
	"ARABIC_TO_PERSIAN",
	"normalize",
	"fold_for_search",
	"to_persian_digits",
	"to_english_digits",
]

# Arabic letters commonly mistyped / imported from Arabic sources -> Persian.
ARABIC_TO_PERSIAN = {
	"\u064A": "\u06CC",  # ي -> ی
	"\u0649": "\u06CC",  # ى -> ی
	"\u0643": "\u06A9",  # ك -> ک
	"\u0629": "\u0647",  # ة -> ه
	"\u0623": "\u0627",  # أ -> ا
	"\u0625": "\u0627",  # إ -> ا
	"\u0671": "\u0627",  # ٱ -> ا
	"\u0640": "",  # tatweel/kashida removed
	"\u200F": "",  # RLM removed
	"\u200E": "",  # LRM removed
	"\uFEFF": "",  # BOM removed
}

_FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_TO_PERSIAN = str.maketrans("0123456789", _FA_DIGITS)
_TO_ENGLISH = str.maketrans(_FA_DIGITS + "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669", "0123456789" * 2)
_ZWNJ = "\u200C"


def to_persian_digits(text: str) -> str:
	return str(text).translate(_TO_PERSIAN)


def to_english_digits(text: str) -> str:
	return str(text).translate(_TO_ENGLISH)


def normalize(text: str, keep_zwnj: bool = True) -> str:
	"""Canonical Persian form: NFKC + Arabic->Persian letters + digit folding +
	ZWNJ normalisation. Output is stable and idempotent."""
	if text is None:
		return ""
	s = unicodedata.normalize("NFKC", str(text))
	s = s.translate(str.maketrans(ARABIC_TO_PERSIAN))
	s = to_english_digits(s)
	if keep_zwnj:
		# collapse multiple ZWNJ, strip ZWNJ glued to spaces/edges
		while _ZWNJ + _ZWNJ in s:
			s = s.replace(_ZWNJ + _ZWNJ, _ZWNJ)
		s = s.replace(" " + _ZWNJ, " ").replace(_ZWNJ + " ", " ")
		s = s.strip(_ZWNJ)
	else:
		s = s.replace(_ZWNJ, "")
	return s


def fold_for_search(text: str) -> str:
	"""Aggressive form for matching/indexing: normalize + casefold + strip ZWNJ
	+ whitespace collapse. 'علي' and 'علی' fold to the same key."""
	s = normalize(text, keep_zwnj=False).casefold()
	return " ".join(s.split())
