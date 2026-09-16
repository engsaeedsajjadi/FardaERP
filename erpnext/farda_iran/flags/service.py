"""Farda feature flags — central service (§32/§35).

One place to read AND set the seven module-level subsystem flags. Storage:
Check fields on System Settings (`farda_enable_<name>`, default ON) created
idempotently by `ensure_flags` (wired into setup.install execute/before_migrate).

- get_flag(name)          → bool (fail-open: pre-migrate/missing field = ON)
- set_flag(name, value)   → runtime kill-switch (db write; single-value cache cleared)
- all_flags()             → {name: bool} — consumed by ui/boot.py bootinfo
- is_enabled(name)        → alias, reads nicer at call sites

Bootinfo shape (boot.farda_iran.modules): {"sms": true, ...} so the Desk JS
layer can react to subsystem switches without new endpoints.

Real wiring shipped with the registry:
- flags.sms gates the notifications SMS channel (notifications/service.py) —
  OFF means zero provider calls, proven live in R22.
"""

from __future__ import annotations

import frappe

from .core import FLAG_NAMES, field_name, parse_flag_value

_SETTINGS = "System Settings"

_FA_LABELS = {
	"sms": "پیامک",
	"otp": "ورود یک‌بارمصرف",
	"payment": "درگاه پرداخت",
	"vat": "مالیات بر ارزش افزوده",
	"banking": "بانکداری",
	"cheque": "چک",
	"reports": "گزارش‌ها",
}


def get_flag(name: str) -> bool:
	field = field_name(name)  # raises ValueError on unknown flag
	try:
		return parse_flag_value(frappe.db.get_single_value(_SETTINGS, field), default=True)
	except Exception:
		return True  # fail-open on any storage hiccup (pre-migrate, cache flush)


def is_enabled(name: str) -> bool:
	return get_flag(name)


def set_flag(name: str, value) -> bool:
	parsed = parse_flag_value(value, default=True)
	frappe.db.set_single_value(_SETTINGS, field_name(name), 1 if parsed else 0)
	return parsed


def all_flags() -> dict[str, bool]:
	return {name: get_flag(name) for name in FLAG_NAMES}


def ensure_flags() -> None:
	"""Idempotent: create the 7 Check fields on System Settings (default ON)."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	wanted = [field_name(name) for name in FLAG_NAMES]
	existing = set(
		frappe.get_all(
			"Custom Field", filters={"dt": _SETTINGS, "fieldname": ("in", wanted)}, pluck="fieldname"
		)
	)
	missing = [name for name in FLAG_NAMES if field_name(name) not in existing]
	if not missing:
		return
	create_custom_fields(
		{
			_SETTINGS: [
				{
					"fieldname": field_name(name),
					"label": f"Farda: فعال‌سازی {_FA_LABELS[name]}",
					"fieldtype": "Check",
					"default": "1",
					"no_copy": 1,
					"print_hide": 1,
				}
				for name in missing
			]
		},
		ignore_validate=True,
		update=True,
	)
	# Singles don't inherit Custom Field defaults — the column arrives as 0, so
	# seed ON explicitly for the fields created NOW. (An admin-set 0 on a field
	# that already existed is never touched: only `missing` fields are seeded.)
	for name in missing:
		frappe.db.set_single_value(_SETTINGS, field_name(name), 1)
