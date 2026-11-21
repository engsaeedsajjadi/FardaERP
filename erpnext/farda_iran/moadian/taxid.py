"""Moadian unique tax number «شماره منحصر به فرد مالیاتی» (22 chars). Pure stdlib.

Layout (RC_DCPS.SN_V1.3 §3-1):
    MEMORY_ID(6) + hex(days since 1970-01-01 UTC, 5) + hex(serial, 10) + check(1)
Check digit = Verhoeff over the decimal control string
    to_decimal(MEMORY_ID) + days (6 digits, zero padded) + serial (12 digits)
where a letter becomes its ASCII code ("A" -> "65") and a digit stays as is.
Official vector (Appendix 1): DEF5GH, day 18463, serial 12 -> DEF5GH0481F000000000C2.
"""

from __future__ import annotations

import re

DAY_MS = 86_400_000
MAX_SERIAL = 16**10 - 1

# Standard Verhoeff dihedral-group tables (public-domain algorithm).
_MUL = (
	(0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
	(1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
	(2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
	(3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
	(4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
	(5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
	(6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
	(7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
	(8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
	(9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_PERM = (
	(0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
	(1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
	(5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
	(8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
	(9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
	(4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
	(2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
	(7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)
_INV = (0, 4, 3, 2, 1, 5, 6, 7, 8, 9)

# allowed: 1-9 and A D E F G H K M N O P R T W X Y Z (0 I J L Q V forbidden; B C S U reserved)
MEMORY_ID_RE = re.compile(r"^[1-9ADEFGHKMNOPRTWXYZ]{6}$")
TAXID_RE = re.compile(r"^[0-9A-Z]{6}[0-9A-F]{15}[0-9]$")


def verhoeff_digit(number: str) -> int:
	c = 0
	for i, ch in enumerate(reversed(number)):
		c = _MUL[c][_PERM[(i + 1) % 8][int(ch)]]
	return _INV[c]


def _to_decimal(memory_id: str) -> str:
	return "".join(ch if ch.isdigit() else str(ord(ch)) for ch in memory_id)


def control_string(memory_id: str, days: int, serial: int) -> str:
	return f"{_to_decimal(memory_id.upper())}{days:06d}{serial:012d}"


def day_of(indatim_ms: int) -> int:
	return int(indatim_ms) // DAY_MS


def is_valid_memory_id(memory_id: str) -> bool:
	return bool(MEMORY_ID_RE.match((memory_id or "").upper()))


def generate(memory_id: str, indatim_ms: int, serial: int) -> str:
	memory_id = (memory_id or "").strip().upper()
	if len(memory_id) != 6 or not memory_id.isalnum():
		raise ValueError("شناسه یکتای حافظه مالیاتی باید ۶ کاراکتر باشد")
	if not 0 <= int(serial) <= MAX_SERIAL:
		raise ValueError("سریال صورتحساب خارج از محدوده است")
	days = day_of(indatim_ms)
	if not 0 <= days <= 0xFFFFF:
		raise ValueError("تاریخ صورتحساب خارج از محدوده است")
	check = verhoeff_digit(control_string(memory_id, days, int(serial)))
	return f"{memory_id}{days:05X}{int(serial):010X}{check}"


def inno_of(taxid: str) -> str:
	"""Internal serial sent as header.inno = the taxid's 10-hex serial part."""
	return taxid[11:21]


def is_valid(taxid: str, indatim_ms: int | None = None) -> bool:
	t = (taxid or "").strip().upper()
	if not TAXID_RE.match(t):
		return False
	days, serial = int(t[6:11], 16), int(t[11:21], 16)
	if str(verhoeff_digit(control_string(t[:6], days, serial))) != t[21]:
		return False
	return indatim_ms is None or day_of(indatim_ms) == days
