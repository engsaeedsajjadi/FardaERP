"""Unit tests: Persian number-to-words + invoice formatting façade (frappe-free)."""

from __future__ import annotations

import unittest

try:
	from farda_iran.invoice.words import (
		money_to_words_irr,
		money_to_words_toman,
		number_to_persian_words,
	)
except ImportError:
	from erpnext.farda_iran.invoice.words import (
		money_to_words_irr,
		money_to_words_toman,
		number_to_persian_words,
	)

_WORDS_VECTORS = [
	(0, "صفر"),
	(7, "هفت"),
	(10, "ده"),
	(11, "یازده"),
	(20, "بیست"),
	(21, "بیست و یک"),
	(55, "پنجاه و پنج"),
	(100, "یکصد"),
	(101, "یکصد و یک"),
	(119, "یکصد و نوزده"),
	(200, "دویست"),
	(999, "نهصد و نود و نه"),
	(1000, "هزار"),
	(1001, "هزار و یک"),
	(2000, "دو هزار"),
	(11000, "یازده هزار"),
	(100_000, "یکصد هزار"),
	(300_000, "سیصد هزار"),
	(1_000_000, "یک میلیون"),
	(1_000_001, "یک میلیون و یک"),
	(123_456_789, "یکصد و بیست و سه میلیون و چهارصد و پنجاه و شش هزار و هفتصد و هشتاد و نه"),
	(10**12, "یک تریلیون"),
	(
		1_234_567_890_123,
		"یک تریلیون و دویست و سی و چهار میلیارد و پانصد و شصت و هفت میلیون"
		" و هشتصد و نود هزار و یکصد و بیست و سه",
	),
]


class TestNumberToPersianWords(unittest.TestCase):
	def test_vector_table(self):
		for n, expected in _WORDS_VECTORS:
			with self.subTest(n=n):
				self.assertEqual(number_to_persian_words(n), expected)

	def test_negative_gets_prefix(self):
		self.assertEqual(number_to_persian_words(-1234), "منفی هزار و دویست و سی و چهار")

	def test_overflow_rejected(self):
		with self.assertRaises(ValueError):
			number_to_persian_words(10**15)

	def test_idiomatic_hazars_have_no_yek(self):
		self.assertNotIn("یک هزار و", number_to_persian_words(1000))
		self.assertTrue(number_to_persian_words(1000).startswith("هزار"))


class TestMoneyWords(unittest.TestCase):
	def test_rial_suffix(self):
		self.assertEqual(money_to_words_irr(1_000_000), "یک میلیون ریال")
		self.assertEqual(money_to_words_irr(0), "صفر ریال")

	def test_rial_requires_integral(self):
		with self.assertRaises(ValueError):
			money_to_words_irr(1000.5)

	def test_toman_suffix(self):
		self.assertEqual(money_to_words_toman(100_000), "یکصد هزار تومان")

	def test_toman_requires_integer(self):
		with self.assertRaises(ValueError):
			money_to_words_toman(1000.25)

	def test_toman_matches_central_conversion(self):
		"""IRR->Toman in the façade must agree with the central currency service."""
		try:
			from farda_iran.currency.service import irr_to_toman_rounded
			from farda_iran.invoice.persian import money_words_toman
		except ImportError:
			from erpnext.farda_iran.currency.service import irr_to_toman_rounded
			from erpnext.farda_iran.invoice.persian import money_words_toman

		for irr in (0, 1, 9, 10, 15, 95, 99_995, 1_000_000, 123_456_789):
			with self.subTest(irr=irr):
				expected = money_to_words_toman(irr_to_toman_rounded(irr))
				self.assertEqual(money_words_toman(irr), expected)
