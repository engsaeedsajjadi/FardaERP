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


def _prices(price_list: str | None, codes: list) -> dict:
	if not price_list or not codes:
		return {}
	out = {}
	for p in frappe.get_all(
		"Item Price",
		filters={"price_list": price_list, "item_code": ["in", codes], "selling": 1},
		fields=["item_code", "price_list_rate"],
		order_by="valid_from asc",
	):
		out[p.item_code] = flt(p.price_list_rate)
	return out


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
	prices = _prices(_price_list(customer), codes)
	stock = dict(
		frappe.db.sql(
			"select item_code, sum(actual_qty) from `tabBin` where item_code in %s group by item_code", (codes,)
		)
	)
	for r in rows:
		r.rate = prices.get(r.item_code, 0)
		r.stock = flt(stock.get(r.item_code))
	return rows


def _warehouse(item_code: str, company: str) -> str | None:
	"""Item default for the company → Stock Settings default → first warehouse of the company."""
	wh = frappe.db.get_value("Item Default", {"parent": item_code, "company": company}, "default_warehouse")
	if not wh:
		wh = frappe.db.get_single_value("Stock Settings", "default_warehouse")
		if wh and frappe.db.get_value("Warehouse", wh, "company") != company:
			wh = None
	if not wh:
		wh = frappe.db.get_value("Warehouse", {"company": company, "is_group": 0, "disabled": 0}, "name", order_by="creation asc")
	return wh


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
	prices = _prices(so.selling_price_list, [l["item_code"] for l in lines])
	for l in lines:
		row = {"item_code": l["item_code"], "qty": flt(l["qty"]), "delivery_date": so.delivery_date}
		if frappe.db.get_value("Item", l["item_code"], "is_stock_item"):
			row["warehouse"] = _warehouse(l["item_code"], so.company)
		rate = prices.get(l["item_code"])  # the rate always comes from the price list, never the client
		if rate:
			row["price_list_rate"] = row["rate"] = rate
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
		filters={"owner": frappe.session.user, "transaction_date": ["between", [add_days(nowdate(), -7), nowdate()]]},
		fields=["name", "customer_name", "grand_total", "docstatus", "status", "transaction_date"],
		order_by="creation desc",
		limit_page_length=30,
	)
