"""VAT row planner — PURE decision layer for the invoice VAT engine.

Given the per-row exemption flags + row amounts and the effective rate, decides:
  none       rate<=0 or no rows               → no tax rows at all
  all_exempt every row exempt                 → no tax rows
  single     no exempt rows                   → one "On Net Total" row (existing behavior)
  per_row    mixed exempt/taxable rows        → one "Actual" row per TAXABLE row,
             so exempt rows never carry VAT while taxable rows keep exact line-level VAT.

Rounding: HALF-UP at the currency precision (IRR = 0 decimals) — matches Iranian
practice; Python's round() is banker's rounding and is NOT used.
"""

from __future__ import annotations

import decimal
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Sequence

_Mode = str  # "none" | "all_exempt" | "single" | "per_row"


def _half_up(value: Decimal, precision: int = 0) -> Decimal:
	q = Decimal(1).scaleb(-precision)
	return value.quantize(q, rounding=decimal.ROUND_HALF_UP)


@dataclass(frozen=True)
class VatPlan:
	mode: _Mode
	rate: float
	taxable_net: Decimal
	exempt_net: Decimal
	total_tax: Decimal
	row_taxes: tuple[Decimal, ...] = field(default_factory=tuple)


def plan_vat(rows: Sequence[tuple[bool, float | int | Decimal]], rate: float, precision: int = 0) -> VatPlan:
	"""rows: (is_exempt, row_amount) pairs, in invoice order.

	Per-row rounding HALF-UP, then summed (never sum-then-round for per_row,
	so each line's VAT is exact and auditable).
	"""
	r = Decimal(str(rate))
	exempt_flags = [bool(f) for f, _ in rows]
	amounts = [Decimal(str(a if a is not None else 0)) for _, a in rows]

	taxable_net = sum((a for f, a in zip(exempt_flags, amounts) if not f), Decimal(0))
	exempt_net = sum((a for f, a in zip(exempt_flags, amounts) if f), Decimal(0))

	if not rows or r <= 0:
		return VatPlan("none", rate, taxable_net, exempt_net, Decimal(0))
	if all(exempt_flags):
		return VatPlan("all_exempt", rate, taxable_net, exempt_net, Decimal(0))

	if not any(exempt_flags):
		total = _half_up(taxable_net * r / Decimal(100), precision)
		return VatPlan("single", rate, taxable_net, exempt_net, total, (total,))

	row_taxes = tuple(
		Decimal(0) if f else _half_up(a * r / Decimal(100), precision)
		for f, a in zip(exempt_flags, amounts)
	)
	return VatPlan("per_row", rate, taxable_net, exempt_net, sum(row_taxes, Decimal(0)), row_taxes)


def to_number(value: Decimal, precision: int = 0) -> float:
	"""Decimal plan value → float at precision (for doc tax rows)."""
	return float(_half_up(value, precision))
