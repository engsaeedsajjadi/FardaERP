"""Cheque due-date reminders — scheduler-driven Notification Log entries."""

from __future__ import annotations

import frappe


def notify_cheques_due(days: int = 7) -> int:
	"""Create in-app notifications for open cheques due within `days`."""
	from erpnext.farda_iran.doctype.cheque.cheque import get_cheques_due_within_days

	due = get_cheques_due_within_days(days=days)
	users = frappe.get_all(
		"Has Role",
		filters={"role": ("in", ["Accounts Manager", "Accounts User", "System Manager"])},
		pluck="parent",
	)
	users = [u for u in set(users) if u != "Guest" and frappe.db.get_value("User", u, "enabled")]
	created = 0
	for cheque in due:
		already = frappe.db.exists(
			"Notification Log",
			{"document_type": "Cheque", "document_name": cheque.name, "for_user": ("in", users), "type": "Alert"},
		)
		if already:
			continue
		for user in users:
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
