"""Frappe-side KPI queries + whitelisted dashboard endpoint (real data only)."""

from __future__ import annotations

import frappe

RATE_LIMIT = 60
RATE_WINDOW = 60


def _num(sql: str, params: dict | None = None) -> float:
	v = frappe.db.sql(sql, params or {})
	return float(v[0][0] or 0) if v else 0.0


def _cond(company: str | None, alias: str | None = None) -> tuple[str, dict]:
	col = f"{alias}.company" if alias else "company"
	if company and frappe.db.exists("Company", company):
		return f" and {col} = %(company)s", {"company": company}
	return "", {}


def _params(company: str | None, from_date: str, to_date: str, alias: str | None = None) -> dict:
	_, p = _cond(company, alias)
	return {"from": from_date, "to": to_date, **p}


def collect_kpis(company: str | None = None, from_date: str | None = None, to_date: str | None = None) -> dict:
	"""Raw IRR figures from REAL documents/GL/bins for the given window."""
	from_date = from_date or frappe.utils.get_first_day(frappe.utils.today()).isoformat()
	to_date = to_date or frappe.utils.today()

	cond_si, _ = _cond(company, "si")
	cond_pi, _ = _cond(company, "pi")
	cond_ge, _ = _cond(company, "ge")
	cond_pl, _ = _cond(company)
	p_si = _params(company, from_date, to_date, "si")
	p_pi = _params(company, from_date, to_date, "pi")
	p_ge = _params(company, from_date, to_date, "ge")
	p_pl = _params(company, from_date, to_date)

	vat_account = frappe.db.get_single_value("Farda VAT Settings", "vat_account")
	vat_sales = vat_purchases = 0.0
	if vat_account:
		vat_sales = _num(
			f"""
			select sum(t.base_tax_amount) from `tabSales Taxes and Charges` t
			join `tabSales Invoice` si on si.name = t.parent and si.docstatus = 1{cond_si}
			where t.account_head = %(vat)s and si.posting_date between %(from)s and %(to)s
			""",
			{"vat": vat_account, **p_si},
		)
		vat_purchases = _num(
			f"""
			select sum(t.base_tax_amount) from `tabPurchase Taxes and Charges` t
			join `tabPurchase Invoice` pi on pi.name = t.parent and pi.docstatus = 1{cond_pi}
			where t.account_head = %(vat)s and pi.posting_date between %(from)s and %(to)s
			""",
			{"vat": vat_account, **p_pi},
		)

	cash_accounts = frappe.get_all(
		"Account",
		filters={
			"account_type": ["in", ("Cash", "Bank")],
			"is_group": 0,
			**({"company": company} if company else {}),
		},
		pluck="name",
	)
	cash_balance = 0.0
	if cash_accounts:
		cash_balance = _num(
			"""
			select sum(debit - credit) from `tabGL Entry`
			where account in %(accounts)s and is_cancelled = 0
			""",
			{"accounts": tuple(cash_accounts)},
		)

	income = _num(
		f"""
		select sum(ge.credit - ge.debit) from `tabGL Entry` ge
		join `tabAccount` a on a.name = ge.account
		where a.root_type = 'Income' and ge.is_cancelled = 0
		  and ge.posting_date between %(from)s and %(to)s{cond_ge}
		""",
		p_ge,
	)
	expense = _num(
		f"""
		select sum(ge.debit - ge.credit) from `tabGL Entry` ge
		join `tabAccount` a on a.name = ge.account
		where a.root_type = 'Expense' and ge.is_cancelled = 0
		  and ge.posting_date between %(from)s and %(to)s{cond_ge}
		""",
		p_ge,
	)

	return {
		"sales": _num(
			f"select sum(base_grand_total) from `tabSales Invoice` where docstatus = 1"
			f" and posting_date between %(from)s and %(to)s{cond_pl}",
			p_pl,
		),
		"purchases": _num(
			f"select sum(base_grand_total) from `tabPurchase Invoice` where docstatus = 1"
			f" and posting_date between %(from)s and %(to)s{cond_pl}",
			p_pl,
		),
		"income": income,
		"expense": expense,
		"receivables": _num(
			f"select sum(outstanding_amount) from `tabSales Invoice` where docstatus = 1"
			f" and outstanding_amount > 0{cond_pl}",
			p_pl,
		),
		"payables": _num(
			f"select sum(outstanding_amount) from `tabPurchase Invoice` where docstatus = 1"
			f" and outstanding_amount > 0{cond_pl}",
			p_pl,
		),
		"vat_sales": vat_sales,
		"vat_purchases": vat_purchases,
		"cash_balance": cash_balance,
		"inventory_value": _num("select sum(stock_value) from `tabBin`"),
		"orders": _num(
			f"select sum(base_grand_total) from `tabSales Order` where docstatus = 1"
			f" and status not in ('Completed','Closed','Cancelled'){cond_pl}",
			p_pl,
		),
		"window": {"from": from_date, "to": to_date},
		"company": company or frappe.db.get_value("Company", {"is_group": 0}, "name"),
	}


@frappe.whitelist(methods=["GET", "POST"])
def farda_kpis(company: str | None = None, from_date: str | None = None, to_date: str | None = None) -> dict:
	"""Executive KPIs (real data) with Persian Toman strings."""
	from erpnext.farda_iran.api.limiter import is_allowed
	from erpnext.farda_iran.dashboard.kpis_pure import build_kpi_payload

	if not is_allowed("dashboard", frappe.session.user, RATE_LIMIT, RATE_WINDOW):
		frappe.throw(
			frappe._("تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید."),
			frappe.RateLimitExceededError,
		)
	raw = collect_kpis(company, from_date, to_date)
	return build_kpi_payload(raw)
