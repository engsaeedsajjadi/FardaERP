# Copyright (c) 2026, FardaERP and contributors
# دفتر کل قانونی — the journal's daily lines posted per ledger account with
# opening balance and running balance (تشخیص بد/بس).

from frappe import _


def execute(filters=None):
	from erpnext.farda_iran.compliance.books_data import account_labels, common_filters, gl_rows, opening_balances
	from erpnext.farda_iran.compliance.legal_books import ancestor_map, journal, ledger
	from erpnext.farda_iran.jalali.service import format_jalali

	f = common_filters(filters)
	accounts, labels = account_labels(f.company)
	amap = ancestor_map(accounts, f.level)
	jrows = journal(gl_rows(f.company, f.from_date, f.to_date), amap, f.rows_per_page)
	books = ledger(jrows, opening_balances(f.company, f.from_date, amap))
	only = amap.get(f.account) if f.get("account") else None
	data = []
	for acc, lines in books.items():
		if only and acc != only:
			continue
		data.append({"account": labels.get(acc, acc), "bold": 1, "indent": 0})
		dr = cr = 0
		for ln in lines:
			dr += ln["debit"]
			cr += ln["credit"]
			data.append({
				"account": "",
				"date": format_jalali(ln["date"], "{jy:04d}/{jm:02d}/{jd:02d}") if ln["date"] else "",
				"doc_no": ln["doc_no"],
				"page": ln["page"],
				"desc": ln["desc"],
				"debit": ln["debit"],
				"credit": ln["credit"],
				"balance": ln["balance"],
				"side": ln["side"],
				"indent": 1,
			})
		last = lines[-1] if lines else {"balance": 0, "side": "—"}
		data.append({"account": "", "desc": "جمع گردش و مانده", "debit": dr, "credit": cr, "balance": last["balance"], "side": last["side"], "bold": 1, "indent": 1})
	columns = [
		{"label": _("حساب کل"), "fieldname": "account", "fieldtype": "Data", "width": 220},
		{"label": _("تاریخ"), "fieldname": "date", "fieldtype": "Data", "width": 100},
		{"label": _("سند روزانه"), "fieldname": "doc_no", "fieldtype": "Int", "width": 90},
		{"label": _("صفحهٔ روزنامه"), "fieldname": "page", "fieldtype": "Int", "width": 90},
		{"label": _("شرح"), "fieldname": "desc", "fieldtype": "Data", "width": 200},
		{"label": _("بدهکار (ریال)"), "fieldname": "debit", "fieldtype": "Int", "width": 150},
		{"label": _("بستانکار (ریال)"), "fieldname": "credit", "fieldtype": "Int", "width": 150},
		{"label": _("مانده (ریال)"), "fieldname": "balance", "fieldtype": "Int", "width": 150},
		{"label": _("تشخیص"), "fieldname": "side", "fieldtype": "Data", "width": 60},
	]
	return columns, data
