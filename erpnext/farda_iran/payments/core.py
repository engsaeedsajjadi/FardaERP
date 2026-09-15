"""Payment verification policy — pure engine (no frappe, no network).

Implements the security rules of master brief §17 for EVERY gateway:
- amount verification (callback amount must match the request amount)
- duplicate/replayed callback handling (a settled transaction cannot settle twice;
  a repeated identical success returns the SAME decision with `already=True`)
- status mapping is gateway-adapter territory; this engine takes the adapter's
  normalized verification report and decides.

Decision object is explicit — never a bare bool — so callers log it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Decision(Enum):
	ACCEPT = "accept"                    # first successful verification -> settle
	ALREADY_SETTLED = "already_settled"  # duplicate callback of the same success
	FAIL_AMOUNT = "fail_amount_mismatch"
	FAIL_STATUS = "fail_gateway_status"
	FAIL_UNKNOWN_TX = "fail_unknown_transaction"


@dataclass
class SettledTransaction:
	"""What the log already knows about an authority."""

	authority: str
	settled: bool
	amount_irr: int


@dataclass
class VerificationReport:
	"""Normalized report produced by a gateway adapter's verify() call."""

	ok: bool                     # gateway said the payment succeeded
	amount_irr: int | None       # gateway-reported amount (None = gateway didn't return it)


@dataclass
class PaymentDecision:
	decision: Decision
	already: bool = False
	reasons: list[str] = field(default_factory=list)


def evaluate(
	logged: SettledTransaction | None,
	reported_amount_irr: int,
	report: VerificationReport,
) -> PaymentDecision:
	"""Decide what to do with a callback/verification result.

	``reported_amount_irr`` is the caller-asserted expected amount (what we asked
	the gateway to charge). The engine ALSO checks the gateway-echoed
	``report.amount_irr`` against the authoritative ``logged.amount_irr`` — the
	amount recorded when the payment was started — so a tampered/low verification
	can never settle a transaction even if a buggy caller echoes the gateway value.
	"""
	reasons: list[str] = []

	if logged is None:
		return PaymentDecision(decision=Decision.FAIL_UNKNOWN_TX, reasons=["authority not in payment log"])

	# amount integrity first — a matching amount on a failed payment still fails,
	# but a mismatched amount must never settle even if the gateway says ok.
	if report.amount_irr is not None and int(report.amount_irr) != int(reported_amount_irr):
		reasons.append(f"amount mismatch: expected {reported_amount_irr}, got {report.amount_irr}")
		return PaymentDecision(decision=Decision.FAIL_AMOUNT, reasons=reasons)

	if report.amount_irr is not None and int(report.amount_irr) != int(logged.amount_irr):
		reasons.append(f"gateway amount differs from logged amount: logged {logged.amount_irr}, got {report.amount_irr}")
		if not logged.settled:
			return PaymentDecision(decision=Decision.FAIL_AMOUNT, reasons=reasons)
		# already-settled rows stay settled (idempotency) but the anomaly is recorded

	if logged.settled:
		# duplicate callback: accept ONLY if it repeats a settled success with same amount
		if report.ok:
			return PaymentDecision(decision=Decision.ALREADY_SETTLED, already=True, reasons=reasons)
		reasons.append("duplicate callback after settlement with failure report")
		return PaymentDecision(decision=Decision.ALREADY_SETTLED, already=True, reasons=reasons)

	if not report.ok:
		reasons.append("gateway reported failure")
		return PaymentDecision(decision=Decision.FAIL_STATUS, reasons=reasons)

	return PaymentDecision(decision=Decision.ACCEPT, reasons=reasons)
