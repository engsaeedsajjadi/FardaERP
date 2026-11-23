"""Ready Persian approval workflows (گردش‌های تأیید آماده) — CORE-046.

Installed INACTIVE: nothing changes for users until a System Manager opens the
workflow and ticks «فعال است». Re-running is idempotent and never overwrites a
workflow an admin has already edited (only missing ones are created).

Amount limits are rial and live in the transition conditions, so an admin can
change them in the Workflow form without code.
"""

from __future__ import annotations

CEO_ROLE = "Farda CEO"  # مدیرعامل
UNIT_ROLE = "Farda Unit Manager"  # مدیر واحد
CEO_LIMIT_RIAL = 5_000_000_000  # above this, the CEO approves too (۵۰۰ میلیون تومان)

STATES = {
	"پیش‌نویس": "",
	"در انتظار تأیید مدیر واحد": "Warning",
	"در انتظار تأیید مدیر خرید": "Warning",
	"در انتظار تأیید مدیر مالی": "Warning",
	"در انتظار تأیید مدیرعامل": "Warning",
	"تأیید شده": "Success",
	"رد شده": "Danger",
	"لغو شده": "Inverse",
}
ACTIONS = ["ارسال برای تأیید", "تأیید", "رد", "ارسال دوباره", "لغو"]


def _approve_chain(first_state, first_role, final_role, amount_field, extra_cond=""):
	"""first approver → (CEO above the limit) → approved."""
	small = f"doc.{amount_field} <= {CEO_LIMIT_RIAL}{extra_cond}"
	big = f"doc.{amount_field} > {CEO_LIMIT_RIAL}"
	return [
		(first_state, "تأیید", "تأیید شده", first_role, small, 0),
		(first_state, "تأیید", "در انتظار تأیید مدیرعامل", first_role, big, 0),
		(first_state, "رد", "رد شده", first_role, "", 1),
		("در انتظار تأیید مدیرعامل", "تأیید", "تأیید شده", CEO_ROLE, "", 0),
		("در انتظار تأیید مدیرعامل", "رد", "رد شده", CEO_ROLE, "", 1),
	]


WORKFLOWS = [
	{
		"name": "تأیید درخواست کالا",
		"doctype": "Material Request",
		"states": [
			("پیش‌نویس", 0, "All"),
			("در انتظار تأیید مدیر واحد", 0, UNIT_ROLE),
			("در انتظار تأیید مدیر مالی", 0, "Accounts Manager"),
			("تأیید شده", 1, "Accounts Manager"),
			("رد شده", 0, "All"),
			("لغو شده", 2, "Accounts Manager"),
		],
		"transitions": [
			("پیش‌نویس", "ارسال برای تأیید", "در انتظار تأیید مدیر واحد", "All", "", 1),
			("در انتظار تأیید مدیر واحد", "تأیید", "در انتظار تأیید مدیر مالی", UNIT_ROLE, "", 0),
			("در انتظار تأیید مدیر واحد", "رد", "رد شده", UNIT_ROLE, "", 1),
			("در انتظار تأیید مدیر مالی", "تأیید", "تأیید شده", "Accounts Manager", "", 0),
			("در انتظار تأیید مدیر مالی", "رد", "رد شده", "Accounts Manager", "", 1),
			("رد شده", "ارسال دوباره", "در انتظار تأیید مدیر واحد", "All", "", 1),
			("تأیید شده", "لغو", "لغو شده", "Accounts Manager", "", 1),
		],
	},
	{
		"name": "تأیید سفارش خرید",
		"doctype": "Purchase Order",
		"states": [
			("پیش‌نویس", 0, "Purchase User"),
			("در انتظار تأیید مدیر خرید", 0, "Purchase Manager"),
			("در انتظار تأیید مدیرعامل", 0, CEO_ROLE),
			("تأیید شده", 1, "Purchase Manager"),
			("رد شده", 0, "Purchase User"),
			("لغو شده", 2, "Purchase Manager"),
		],
		"transitions": [
			("پیش‌نویس", "ارسال برای تأیید", "در انتظار تأیید مدیر خرید", "Purchase User", "", 1),
			*_approve_chain("در انتظار تأیید مدیر خرید", "Purchase Manager", CEO_ROLE, "base_grand_total"),
			("رد شده", "ارسال دوباره", "در انتظار تأیید مدیر خرید", "Purchase User", "", 1),
			("تأیید شده", "لغو", "لغو شده", "Purchase Manager", "", 1),
		],
	},
	{
		"name": "تأیید پرداخت",
		"doctype": "Payment Entry",
		"states": [
			("پیش‌نویس", 0, "Accounts User"),
			("در انتظار تأیید مدیر مالی", 0, "Accounts Manager"),
			("در انتظار تأیید مدیرعامل", 0, CEO_ROLE),
			("تأیید شده", 1, "Accounts Manager"),
			("رد شده", 0, "Accounts User"),
			("لغو شده", 2, "Accounts Manager"),
		],
		"transitions": [
			("پیش‌نویس", "ارسال برای تأیید", "در انتظار تأیید مدیر مالی", "Accounts User", "", 1),
			# receipts never need the CEO; payments above the limit do
			("در انتظار تأیید مدیر مالی", "تأیید", "تأیید شده", "Accounts Manager",
				f"doc.payment_type != 'Pay' or doc.base_paid_amount <= {CEO_LIMIT_RIAL}", 0),
			("در انتظار تأیید مدیر مالی", "تأیید", "در انتظار تأیید مدیرعامل", "Accounts Manager",
				f"doc.payment_type == 'Pay' and doc.base_paid_amount > {CEO_LIMIT_RIAL}", 0),
			("در انتظار تأیید مدیر مالی", "رد", "رد شده", "Accounts Manager", "", 1),
			("در انتظار تأیید مدیرعامل", "تأیید", "تأیید شده", CEO_ROLE, "", 0),
			("در انتظار تأیید مدیرعامل", "رد", "رد شده", CEO_ROLE, "", 1),
			("رد شده", "ارسال دوباره", "در انتظار تأیید مدیر مالی", "Accounts User", "", 1),
			("تأیید شده", "لغو", "لغو شده", "Accounts Manager", "", 1),
		],
	},
]


def _ensure_role(name: str, desk: bool = True) -> None:
	import frappe

	if not frappe.db.exists("Role", name):
		frappe.get_doc({"doctype": "Role", "role_name": name, "desk_access": 1 if desk else 0}).insert(ignore_permissions=True)


def ensure_workflows() -> None:
	import frappe

	if not frappe.db.exists("DocType", "Workflow"):
		return
	_ensure_role(CEO_ROLE)
	_ensure_role(UNIT_ROLE)
	for state, style in STATES.items():
		if not frappe.db.exists("Workflow State", state):
			frappe.get_doc({"doctype": "Workflow State", "workflow_state_name": state, "style": style}).insert(ignore_permissions=True)
	for action in ACTIONS:
		if not frappe.db.exists("Workflow Action Master", action):
			frappe.get_doc({"doctype": "Workflow Action Master", "workflow_action_name": action}).insert(ignore_permissions=True)
	for wf in WORKFLOWS:
		if frappe.db.exists("Workflow", wf["name"]) or not frappe.db.exists("DocType", wf["doctype"]):
			continue
		doc = frappe.get_doc({
			"doctype": "Workflow",
			"workflow_name": wf["name"],
			"document_type": wf["doctype"],
			"is_active": 0,
			"override_status": 0,
			"send_email_alert": 0,
			"workflow_state_field": "workflow_state",
		})
		for state, docstatus, role in wf["states"]:
			doc.append("states", {"state": state, "doc_status": str(docstatus), "allow_edit": role})
		for state, action, nxt, role, cond, self_ok in wf["transitions"]:
			doc.append("transitions", {
				"state": state, "action": action, "next_state": nxt, "allowed": role,
				"condition": cond or None, "allow_self_approval": self_ok,
			})
		doc.insert(ignore_permissions=True)
