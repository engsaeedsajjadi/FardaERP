# Copyright (c) 2026, FardaERP and contributors
# Iranian Stock Balance presentation layer — per (item, warehouse) quantity
# and valuation as of a date, aggregated from Stock Ledger Entry, with Jalali
# last-movement dates and Toman valuation via the central currency service.
# Read-only; fully static parameterized SQL (no dynamic query assembly).

import frappe
from frappe import _

# stock value at a date == cumulative stock_value_difference over SLEs
# (this is exactly how Bin.stock_value is maintained upstream), so the
# aggregate below is valid for historical as-on dates as well as today.
_SQL = """
select
	sle.item_code                              as item_code,
	sle.warehouse                              as warehouse,
	coalesce(i.item_name, sle.item_code)       as item_name,
	coalesce(i.stock_uom, '')                  as stock_uom,
	coalesce(i.item_group, '')                 as item_group,
	sum(sle.actual_qty)                        as qty,
	sum(sle.stock_value_difference)            as stock_value,
	max(sle.posting_date)                      as last_move
from `tabStock Ledger Entry` sle
left join `tabItem` i on i.name = sle.item_code
where coalesce(sle.is_cancelled, 0) = 0
  and sle.company = %(company)s
  and sle.posting_date <= %(as_on)s
  and ( %(item_code)s is null   or sle.item_code = %(item_code)s )
  and ( %(warehouse)s is null   or sle.warehouse = %(warehouse)s )
  and ( %(item_group)s is null  or i.item_group  = %(item_group)s )
group by sle.item_code, sle.warehouse, i.item_name, i.stock_uom, i.item_group
having sum(sle.actual_qty) <> 0 or sum(sle.stock_value_difference) <> 0
order by sle.item_code, sle.warehouse
"""


def _qty_str(qty) -> str:
	"""Quantity as a compact display string (up to 3 decimals), Persian digits."""
	q = round(frappe.utils.flt(qty), 3)
	text = f"{q:,.3f}".rstrip("0").rstrip(".")
	return text if text else "0"


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("کالا"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 220},
		{"label": _("نام کالا"), "fieldname": "item_name", "width": 200},
		{"label": _("انبار"), "fieldname": "warehouse", "fieldtype": "Link", "options": "Warehouse", "width": 160},
		{"label": _("گروه کالا"), "fieldname": "item_group", "width": 120},
		{"label": _("واحد"), "fieldname": "stock_uom", "width": 90},
		{"label": _("موجودی"), "fieldname": "farda_qty", "width": 120},
		{"label": _("ارزش موجودی (تومان)"), "fieldname": "farda_value", "width": 160},
		{"label": _("آخرین حرکت"), "fieldname": "farda_last_move", "width": 120},
	]

	company = filters.get("company")
	if not company:
		frappe.throw(_("فیلتر «شرکت» الزامی است"))

	rows = frappe.db.sql(
		_SQL,
		{
			"company": company,
			"as_on": filters.get("as_on") or frappe.utils.nowdate(),
			"item_code": filters.get("item_code") or None,
			"warehouse": filters.get("warehouse") or None,
			"item_group": filters.get("item_group") or None,
		},
		as_dict=True,
	)

	data = []
	t_qty = 0.0
	t_value = 0.0
	for r in rows:
		qty = frappe.utils.flt(r.qty)
		value = frappe.utils.flt(r.stock_value)
		t_qty += qty
		t_value += value
		data.append({
			"item_code": r.item_code,
			"item_name": r.item_name or "",
			"warehouse": r.warehouse or "",
			"item_group": r.item_group or "",
			"stock_uom": r.stock_uom or "",
			"farda_qty": fa(_qty_str(qty)),
			"farda_value": fa(toman_str(value, with_unit=False)) if value else "-",
			"farda_last_move": format_jalali_date(r.last_move) if r.last_move else "",
		})

	as_on_label = format_jalali_date(filters.get("as_on") or frappe.utils.nowdate())
	data.append({
		"item_code": _("جمع کل"),
		"item_name": f"{_('تا تاریخ')} {as_on_label}",
		"warehouse": "",
		"item_group": "",
		"stock_uom": "",
		"farda_qty": fa(_qty_str(t_qty)),
		"farda_value": fa(toman_str(t_value, with_unit=False)),
		"farda_last_move": "",
	})
	return columns, data
