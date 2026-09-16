"""Pure core of the Farda notification triggers (§22/§33) — frappe-free.

Kinds and labels are the single vocabulary shared by the scheduler service,
the SMS channel and the tests. `parse_alert_numbers` implements the env-only
recipient list contract: FARDA_ALERT_SMS_NUMBERS (comma separated, any Iranian
mobile form — Persian digits / +98 / 0098 — folded by the central validator).
"""

from __future__ import annotations

try:  # works as erpnext.farda_iran.* inside the app...
	from ..utilities.validators import normalize_ir_mobile
except ImportError:  # ...and as a path-loaded module in standalone tests
	from farda_iran.utilities.validators import normalize_ir_mobile

TRIGGER_KINDS = (
	"cheque_due",
	"low_stock",
	"invoice_overdue",
	"payment_received",
	"payment_failed",
	"approval_pending",
)

TRIGGER_LABELS: dict[str, str] = {
	"cheque_due": "سررسید چک",
	"low_stock": "موجودی زیر نقطه سفارش",
	"invoice_overdue": "فاکتور سررسید گذشته",
	"payment_received": "پرداخت تأیید شد",
	"payment_failed": "پرداخت ناموفق",
	"approval_pending": "در انتظار بررسی",
}


def parse_alert_numbers(raw: str | None) -> list[str]:
	"""FARDA_ALERT_SMS_NUMBERS → validated, deduped mobile list.

	Raises ValueError on any invalid entry (fail-fast: a silently skipped
	recipient on a finance alert is worse than a visible misconfiguration).
	"""
	if not raw or not raw.strip():
		return []
	out: list[str] = []
	for part in raw.split(","):
		part = part.strip()
		if not part:
			continue
		number = normalize_ir_mobile(part)
		if number not in out:
			out.append(number)
	return out


def sms_text(kind: str, subject: str) -> str:
	"""Uniform SMS body — `[FardaERP] برچسب: موضوع` — truncated to 160 chars."""
	return f"[FardaERP] {TRIGGER_LABELS[kind]}: {subject}"[:160]
