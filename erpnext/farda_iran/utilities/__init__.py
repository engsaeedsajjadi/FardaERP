"""FardaERP Persian text utilities (normalization is THE single fold point)."""

from .normalization import (
	ARABIC_TO_PERSIAN,
	fold_for_search,
	normalize,
	to_english_digits,
	to_persian_digits,
)

__all__ = ["ARABIC_TO_PERSIAN", "fold_for_search", "normalize", "to_english_digits", "to_persian_digits"]
