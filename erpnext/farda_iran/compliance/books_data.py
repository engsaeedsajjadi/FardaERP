"""Frappe data access shared by the legal-book reports."""

import frappe


def account_labels(company: str) -> tuple[list[dict], dict[str, str]]:
	accounts = frappe.get_all(
		"Account", filters={"company": company}, fields=["name", "parent_account", "account_name", "account_number"]
	)
	labels = {
		a.name: (f"{a.account_number} - {a.account_name}" if a.account_number else a.account_name) for a in accounts
	}
	return [dict(a) for a in accounts], labels


def gl_rows(company: str, from_date, to_date) -> list[dict]:
	return frappe.db.sql(
		"""select posting_date, account, debit, credit
		from `tabGL Entry`
		where company = %(company)s and is_cancelled = 0
		  and posting_date between %(from_date)s and %(to_date)s
		order by posting_date, creation""",
		{"company": company, "from_date": from_date, "to_date": to_date},
		as_dict=True,
	) or []


def opening_balances(company: str, from_date, amap: dict[str, str]) -> dict[str, int]:
	out: dict[str, int] = {}
	for r in frappe.db.sql(
		"""select account, sum(debit) - sum(credit) as bal
		from `tabGL Entry`
		where company = %(company)s and is_cancelled = 0 and posting_date < %(from_date)s
		group by account""",
		{"company": company, "from_date": from_date},
		as_dict=True,
	):
		key = amap.get(r.account, r.account)
		out[key] = out.get(key, 0) + int(round(r.bal or 0))
	return out


def common_filters(filters) -> frappe._dict:
	f = frappe._dict(filters or {})
	if not f.get("company"):
		f.company = frappe.defaults.get_user_default("Company")
	if not f.get("from_date") or not f.get("to_date"):
		frappe.throw("بازهٔ تاریخ را مشخص کنید.")
	f.level = max(0, int(f.get("account_level") or 1))
	f.rows_per_page = max(5, int(f.get("rows_per_page") or 30))
	return f
