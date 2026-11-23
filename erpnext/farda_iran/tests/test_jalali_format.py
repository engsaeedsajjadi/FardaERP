"""CORE-048: server-side formatdate wrapper (with a minimal frappe stub)."""

import datetime
import sys
import types
import unittest


def _stub_frappe(lang="fa", conf=None, flags=None):
	frappe = types.ModuleType("frappe")
	frappe.local = types.SimpleNamespace(lang=lang)

	class _F(dict):
		__getattr__ = dict.get

	frappe.flags = _F(flags or {})
	frappe.get_conf = lambda: conf or {}
	utils = types.ModuleType("frappe.utils")
	data = types.ModuleType("frappe.utils.data")

	def getdate(v):
		return v if isinstance(v, datetime.date) and not isinstance(v, datetime.datetime) else datetime.date.fromisoformat(str(v)[:10])

	def get_datetime(v):
		return v if isinstance(v, datetime.datetime) else datetime.datetime.fromisoformat(str(v))

	data.formatdate = lambda d=None, fmt=None, *a, **k: "GREG:" + str(d) + (("|" + fmt) if fmt else "")
	data.format_datetime = lambda d=None, fmt=None, *a, **k: "GREGDT:" + str(d)
	for m in (utils, data):
		m.getdate = getdate
		m.get_datetime = get_datetime
		m.nowdate = lambda: "2026-11-23"
		m.format_time = lambda dt: dt.strftime("%H:%M:%S")
	utils.formatdate = data.formatdate
	utils.format_datetime = data.format_datetime
	utils.data = data
	frappe.utils = utils
	return {"frappe": frappe, "frappe.utils": utils, "frappe.utils.data": data}


class TestJalaliFormat(unittest.TestCase):
	def _load(self, **kw):
		mods = _stub_frappe(**kw)
		saved = {k: sys.modules.get(k) for k in mods}
		sys.modules.update(mods)
		self.addCleanup(lambda: [sys.modules.__setitem__(k, v) if v else sys.modules.pop(k, None) for k, v in saved.items()])
		import importlib.util
		import os

		here = os.path.dirname(os.path.abspath(__file__))
		spec = importlib.util.spec_from_file_location("jf_test", os.path.join(here, "..", "compat", "jalali_format.py"))
		jf = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(jf)
		try:
			from farda_iran.jalali.service import format_jalali
		except ImportError:
			from erpnext.farda_iran.jalali.service import format_jalali
		jf._jalali = lambda d: format_jalali(mods["frappe.utils"].getdate(d), "{jd:02d}/{jm:02d}/{jy:04d}")
		jf.apply()
		return mods, jf

	def test_persian_user_gets_jalali(self):
		mods, _ = self._load()
		self.assertEqual(mods["frappe.utils"].formatdate("2026-11-23"), "02/09/1405")
		self.assertEqual(mods["frappe.utils.data"].formatdate("2026-03-21"), "01/01/1405")
		self.assertEqual(mods["frappe.utils"].format_datetime("2026-11-23 14:05:00"), "02/09/1405 14:05:00")

	def test_explicit_format_untouched(self):
		mods, _ = self._load()
		self.assertEqual(mods["frappe.utils"].formatdate("2026-11-23", "MMM YYYY"), "GREG:2026-11-23|MMM YYYY")

	def test_other_language_untouched(self):
		mods, _ = self._load(lang="en")
		self.assertEqual(mods["frappe.utils"].formatdate("2026-11-23"), "GREG:2026-11-23")

	def test_import_and_flag_off_untouched(self):
		mods, _ = self._load(flags={"in_import": True})
		self.assertEqual(mods["frappe.utils"].formatdate("2026-11-23"), "GREG:2026-11-23")
		mods, _ = self._load(conf={"farda_iran_ui_jalali_dates": 0})
		self.assertEqual(mods["frappe.utils"].formatdate("2026-11-23"), "GREG:2026-11-23")

	def test_garbage_falls_back(self):
		mods, _ = self._load()
		self.assertEqual(mods["frappe.utils"].formatdate("not a date"), "GREG:not a date")


if __name__ == "__main__":
	unittest.main()
