"""Unit tests: Persian search-key folding (pure — the §10 fold-at-rest core)."""

from __future__ import annotations

import os
import sys
import unittest
import importlib.util

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
	"test_search_keys_module",
	os.path.join(_HERE, "..", "utilities", "normalization.py"),
)
norm = importlib.util.module_from_spec(_spec)
sys.modules["test_search_keys_module"] = norm
_spec.loader.exec_module(norm)

fold = norm.fold_for_search
canon = norm.normalize


class TestSearchKeyFolding(unittest.TestCase):
	def test_arabic_yeh_folds_to_persian(self):
		self.assertEqual(fold("علي"), fold("علی"))

	def test_arabic_keheh_folds_to_persian(self):
		self.assertEqual(fold("كارخانه"), fold("کارخانه"))

	def test_persian_digits_fold_to_english(self):
		self.assertEqual(fold("پيچ ۱۲۳"), fold("پیچ 123"))
		self.assertEqual(fold("۱۲۳"), fold("123"))

	def test_arabic_digits_fold(self):
		self.assertEqual(fold("١٢٣"), fold("123"))

	def test_zwnj_is_stripped_from_key(self):
		self.assertEqual(fold("علی‌رضا"), fold("علیرضا"))

	def test_whitespace_collapsed(self):
		self.assertEqual(fold("  شرکت   پارس  "), fold("شرکت پارس"))

	def test_casefold_latin(self):
		self.assertEqual(fold("Pars Co."), fold("pars co."))

	def test_idempotent(self):
		once = fold("كارخانه علي‌رضا ۱۲")
		self.assertEqual(fold(once), once)

	def test_canonical_name_preserves_persian_letters_and_folds_digits(self):
		self.assertEqual(canon("علي ۱۲۳"), "علی 123")
		self.assertEqual(canon("شرکت كيميا"), "شرکت کیمیا")

	def test_canonical_idempotent(self):
		once = canon("شرکت كيميا ۱۲")
		self.assertEqual(canon(once), once)

	def test_key_is_stable_between_canonical_and_arabic_input(self):
		"""The property the search endpoint relies on: same key for both spellings."""
		self.assertEqual(
			fold("شرکت كيميا سبز"),
			fold("شرکت کیمیا سبز"),
		)


if __name__ == "__main__":
	unittest.main()
