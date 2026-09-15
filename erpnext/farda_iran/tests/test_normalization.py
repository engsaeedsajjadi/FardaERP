"""Unit tests for Persian text normalization — stdlib only.

    PYTHONPATH=<repo>/erpnext python -m unittest erpnext.farda_iran.tests.test_normalization
"""

import os
import sys
import unittest

# Standalone-run bootstrap: make `farda_iran` importable as a top-level
# package, then drop the path again (erpnext/ contains modules like `gettext`
# that must never shadow the stdlib).
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_ADDED_PATH = _ROOT not in sys.path
if _ADDED_PATH:
	sys.path.insert(0, _ROOT)

from farda_iran import utilities

if _ADDED_PATH:
	sys.path.remove(_ROOT)


class TestLetterNormalization(unittest.TestCase):
	def test_yeh_variants_fold_together(self):
		self.assertEqual(utilities.fold_for_search("علي"), utilities.fold_for_search("علی"))

	def test_kaf_variants_fold_together(self):
		self.assertEqual(utilities.fold_for_search("كتاب"), utilities.fold_for_search("کتاب"))

	def test_heh_teh_marbuta(self):
		self.assertEqual(utilities.fold_for_search("مدرسه"), utilities.fold_for_search("مدرسة"))

	def test_hamza_forms(self):
		self.assertEqual(utilities.fold_for_search("أحمد"), utilities.fold_for_search("احمد"))

	def test_idempotent(self):
		text = "ک key يـي ۱۲3"
		self.assertEqual(utilities.fold_for_search(text), utilities.fold_for_search(utilities.fold_for_search(text)))


class TestDigits(unittest.TestCase):
	def test_persian_to_english(self):
		self.assertEqual(utilities.to_english_digits("۱۴۰۵/۰۶/۲۴"), "1405/06/24")
		self.assertEqual(utilities.to_english_digits("٠١٢٣٤٥٦٧٨٩"), "0123456789")  # Arabic-Indic

	def test_english_to_persian(self):
		self.assertEqual(utilities.to_persian_digits("1405/06/24"), "۱۴۰۵/۰۶/۲۴")

	def test_normalization_folds_all_digit_systems(self):
		self.assertEqual(utilities.normalize("۱۲۳"), utilities.normalize("123"))
		self.assertEqual(utilities.normalize("١٢٣"), utilities.normalize("123"))


class TestZWNJAndInvisibles(unittest.TestCase):
	def test_zwnj_preserved_in_normalize(self):
		self.assertIn("\u200C", utilities.normalize("می‌شود"))

	def test_zwnj_does_not_break_search_fold(self):
		self.assertEqual(utilities.fold_for_search("می‌شود"), utilities.fold_for_search("میشود"))

	def test_invisible_marks_removed(self):
		self.assertEqual(utilities.normalize("a\u200Fb"), "ab")
		self.assertEqual(utilities.fold_for_search("کتـاب"), utilities.fold_for_search("کتاب"))  # tatweel

	def test_whitespace_collapsed_in_fold(self):
		self.assertEqual(utilities.fold_for_search("  علی    رضا "), "علی رضا")

	def test_none_and_empty_safe(self):
		self.assertEqual(utilities.normalize(None), "")
		self.assertEqual(utilities.fold_for_search(None), "")


class TestSearchKeys(unittest.TestCase):
	def test_entity_names_unique_after_fold(self):
		# 'علی' typed with Arabic Yeh and Persian Yeh must be ONE entity key
		keys = {utilities.fold_for_search(t) for t in ("علي رضا", "علی رضا")}
		self.assertEqual(keys, {"علی رضا"})

	def test_zwnj_name_is_single_token_after_fold(self):
		# ZWNJ joins words (semi-space): 'علی‌رضا' is one token, not 'علی رضا'
		self.assertEqual(utilities.fold_for_search("علی\u200Cرضا"), "علیرضا")


if __name__ == "__main__":
	unittest.main()
