"""Pure core of the Farda feature flags (§32/§35) — frappe-free.

Seven module-level subsystem flags (single vocabulary):
    sms · otp · payment · vat · banking · cheque · reports

Storage contract (glue in flags/service.py): one Check field per flag on
System Settings, `farda_enable_<name>`, default ON (1). Fail-open: a missing
field (pre-migrate site) reads as enabled, matching the historical default
where every subsystem was always on.

UI display flags (jalali_dates / toman_display) are deliberately NOT part of
this registry — they remain site_config keys consumed by ui/boot.py (existing,
live-proven contract).
"""

from __future__ import annotations

FLAG_NAMES: tuple[str, ...] = (
	"sms",
	"otp",
	"payment",
	"vat",
	"banking",
	"cheque",
	"reports",
)

FIELD_PREFIX = "farda_enable_"


def field_name(name: str) -> str:
	"""System Settings field for a flag; raises ValueError on unknown flag."""
	if name not in FLAG_NAMES:
		raise ValueError(f"فلگ ناشناخته است؛ مجاز: {', '.join(FLAG_NAMES)}")
	return f"{FIELD_PREFIX}{name}"


def parse_flag_value(raw, default: bool = True) -> bool:
	"""Lenient boolean parse for stored flag values (bool/int/str/Persian digits).

	None/empty → default. Unparseable → default (a display flag must never
	break boot; misconfigs surface in tests, not production logins).
	"""
	if raw is None or raw == "":
		return default
	if isinstance(raw, bool):
		return raw
	text = str(raw).strip().lower()
	translations = {
		"0": False, "1": True,
		"true": True, "false": False,
		"on": True, "off": False,
		"yes": True, "no": False,
		"۱": True, "۰": False,
	}
	return translations.get(text, default)
