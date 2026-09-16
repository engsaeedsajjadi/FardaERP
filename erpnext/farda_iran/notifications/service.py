"""Farda notification triggers — scheduler glue (§22/§33).

Triggers (all real-data, no fixtures):
- cheque_due        : delegates to cheque.reminders.notify_cheques_due (R18-tuned)
- low_stock         : Bin.actual_qty < reorder_level on enabled stock items
- invoice_overdue   : submitted Sales Invoice, outstanding > 0, due_date < today
- payment_received  : Farda Payment Log status=Verified
- payment_failed    : Farda Payment Log status=Failed
- approval_pending  : Draft Sales Invoice untouched for N days

Channels:
- in-app : Notification Log (Alert) for finance users, deduped EVER per
  (document_type, document_name, for_user) — the same convention as the
  cheque reminders, with a batch dedupe read (R18 N+1 rule).
- SMS    : one message per NEW event to FARDA_ALERT_SMS_NUMBERS (env-only,
  comma separated; parse via notifications.core). Fired only when the event
  produced at least one new in-app row, so the in-app ledger doubles as the
  SMS dedupe registry. Provider via sms.provider.resolve() (FARDA_SMS_PROVIDER
  env, console fallback). Live delivery is BLOCKED-ENV (no credentials); the
  channel is proven with a recording provider in the runtime suite.

No secrets/PII in subjects beyond document names; SMS bodies carry the same
subject text only.
"""

from __future__ import annotations

import os

import frappe

from .core import TRIGGER_KINDS, parse_alert_numbers, sms_text

_FINANCE_ROLES = ["Accounts Manager", "Accounts User", "System Manager"]

_DOCTYPE_BY_KIND = {
	"low_stock": "Bin",
	"invoice_overdue": "Sales Invoice",
	"payment_received": "Farda Payment Log",
	"payment_failed": "Farda Payment Log",
	"approval_pending": "Sales Invoice",
}


def _finance_users() -> list[str]:
	users = frappe.get_all("Has Role", filters={"role": ("in", _FINANCE_ROLES)}, pluck="parent")
	users = sorted({u for u in users if u != "Guest" and frappe.db.get_value("User", u, "enabled")})
	if not users and frappe.db.get_value("User", "Administrator", "enabled"):
		users = ["Administrator"]  # root recipient fallback on bare installs
	return users


def _notify(doctype: str, docname: str, subject: str, users: list[str]) -> int:
	"""Alert rows for (doctype, docname) not yet notified — ONE dedupe read."""
	notified = {
		r.for_user
		for r in frappe.get_all(
			"Notification Log",
			filters={
				"document_type": doctype,
				"document_name": docname,
				"for_user": ("in", users),
				"type": "Alert",
			},
			fields=["for_user"],
		)
	}
	created = 0
	for user in users:
		if user in notified:
			continue
		frappe.get_doc(
			{
				"doctype": "Notification Log",
				"for_user": user,
				"type": "Alert",
				"document_type": doctype,
				"document_name": docname,
				"subject": subject,
			}
		).insert(ignore_permissions=True)
		created += 1
	return created


def _collect_low_stock() -> list[tuple[str, str]]:
	"""Reorder config (Item Reorder) × live stock (Bin) — 2 batched queries.

	Bounded: reorder rows are configuration (small); Bin rows fetched in one
	query for all configured items (R18 N+1 rule).
	"""
	reorders = frappe.get_all(
		"Item Reorder",
		filters={"parenttype": "Item"},
		fields=["parent", "warehouse", "warehouse_reorder_level"],
		limit=500,
	)
	if not reorders:
		return []
	codes = sorted({r.parent for r in reorders})
	enabled = set(
		frappe.get_all(
			"Item", filters={"name": ("in", codes), "disabled": 0, "is_stock_item": 1}, pluck="name"
		)
	)
	bins = {
		(b.item_code, b.warehouse): (b.name, b.actual_qty)
		for b in frappe.get_all(
			"Bin", filters={"item_code": ("in", codes)}, fields=["name", "item_code", "warehouse", "actual_qty"]
		)
	}
	out = []
	for r in reorders:
		level = r.warehouse_reorder_level or 0
		if r.parent not in enabled or not r.warehouse or (r.parent, r.warehouse) not in bins or level <= 0:
			continue
		bin_name, actual = bins[(r.parent, r.warehouse)]
		if (actual or 0) < level:
			out.append(
				(
					bin_name,
					f"موجودی {r.parent} در {r.warehouse} زیر نقطه سفارش است "
					f"({actual:g} از {level:g})",
				)
			)
	return out


def _collect_overdue() -> list[tuple[str, str]]:
	from erpnext.farda_iran.currency.service import format_irr_as_toman

	rows = frappe.get_all(
		"Sales Invoice",
		filters={
			"docstatus": 1,
			"outstanding_amount": (">", 0),
			"due_date": ("<", frappe.utils.today()),
		},
		fields=["name", "outstanding_amount"],
		limit=500,
	)
	return [
		(
			r.name,
			f"فاکتور فروش {r.name} سررسید گذشته است "
			f"(مانده: {format_irr_as_toman(r.outstanding_amount, persian_digits=True, with_unit=True)})",
		)
		for r in rows
	]


def _collect_payment(status: str) -> list[tuple[str, str]]:
	from erpnext.farda_iran.currency.service import format_irr_as_toman

	rows = frappe.get_all(
		"Farda Payment Log",
		filters={"status": status},
		fields=["name", "authority", "amount_irr", "fail_reason"],
		limit=500,
	)
	out = []
	for r in rows:
		toman = format_irr_as_toman(r.amount_irr, persian_digits=True, with_unit=True)
		if status == "Verified":
			out.append((r.name, f"پرداخت {r.authority} تأیید شد ({toman})"))
		else:
			out.append((r.name, f"پرداخت {r.authority} ناموفق بود ({r.fail_reason or 'نامشخص'})"))
	return out


def _collect_stale_drafts(days: int) -> list[tuple[str, str]]:
	cutoff = frappe.utils.add_days(frappe.utils.nowdate(), -days)
	rows = frappe.get_all(
		"Sales Invoice",
		filters={"docstatus": 0, "modified": ("<", cutoff)},
		fields=["name"],
		limit=500,
	)
	return [(r.name, f"فاکتور پیش‌نویس {r.name} بیش از {days} روز در انتظار بررسی است") for r in rows]


def _send_sms(kind: str, subject: str) -> int:
	from erpnext.farda_iran.sms import provider as sms_provider

	try:
		numbers = parse_alert_numbers(os.environ.get("FARDA_ALERT_SMS_NUMBERS"))
	except ValueError as exc:
		frappe.log_error(title="Farda notifications: SMS config", message=str(exc))
		return 0
	if not numbers:
		return 0
	gateway = sms_provider.resolve()
	sent = 0
	for number in numbers:
		result = gateway.send_sms(number, sms_text(kind, subject))
		if result.ok:
			sent += 1
		else:
			frappe.log_error(
				title="Farda notifications: SMS send", message=f"{gateway.name}: {result.error}"
			)
	return sent


def run(kinds: list[str] | None = None, approval_stale_days: int = 7, sms: bool = True) -> dict[str, int]:
	"""Scheduler entry (daily). Returns created-count per trigger kind (+ 'sms').

	`kinds` limits the run (tests/targeted cron); default = all six kinds.
	"""
	from erpnext.farda_iran.cheque.reminders import notify_cheques_due

	kinds = list(kinds or TRIGGER_KINDS)
	unknown = [k for k in kinds if k not in TRIGGER_KINDS]
	if unknown:
		raise ValueError(f"نوع اعلان ناشناخته است: {unknown}")

	counts: dict[str, int] = dict.fromkeys((*TRIGGER_KINDS, "sms"), 0)
	users = _finance_users()

	collectors = {
		"low_stock": _collect_low_stock,
		"invoice_overdue": _collect_overdue,
		"payment_received": lambda: _collect_payment("Verified"),
		"payment_failed": lambda: _collect_payment("Failed"),
		"approval_pending": lambda: _collect_stale_drafts(approval_stale_days),
	}

	for kind in kinds:
		if kind == "cheque_due":
			counts[kind] = notify_cheques_due()
			continue
		if not users:
			continue
		doctype = _DOCTYPE_BY_KIND[kind]
		for docname, subject in collectors[kind]():
			created = _notify(doctype, docname, subject, users)
			counts[kind] += created
			if created and sms:
				counts["sms"] += _send_sms(kind, subject)

	return counts
