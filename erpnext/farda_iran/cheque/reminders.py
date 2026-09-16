"""Cheque due-date reminders — scheduler-driven Notification Log entries."""

from __future__ import annotations

import frappe


def notify_cheques_due(days: int = 7) -> int:
	"""Create in-app notifications for open cheques due within `days`.

	Perf (§ Performance R18): already-notified (cheque, user) pairs are read in
	ONE query (was: one EXISTS per cheque); inserts happen only for pairs not
	already notified (bounded by real due cheques × finance users).
	"""
	from erpnext.farda_iran.doctype.cheque.cheque import get_cheques_due_within_days

	due = get_cheques_due_within_days(days=days)
	users = frappe.get_all(
		"Has Role",
		filters={"role": ("in", ["Accounts Manager", "Accounts User", "System Manager"])},
		pluck="parent",
	)
	users = [u for u in set(users) if u != "Guest" and frappe.db.get_value("User", u, "enabled")]
	if not due or not users:
		return 0

	notified = {
		(r.document_name, r.for_user)
		for r in frappe.get_all(
			"Notification Log",
			filters={
				"document_type": "Cheque",
				"document_name": ("in", [c.name for c in due]),
				"for_user": ("in", users),
				"type": "Alert",
			},
			fields=["document_name", "for_user"],
		)
	}
	created = 0
	for cheque in due:
		for user in users:
			if (cheque.name, user) in notified:
				continue
			frappe.get_doc(
				{
					"doctype": "Notification Log",
					"for_user": user,
					"type": "Alert",
					"document_type": "Cheque",
					"document_name": cheque.name,
					"subject": frappe._(
						f"چک {cheque.cheque_number} سررسید نزدیک دارد ({frappe.utils.formatdate(str(cheque.due_date))})"
					),
				}
			).insert(ignore_permissions=True)
			created += 1
	return created
