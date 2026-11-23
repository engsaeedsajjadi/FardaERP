# Copyright (c) 2026, FardaERP and contributors
# دفتر روزنامهٔ قانونی — daily document per day, gross debit/credit per
# ledger account (حساب کل), running row and page numbers, rial amounts.

from frappe import _


def execute(filters=None):
	from erpnext.farda_iran.compliance.books_data import account_labels, common_filters, gl_rows
	from erpnext.farda_iran.compliance.legal_books import ancestor_map, journal
	from erpnext.farda_iran.jalali.service import format_jalali

	f = common_filters(filters)
	accounts, labels = account_labels(f.company)
	amap = ancestor_map(accounts, f.level)
	rows = journal(gl_rows(f.company, f.from_date, f.to_date), amap, f.rows_per_page)
	data = []
	for r in rows:
		total = r["kind"] == "total"
		data.append({
			"page": r["page"],
			"doc_no": r["doc_no"],
			"row": r["row"],
			"date": format_jalali(r["date"], "{jy:04d}/{jm:02d}/{jd:02d}"),
			"account": "جمع سند روزانه" if total else labels.get(r["account"], r["account"]),
			"debit": r["debit"],
			"credit": r["credit"],
			"bold": 1 if total else 0,
		})
	columns = [
		{"label": _("صفحه"), "fieldname": "page", "fieldtype": "Int", "width": 70},
		{"label": _("شمارهٔ سند روزانه"), "fieldname": "doc_no", "fieldtype": "Int", "width": 110},
		{"label": _("ردیف"), "fieldname": "row", "fieldtype": "Int", "width": 70},
		{"label": _("تاریخ"), "fieldname": "date", "fieldtype": "Data", "width": 100},
		{"label": _("شرح (حساب کل)"), "fieldname": "account", "fieldtype": "Data", "width": 300},
		{"label": _("بدهکار (ریال)"), "fieldname": "debit", "fieldtype": "Int", "width": 160},
		{"label": _("بستانکار (ریال)"), "fieldname": "credit", "fieldtype": "Int", "width": 160},
	]
	tdr = sum(r["debit"] for r in rows if r["kind"] == "line")
	tcr = sum(r["credit"] for r in rows if r["kind"] == "line")
	note = f"جمع گردش دوره: بدهکار {tdr:,} — بستانکار {tcr:,} ریال" + ("" if tdr == tcr else " — ⚠ جمع بدهکار و بستانکار برابر نیست")
	return columns, data, note
