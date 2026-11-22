"""Minimal Iran System encoder for the SSO list disk (CORE-038). Pure stdlib.

Iran System is the DOS-era Persian code page the Social Security list program
expects: one byte per contextual letter form, stored in visual (left-to-right)
order. The letter-form table follows the public IRAN SYSTEM ↔ Unicode table
(Roozbeh Pournader, 2000) as published in python-iransystem (GPL-3.0-or-later,
same licence as this repository); the code here is FardaERP's own and covers
what a payroll list holds: Persian letters, digits, spaces and basic signs.
"""

from __future__ import annotations

import re

# isolated, final, initial, medial
FORMS = {
	"آ": b"\x8d\x8d\x8d\x8d", "ئ": b"\x8e\x8e\x8e\x8e", "ء": b"\x8f\x8f\x8f\x8f",
	"ا": b"\x90\x91\x90\x91", "ب": b"\x92\x92\x93\x93", "پ": b"\x94\x94\x95\x95",
	"ت": b"\x96\x96\x97\x97", "ث": b"\x98\x98\x99\x99", "ج": b"\x9a\x9a\x9b\x9b",
	"چ": b"\x9c\x9c\x9d\x9d", "ح": b"\x9e\x9e\x9f\x9f", "خ": b"\xa0\xa0\xa1\xa1",
	"د": b"\xa2\xa2\xa2\xa2", "ذ": b"\xa3\xa3\xa3\xa3", "ر": b"\xa4\xa4\xa4\xa4",
	"ز": b"\xa5\xa5\xa5\xa5", "ژ": b"\xa6\xa6\xa6\xa6", "س": b"\xa7\xa7\xa8\xa8",
	"ش": b"\xa9\xa9\xaa\xaa", "ص": b"\xab\xab\xac\xac", "ض": b"\xad\xad\xae\xae",
	"ط": b"\xaf\xaf\xaf\xaf", "ظ": b"\xe0\xe0\xe0\xe0", "ع": b"\xe1\xe2\xe4\xe3",
	"غ": b"\xe5\xe6\xe8\xe7", "ف": b"\xe9\xe9\xea\xea", "ق": b"\xeb\xeb\xec\xec",
	"ک": b"\xed\xed\xee\xee", "گ": b"\xef\xef\xf0\xf0", "ل": b"\xf1\xf1\xf3\xf3",
	"م": b"\xf4\xf4\xf5\xf5", "ن": b"\xf6\xf6\xf7\xf7", "و": b"\xf8\xf8\xf8\xf8",
	"ه": b"\xf9\xf9\xfb\xfa", "ی": b"\xfd\xfc\xfe\xfe",
}
LAM_ALEF = 0xF2
DUAL = set("ئبپتثجچحخسشصضطظعغفقکگلمنهی")
RIGHT = set("آادذرزژو")
OTHER = {"،": 0x8A, "؟": 0x8C, "؛": 0x3B}
NORMALIZE = str.maketrans(
	"كيىةأإ٠١٢٣٤٥٦٧٨٩",
	"کییهاا۰۱۲۳۴۵۶۷۸۹",
)
ZWNJ, ZWJ = "‌", "‍"
_LTR = re.compile(r"[A-Za-z0-9۰-۹][A-Za-z0-9۰-۹.,:/\-]*[A-Za-z0-9۰-۹]|[A-Za-z0-9۰-۹]")
_MIRROR = str.maketrans("()[]{}<>", ")(][}{><")


def _codes(text: str) -> list[int]:
	"""Logical-order text -> logical-order list of Iran System codes."""
	out: list[int] = []
	i = 0
	while i < len(text):
		ch = text[i]
		nxt = text[i + 1] if i + 1 < len(text) else ""
		if ch == "ل" and nxt == "ا":
			out.append(LAM_ALEF)
			i += 2
			continue
		forms = FORMS.get(ch)
		if forms:
			prev = text[i - 1] if i else ""
			joins_prev = ch in (DUAL | RIGHT) and prev in DUAL
			joins_next = ch in DUAL and (nxt in (DUAL | RIGHT))
			out.append(forms[int(joins_prev) + 2 * int(joins_next)])
		elif "۰" <= ch <= "۹":
			out.append(0x80 + ord(ch) - 0x06F0)
		elif ch in OTHER:
			out.append(OTHER[ch])
		elif ch in (ZWNJ, ZWJ):
			pass  # only influence shaping (ZWNJ breaks the join: prev/next are not letters)
		elif ord(ch) < 128:
			out.append(ord(ch))
		else:
			out.append(ord("?"))
		i += 1
	return out


def encode(text: str) -> bytes:
	"""Unicode (logical order) -> Iran System bytes in visual order."""
	text = (text or "").translate(NORMALIZE)
	# split into left-to-right runs (Latin/digits) and right-to-left runs
	parts, pos = [], 0
	for m in _LTR.finditer(text):
		if m.start() > pos:
			parts.append(("rtl", text[pos : m.start()]))
		parts.append(("ltr", m.group()))
		pos = m.end()
	if pos < len(text):
		parts.append(("rtl", text[pos:]))
	if not any(k == "rtl" and re.search(r"[؀-ۿ]", t) for k, t in parts):
		return bytes(_codes(text))  # pure Latin/number: unchanged
	out = bytearray()
	for kind, seg in reversed(parts):
		codes = _codes(seg)
		out += bytes(codes) if kind == "ltr" else bytes(reversed(_codes(seg.translate(_MIRROR))))
	return bytes(out)
