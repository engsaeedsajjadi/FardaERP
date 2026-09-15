"""Persian number-to-words (مبلغ به حروف) — pure Python, frappe-free.

The classic Iranian legal requirement on invoices/cheques: the payable amount
spelled out in Persian words. Supports 0 <= n < 10^15 (up to «هزار میلیارد»).
"""

from __future__ import annotations

MAX = 10**15

_ONES = ("", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه")
_TEENS = ("ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده")
_TENS = ("", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود")
_HUNDREDS = ("", "یکصد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد")
_SCALES = ("", "هزار", "میلیون", "میلیارد", "تریلیون", "هزار تریلیون")


def _three_digit_to_words(n: int) -> str:
	"""0..999 -> Persian words (empty string for 0)."""
	parts: list[str] = []
	hundreds, rest = divmod(n, 100)
	if hundreds:
		parts.append(_HUNDREDS[hundreds])
	if rest:
		if rest < 10:
			parts.append(_ONES[rest])
		elif rest < 20:
			parts.append(_TEENS[rest - 10])
		else:
			tens, ones = divmod(rest, 10)
			parts.append(_TENS[tens] + (" و " + _ONES[ones] if ones else ""))
	return " و ".join(parts)


def number_to_persian_words(n: int) -> str:
	"""Integer -> Persian words. Negative numbers get the «منفی» prefix."""
	n = int(n)
	if n >= MAX:
		raise ValueError(f"number_to_persian_words supports 0..{MAX - 1}, got {n}")
	if n == 0:
		return "صفر"
	sign = "منفی " if n < 0 else ""
	n = abs(n)

	groups: list[int] = []
	while n:
		groups.append(n % 1000)
		n //= 1000

	phrases: list[str] = []
	for idx in range(len(groups) - 1, -1, -1):
		g = groups[idx]
		if not g:
			continue
		scale = _SCALES[idx]
		words = _three_digit_to_words(g)
		if scale:
			if g == 1 and scale.startswith("هزار"):
				# idiomatic: «هزار» / «هزار میلیارد» — the leading «یک» is dropped
				words = scale
			else:
				words = (words + " " if words else "") + scale
		phrases.append(words)
	return sign + " و ".join(phrases)


def money_to_words_irr(amount_irr: int) -> str:
	"""Integral Rial amount -> «… ریال» (no conversion; label only)."""
	if int(amount_irr) != amount_irr:
		raise ValueError("amount_irr must be an integral number of Rials")
	return f"{number_to_persian_words(int(amount_irr))} ریال"


def money_to_words_toman(toman: int) -> str:
	"""Toman amount -> «… تومان».

	NOTE: takes the ALREADY-CONVERTED Toman integer. IRR->Toman conversion
	must go through the central currency service (see persian.py façade);
	this module never converts.
	"""
	if int(toman) != toman:
		raise ValueError("toman must be an integer (convert via currency service first)")
	return f"{number_to_persian_words(int(toman))} تومان"
