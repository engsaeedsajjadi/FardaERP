# Copyright (c) 2026, FardaERP and contributors
# Iranian Stock Movement (کاردکس) presentation layer — SLE rows in a period
# with opening/closing quantity carried across rows, Jalali dates, Toman
# rate/value. Read-only; static parameterized SQL only.

import frappe
from frappe import _

_SQL = """
select
	sle.posting_date            as posting_date,
	sle.posting_time            as posting_time,
	sle.voucher_type            as voucher_type,
	sle.voucher_no              as voucher_no,
	sle.item_code               as item_code,
	sle.warehouse               as warehouse,
	sle.actual_qty              as actual_qty,
	sle.stock_value_difference  as stock_value_difference,
	sle.qty_after_transaction   as qty_after_transaction
from `tabStock Ledger Entry` sle
where coalesce(sle.is_cancelled, 0) = 0
  and sle.company = %(company)s
  and sle.posting_date >= %(from_date)s
  and sle.posting_date <= %(to_date)s
  and sle.item_code = %(item_code)s
  and ( %(warehouse)s is null or sle.warehouse = %(warehouse)s )
order by sle.posting_date, sle.posting_time, sle.creation, sle.name
"""


def _qty_str(qty) -> str:
	q = round(frappe.utils.flt(qty), 3)
	text = f"{q:,.3f}".rstrip("0").rstrip(".")
	return text if text else "0"


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("تاریخ"), "fieldname": "farda_date", "width": 110},
		{"label": _("سند"), "fieldname": "voucher_no", "fieldtype": "Dynamic Link", "options": "voucher_type", "width": 170},
		{"label": _("نوع سند"), "fieldname": "voucher_type", "width": 140},
		{"label": _("کالا"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 170},
		{"label": _("انبار"), "fieldname": "warehouse", "fieldtype": "Link", "options": "Warehouse", "width": 150},
		{"label": _("ورود"), "fieldname": "farda_in", "width": 100},
		{"label": _("خروج"), "fieldname": "farda_out", "width": 100},
		{"label": _("مانده"), "fieldname": "farda_balance", "width": 100},
		{"label": _("نرخ (تومان)"), "fieldname": "farda_rate", "width": 130},
		{"label": _("ارزش (تومان)"), "fieldname": "farda_value", "width": 140},
	]

	company = filters.get("company")
	if not company:
		frappe.throw(_("فیلتر «شرکت» الزامی است"))
	if not filters.get("item_code"):
		frappe.throw(_("فیلتر «کالا» برای کاردکس الزامی است"))
	if not filters.get("from_date") or not filters.get("to_date"):
		frappe.throw(_("«از تاریخ» و «تا تاریخ» الزامی است"))

	# opening balance (before from_date) so the running column is correct
	open_rows = frappe.db.sql(
		"select coalesce(sum(actual_qty), 0) from `tabStock Ledger Entry`"
		" where coalesce(is_cancelled, 0) = 0 and company = %(company)s"
		" and item_code = %(item_code)s and posting_date < %(from_date)s"
		" and ( %(warehouse)s is null or warehouse = %(warehouse)s )",
		{"company": company, "item_code": filters.item_code,
		 "from_date": filters.from_date, "warehouse": filters.get("warehouse") or None},
	)
	running = frappe.utils.flt(open_rows[0][0])

	rows = frappe.db.sql(_SQL, {
		"company": company,
		"from_date": filters.from_date,
		"to_date": filters.to_date,
		"item_code": filters.item_code,
		"warehouse": filters.get("warehouse") or None,
	}, as_dict=True)

	data = [{
		"farda_date": _("افتتاحیه"),
		"voucher_no": "",
		"voucher_type": "",
		"item_code": filters.item_code,
		"warehouse": filters.get("warehouse") or _("همه انبارها"),
		"farda_in": "-", "farda_out": "-",
		"farda_balance": fa(_qty_str(running)),
		"farda_rate": "-", "farda_value": "-",
	}]
	t_in = t_out = t_value = 0.0
	for r in rows:
		qty = frappe.utils.flt(r.actual_qty)
		value = frappe.utils.flt(r.stock_value_difference)
		running += qty
		if qty > 0:
			t_in += qty
		else:
			t_out += -qty
		t_value += value
		data.append({
			"farda_date": format_jalali_date(r.posting_date),
			"voucher_no": r.voucher_no or "",
			"voucher_type": r.voucher_type or "",
			"item_code": r.item_code,
			"warehouse": r.warehouse or "",
			"farda_in": fa(_qty_str(qty)) if qty > 0 else "-",
			"farda_out": fa(_qty_str(-qty)) if qty < 0 else "-",
			"farda_balance": fa(_qty_str(running)),
			"farda_rate": "-",
			"farda_value": fa(toman_str(value, with_unit=False)) if value else "-",
		})

	data.append({
		"farda_date": _("جمع کل"),
		"voucher_no": "",
		"voucher_type": "",
		"item_code": filters.item_code,
		"warehouse": filters.get("warehouse") or _("همه انبارها"),
		"farda_in": fa(_qty_str(t_in)),
		"farda_out": fa(_qty_str(t_out)),
		"farda_balance": fa(_qty_str(running)),
		"farda_rate": "-",
		"farda_value": fa(toman_str(t_value, with_unit=False)),
	})
	return columns, data
