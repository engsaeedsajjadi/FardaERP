# Copyright (c) 2026, FardaERP and contributors
# فهرست معاملات فصلی (ماده ۱۶۹) — per-counterparty totals for one Jalali season,
# rial amounts as plain integers so the Excel export can be pasted into the
# tax portal template. Sales registered in سامانهٔ مودیان are excluded by
# default (they already count as filed).

import frappe
from frappe import _


def _season_range(year: int, season: int):
	from erpnext.farda_iran.compliance.seasonal import season_months
	from erpnext.farda_iran.jalali.service import jalali_month_length, jalali_to_date

	m1, m2 = season_months(season)
	return jalali_to_date(year, m1, 1), jalali_to_date(year, m2, jalali_month_length(year, m2))


def _invoices(kind, company, start, end, include_moadian):
	if kind == "فروش":
		dt, party = "Sales Invoice", "customer"
		extra = "" if include_moadian else " and ifnull(farda_moadian_taxid, '') = ''"
	else:
		dt, party, extra = "Purchase Invoice", "supplier", ""
	cond = " and company = %(company)s" if company else ""
	return frappe.db.sql(
		f"""select {party} as party, base_net_total as net, base_discount_amount as discount,
		       base_total_taxes_and_charges as tax, base_grand_total as total
		from `tab{dt}`
		where docstatus = 1 and posting_date between %(start)s and %(end)s{cond}{extra}""",
		{"company": company, "start": start, "end": end},
		as_dict=True,
	) or []


def _parties(kind, names):
	if not names:
		return {}
	dt = "Customer" if kind == "فروش" else "Supplier"
	name_field = "customer_name" if dt == "Customer" else "supplier_name"
	rows = frappe.get_all(
		dt,
		filters={"name": ["in", list(names)]},
		fields=["name", f"{name_field} as title", "farda_person_type", "farda_national_id", "farda_legal_id", "farda_economic_code", "farda_postal_code", "mobile_no"],
	)
	addr = {}
	for a in frappe.db.sql(
		"""select dl.link_name, a.city, a.pincode, a.phone
		from `tabAddress` a join `tabDynamic Link` dl on dl.parent = a.name and dl.parenttype = 'Address'
		where dl.link_doctype = %(dt)s and dl.link_name in %(names)s
		order by a.is_primary_address desc, a.modified desc""",
		{"dt": dt, "names": tuple(names)},
		as_dict=True,
	):
		addr.setdefault(a.link_name, a)
	out = {}
	for r in rows:
		a = addr.get(r.name) or {}
		out[r.name] = {
			"name": r.title,
			"person_type": r.farda_person_type,
			"national_id": r.farda_national_id,
			"legal_id": r.farda_legal_id,
			"economic_code": r.farda_economic_code,
			"postal_code": r.farda_postal_code or a.get("pincode"),
			"city": a.get("city"),
			"phone": a.get("phone") or r.mobile_no,
		}
	return out


def execute(filters=None):
	from erpnext.farda_iran.compliance.seasonal import DEFAULT_AGGREGATE_LIMIT_RIAL, build_rows
	from erpnext.farda_iran.jalali.service import jalali_today

	f = frappe._dict(filters or {})
	year = int(f.get("year") or jalali_today()[0])
	season = int(f.get("season") or 1)
	kind = f.get("kind") or "خرید"
	limit = int(f.get("aggregate_limit") or DEFAULT_AGGREGATE_LIMIT_RIAL)
	start, end = _season_range(year, season)
	invoices = _invoices(kind, f.get("company"), start, end, bool(f.get("include_moadian")))
	rows = build_rows(invoices, _parties(kind, {i.party for i in invoices}), limit)

	columns = [
		{"label": _("ردیف"), "fieldname": "idx", "fieldtype": "Data", "width": 60},
		{"label": _("نوع شخص"), "fieldname": "person_type", "fieldtype": "Data", "width": 100},
		{"label": _("کد ملی / شناسه ملی"), "fieldname": "identity", "fieldtype": "Data", "width": 130},
		{"label": _("کد اقتصادی"), "fieldname": "economic_code", "fieldtype": "Data", "width": 120},
		{"label": _("نام طرف معامله"), "fieldname": "party_name", "fieldtype": "Data", "width": 220},
		{"label": _("کد پستی"), "fieldname": "postal_code", "fieldtype": "Data", "width": 110},
		{"label": _("شهر"), "fieldname": "city", "fieldtype": "Data", "width": 90},
		{"label": _("تلفن"), "fieldname": "phone", "fieldtype": "Data", "width": 110},
		{"label": _("تعداد فاکتور"), "fieldname": "count", "fieldtype": "Int", "width": 90},
		{"label": _("مبلغ قبل از مالیات (ریال)"), "fieldname": "net", "fieldtype": "Int", "width": 150},
		{"label": _("تخفیف (ریال)"), "fieldname": "discount", "fieldtype": "Int", "width": 110},
		{"label": _("مالیات و عوارض ارزش افزوده (ریال)"), "fieldname": "tax", "fieldtype": "Int", "width": 170},
		{"label": _("مبلغ کل (ریال)"), "fieldname": "total", "fieldtype": "Int", "width": 150},
		{"label": _("وضعیت"), "fieldname": "status", "fieldtype": "Data", "width": 220},
	]
	incomplete = sum(1 for r in rows if r["status"].startswith("اطلاعات"))
	note = (
		f"فصل {['', 'بهار', 'تابستان', 'پاییز', 'زمستان'][season]} {year} — {kind}. "
		+ ("فروش‌های ثبت‌شده در سامانهٔ مودیان کنار گذاشته شده‌اند، چون ثبت آن‌ها به منزلهٔ ارسال فهرست معاملات است. " if kind == "فروش" and not f.get("include_moadian") else "")
		+ (f"{incomplete} طرف معامله اطلاعات هویتی ناقص دارند؛ قبل از ارسال تکمیل کنید. " if incomplete else "")
		+ "سقف معاملات تجمیعی را هر سال با آخرین بخشنامه تطبیق دهید."
	)
	return columns, rows, note
