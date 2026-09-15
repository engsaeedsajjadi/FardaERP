"""FardaERP UI boot integration — feature flags for Jalali/Toman display.

extend_bootinfo hook: injects `frappe.boot.farda_iran` consumed by
`farda_iran/public/js/farda_ui.js`. All flags default ON for Iranian sites and
are overridable per site via site_config keys (feature flags, §53):
  farda_iran_ui_jalali_dates (bool, default 1)
  farda_iran_ui_toman_display (bool, default 1)
"""

from __future__ import annotations

import frappe


def _flag(name: str, default: bool) -> bool:
	value = frappe.get_conf().get(name)
	if value is None:
		return default
	return bool(int(value))


def extend_bootinfo(bootinfo) -> None:
	from erpnext.farda_iran.currency.service import get_irr_per_toman

	bootinfo.farda_iran = {
		"jalali_dates": _flag("farda_iran_ui_jalali_dates", True),
		"toman_display": _flag("farda_iran_ui_toman_display", True),
		"irr_per_toman": float(get_irr_per_toman()),
	}
