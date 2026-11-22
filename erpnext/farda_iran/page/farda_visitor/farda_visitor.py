"""ویزیتور: سفارش‌گیری سریع از موبایل (CORE-038).

Thin, permission-respecting wrappers: every read goes through frappe.get_list
(user permissions apply) and the order is a normal Sales Order inserted as
the current user — nothing here bypasses permissions.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, nowdate


def _company() -> str:
	return frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")


@frappe.whitelist()
def customers(txt: str = "") -> list:
	txt = f"%{(txt or '').strip()}%"
	return frappe.get_list(
		"Customer",
		filters={"disabled": 0},
		or_filters={"customer_name": ["like", txt], "name": ["like", txt], "mobile_no": ["like", txt]},
		fields=["name", "customer_name", "mobile_no", "territory"],
		order_by="modified desc",
		limit_page_length=20,
	)


def _price_list(customer: str | None) -> str | None:
	pl = customer and frappe.db.get_value("Customer", customer, "default_price_list")
	return pl or frappe.db.get_single_value("Selling Settings", "selling_price_list")


@frappe.whitelist()
def items(txt: str = "", customer: str | None = None) -> list:
	txt = f"%{(txt or '').strip()}%"
	rows = frappe.get_list(
		"Item",
		filters={"disabled": 0, "is_sales_item": 1, "has_variants": 0},
		or_filters={"item_name": ["like", txt], "item_code": ["like", txt]},
		fields=["item_code", "item_name", "stock_uom", "image"],
		order_by="item_name asc",
		limit_page_length=30,
	)
	if not rows:
		return rows
	codes = [r.item_code for r in rows]
	pl = _price_list(customer)
	prices = {}
	if pl:
		for p in frappe.get_all(
			"Item Price",
			filters={"price_list": pl, "item_code": ["in", codes], "selling": 1},
			fields=["item_code", "price_list_rate"],
			order_by="valid_from asc",
		):
			prices[p.item_code] = flt(p.price_list_rate)
	stock = dict(
		frappe.db.sql(
			"select item_code, sum(actual_qty) from `tabBin` where item_code in %s group by item_code", (codes,)
		)
	)
	for r in rows:
		r.rate = prices.get(r.item_code, 0)
		r.stock = flt(stock.get(r.item_code))
	return rows


@frappe.whitelist(methods=["POST"])
def create_order(customer: str, lines: str | list, notes: str = "", submit: int = 0) -> dict:
	lines = json.loads(lines) if isinstance(lines, str) else lines
	lines = [l for l in lines or [] if flt(l.get("qty")) > 0]
	if not customer or not lines:
		frappe.throw(_("مشتری و دست‌کم یک قلم کالا لازم است"))
	so = frappe.new_doc("Sales Order")
	so.customer = customer
	so.company = _company()
	so.transaction_date = nowdate()
	so.delivery_date = add_days(nowdate(), 1)
	so.selling_price_list = _price_list(customer) or so.selling_price_list
	so.order_type = "Sales"
	for l in lines:
		row = {"item_code": l["item_code"], "qty": flt(l["qty"]), "delivery_date": so.delivery_date}
		if flt(l.get("rate")):
			row["rate"] = flt(l["rate"])
		so.append("items", row)
	so.set_missing_values()
	so.insert()  # normal permissions
	if notes:
		so.add_comment("Comment", frappe.utils.escape_html(notes))
	if cint(submit):
		so.submit()
	return {"name": so.name, "grand_total": so.grand_total, "docstatus": so.docstatus}


@frappe.whitelist()
def my_orders() -> list:
	return frappe.get_list(
		"Sales Order",
		filters={"owner": frappe.session.user, "transaction_date": [">=", add_days(nowdate(), -7)]},
		fields=["name", "customer_name", "grand_total", "docstatus", "status", "transaction_date"],
		order_by="creation desc",
		limit_page_length=30,
	)
