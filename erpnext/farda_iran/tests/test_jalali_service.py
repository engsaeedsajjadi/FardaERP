"""Unit tests for the FardaERP Jalali service — runnable standalone (stdlib only):

    PYTHONPATH=<repo>/erpnext python -m unittest erpnext.farda_iran.tests.test_jalali_service
"""

import datetime
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

from farda_iran import jalali  # top-level import (erpnext namespace not required)

if _ADDED_PATH:
	sys.path.remove(_ROOT)


class TestJalaliAnchors(unittest.TestCase):
	"""External truth anchors — these pin the lattice to the real calendar."""

	def test_nowruz_1404(self):
		self.assertEqual(jalali.date_to_jalali(datetime.date(2025, 3, 21)), (1404, 1, 1))
		self.assertEqual(jalali.jalali_to_date(1404, 1, 1), datetime.date(2025, 3, 21))

	def test_nowruz_1403(self):
		self.assertEqual(jalali.date_to_jalali(datetime.date(2024, 3, 20)), (1403, 1, 1))

	def test_session_reference_date(self):
		# 2026-09-15 must be 1405/06/24
		self.assertEqual(jalali.date_to_jalali(datetime.date(2026, 9, 15)), (1405, 6, 24))

	def test_iranian_revolution_date(self):
		# 22 Bahman 1357 == 11 February 1979
		self.assertEqual(jalali.jalali_to_date(1357, 11, 22), datetime.date(1979, 2, 11))

	def test_last_day_of_leap_1403(self):
		# 1403 is kabiseh -> 1403/12/30 exists and equals 2025-03-20
		self.assertTrue(jalali.is_jalali_leap(1403))
		self.assertEqual(jalali.jalali_to_date(1403, 12, 30), datetime.date(2025, 3, 20))

	def test_kabiseh_years_match_known_list(self):
		for jy, expected in [(1399, True), (1403, True), (1404, False), (1408, True), (1412, True), (1402, False)]:
			self.assertEqual(jalali.is_jalali_leap(jy), expected, jy)


class TestJalaliMonthLengths(unittest.TestCase):
	def test_month_lengths(self):
		self.assertEqual(jalali.jalali_month_length(1405, 1), 31)
		self.assertEqual(jalali.jalali_month_length(1405, 6), 31)
		self.assertEqual(jalali.jalali_month_length(1405, 7), 30)
		self.assertEqual(jalali.jalali_month_length(1405, 11), 30)
		self.assertEqual(jalali.jalali_month_length(1405, 12), 29)  # 1405 not leap
		self.assertEqual(jalali.jalali_month_length(1403, 12), 30)  # 1403 leap

	def test_year_lengths(self):
		self.assertEqual(jalali.jalali_year_length(1403), 366)
		self.assertEqual(jalali.jalali_year_length(1404), 365)

	def test_invalid_dates_raise(self):
		with self.assertRaises(ValueError):
			jalali.jalali_to_date(1404, 12, 30)  # not leap
		with self.assertRaises(ValueError):
			jalali.jalali_to_date(1405, 13, 1)
		with self.assertRaises(ValueError):
			jalali.jalali_to_date(1405, 6, 32)
		with self.assertRaises(ValueError):
			jalali.jalali_to_date(1405, 0, 10)


class TestJalaliRoundtrip(unittest.TestCase):
	"""Exhaustive roundtrip over 1996-01-01 .. 2040-12-31 (~16,436 days)."""

	def test_gregorian_jalali_gregorian(self):
		d = datetime.date(1996, 1, 1)
		end = datetime.date(2040, 12, 31)
		one = datetime.timedelta(days=1)
		while d <= end:
			jy, jm, jd = jalali.date_to_jalali(d)
			self.assertEqual(jalali.jalali_to_date(jy, jm, jd), d, f"{d} -> {jy}/{jm}/{jd}")
			d += one

	def test_first_days_of_months_are_consistent(self):
		# 1st of every Jalali month must map onto increasing Gregorian dates
		prev = None
		for jy in (1403, 1404, 1405, 1408):
			for jm in range(1, 13):
				d = jalali.jalali_to_date(jy, jm, 1)
				if prev is not None:
					self.assertGreater(d, prev)
				prev = d


class TestJalaliFormatParse(unittest.TestCase):
	def test_format_default(self):
		self.assertEqual(jalali.format_jalali(datetime.date(2026, 9, 15)), "24/06/1405")

	def test_format_persian_digits(self):
		self.assertEqual(jalali.format_jalali(datetime.date(2026, 9, 15), persian_digits=True), "۲۴/۰۶/۱۴۰۵")

	def test_format_month_name(self):
		self.assertEqual(jalali.format_jalali(datetime.date(2026, 9, 15), month_name=True), "24 شهریور 1405")

	def test_parse_roundtrip(self):
		for text, greg in [
			("1405/06/24", datetime.date(2026, 9, 15)),
			("1405-6-24", datetime.date(2026, 9, 15)),
			("۱۴۰۵/۰۶/۲۴", datetime.date(2026, 9, 15)),
			("1404.01.01", datetime.date(2025, 3, 21)),
		]:
			self.assertEqual(jalali.parse_jalali(text), greg, text)

	def test_iso_string_input(self):
		self.assertEqual(jalali.date_to_jalali("2026-09-15"), (1405, 6, 24))
		self.assertEqual(jalali.format_jalali("2026-09-15"), "24/06/1405")

	def test_parse_garbage_raises(self):
		for bad in ("", None, "2026-09-15-is-not-jalali", "1405/13/01", "hello"):
			with self.assertRaises(ValueError):
				jalali.parse_jalali(bad)

	def test_month_names(self):
		self.assertEqual(jalali.jalali_month_name(1), "فروردین")
		self.assertEqual(jalali.jalali_month_name(12), "اسفند")
		with self.assertRaises(ValueError):
			jalali.jalali_month_name(13)


if __name__ == "__main__":
	unittest.main()
