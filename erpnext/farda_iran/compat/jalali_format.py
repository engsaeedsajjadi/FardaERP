"""Server-side Jalali dates for Persian users (CORE-048).

The Desk shows Jalali dates in the browser (farda_ui.js), but everything the
SERVER formats — print formats and PDFs, email and notification text,
messages like «سررسید ...» — goes through frappe.utils.formatdate /
format_datetime and came out Gregorian. This wraps those two functions: when
the current user's language is Persian (and the site has not switched
Jalali display off with `farda_iran_ui_jalali_dates: 0`), a date formatted in
the default style becomes the Jalali DD/MM/YYYY that the Desk shows.

Untouched on purpose:
- calls with an explicit format_string (code that needs a specific layout,
  e.g. "MMM YYYY" period buckets, file names, API payloads);
- data imports, migrations, installs and tests;
- stored values: only the text produced for display changes.

Installed idempotently from before_request / before_job hooks so every web
worker and background worker gets it.
"""

from __future__ import annotations

import frappe

_APPLIED = False


def _active() -> bool:
	try:
		lang = getattr(frappe.local, "lang", None) or ""
		if not str(lang).startswith("fa"):
			return False
		flags = frappe.flags
		if flags.in_import or flags.in_test or flags.in_migrate or flags.in_install or flags.in_patch:
			return False
		value = frappe.get_conf().get("farda_iran_ui_jalali_dates")
		return value is None or bool(int(value))
	except Exception:
		return False


def _jalali(date_value) -> str:
	from frappe.utils import getdate

	from erpnext.farda_iran.jalali.service import format_jalali

	return format_jalali(getdate(date_value), "{jd:02d}/{jm:02d}/{jy:04d}")


def apply() -> None:
	global _APPLIED
	if _APPLIED:
		return
	import frappe.utils
	import frappe.utils.data as data

	orig_formatdate = data.formatdate
	orig_format_datetime = data.format_datetime

	def formatdate(string_date=None, format_string=None, *args, **kwargs):
		if format_string or not _active():
			return orig_formatdate(string_date, format_string, *args, **kwargs)
		try:
			from frappe.utils import getdate, nowdate

			if string_date in (None, ""):
				string_date = nowdate()
			getdate(string_date)  # raises on garbage → fall back below
			return _jalali(string_date)
		except Exception:
			return orig_formatdate(string_date, format_string, *args, **kwargs)

	def format_datetime(datetime_string=None, format_string=None, *args, **kwargs):
		if format_string or not _active() or datetime_string in (None, ""):
			return orig_format_datetime(datetime_string, format_string, *args, **kwargs)
		try:
			from frappe.utils import format_time, get_datetime

			dt = get_datetime(datetime_string)
			return f"{_jalali(dt.date())} {format_time(dt)}"
		except Exception:
			return orig_format_datetime(datetime_string, format_string, *args, **kwargs)

	formatdate.__farda_original__ = orig_formatdate
	format_datetime.__farda_original__ = orig_format_datetime
	data.formatdate = formatdate
	data.format_datetime = format_datetime
	frappe.utils.formatdate = formatdate
	frappe.utils.format_datetime = format_datetime
	try:
		import frappe.utils.formatters as formatters

		if hasattr(formatters, "formatdate"):
			formatters.formatdate = formatdate
		if hasattr(formatters, "format_datetime"):
			formatters.format_datetime = format_datetime
	except Exception:
		pass
	_APPLIED = True


def apply_hook(*args, **kwargs) -> None:
	"""before_request / before_job entry point (ignores hook arguments)."""
	try:
		apply()
	except Exception:
		pass
