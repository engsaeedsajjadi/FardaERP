"""FardaERP Iranian identifier validators — pure functions, stdlib only.

Algorithms are the OFFICIAL published ones:
- کد ملی (personal national ID): 10 digits, weights 10..2, mod-11 check digit;
  all-same-digit codes rejected; 8/9-digit codes zero-padded (official practice).
- شناسه ملی (legal entity national ID): 11 digits, first digit + 10 → ×2 mod 11
  seed, cyclic weights [29,27,23,21,19,17] over digits 2..10, mod-11 check.
- شماره شبا (IR IBAN): "IR" + 24 digits, ISO 7064 MOD-97-10 (result must equal 1).
- کد پستی: exactly 10 digits, not all identical (official: starts with 1-9).
- کد اقتصادی: 4..13 digits (legacy + current 12-digit format), not all identical.

Used by party validation hooks; also safe to use from JS-less server flows,
background jobs and tests. No frappe imports.
"""

from __future__ import annotations

try:  # works both as erpnext.farda_iran.* and standalone farda_iran.*
	from .normalization import to_english_digits
except ImportError:  # pragma: no cover
	from farda_iran.utilities.normalization import to_english_digits  # type: ignore

__all__ = [
	"is_valid_national_id",
	"is_valid_legal_national_id",
	"is_valid_iriban",
	"is_valid_postal_code",
	"is_valid_economic_code",
	"normalize_national_id",
]

_LEGAL_WEIGHTS = (29, 27, 23, 21, 19, 17)


def _all_same(digits: str) -> bool:
	return len(set(digits)) == 1


def normalize_national_id(code: str) -> str:
	"""Fold Persian/Arabic digits and strip separators/spaces."""
	return to_english_digits(str(code or "")).strip().replace(" ", "").replace("-", "")


def is_valid_national_id(code: str) -> bool:
	"""کد ملی — 10-digit personal national ID with mod-11 check digit."""
	code = normalize_national_id(code)
	if not code.isdigit():
		return False
	code = code.zfill(10)
	if len(code) != 10 or _all_same(code):
		return False
	check = int(code[9])
	s = sum(int(code[i]) * (10 - i) for i in range(9))
	r = s % 11
	return check == (r if r < 2 else 11 - r)


def is_valid_legal_national_id(code: str) -> bool:
	"""شناسه ملی — 11-digit legal-entity national ID."""
	code = normalize_national_id(code)
	if not code.isdigit() or len(code) != 11 or _all_same(code):
		return False
	seed = (int(code[0]) + 10) * 2 % 11
	s = seed + sum(int(code[i]) * _LEGAL_WEIGHTS[(i - 1) % 6] for i in range(1, 10))
	c = s % 11
	if c == 10:
		c = 0
	return c == int(code[10])


def is_valid_iriban(iban: str) -> bool:
	"""شماره شبا ایران — "IR" + 24 digits (2 check + 22 BBAN), MOD-97-10 == 1."""
	iban = normalize_national_id(iban).upper()
	if not iban.startswith("IR"):
		return False
	digits = iban[2:]
	if not digits.isdigit() or len(digits) != 24:
		return False
	# ISO 7064: move the first four chars (IR + check digits) to the end,
	# letters -> numbers (I=18, R=27); the remainder must be 1.
	check_digits, bban = digits[:2], digits[2:]
	return int(bban + "1827" + check_digits) % 97 == 1


def is_valid_postal_code(code: str) -> bool:
	"""کد پستی — exactly 10 digits, not all identical, first digit 1-9."""
	code = normalize_national_id(code)
	return (
		len(code) == 10
		and code.isdigit()
		and not _all_same(code)
		and code[0] != "0"
	)


def is_valid_economic_code(code: str) -> bool:
	"""کد اقتصادی — 4..13 digits (legacy 4-11 + current 12-digit), not all same."""
	code = normalize_national_id(code)
	return 4 <= len(code) <= 13 and code.isdigit() and not _all_same(code)
