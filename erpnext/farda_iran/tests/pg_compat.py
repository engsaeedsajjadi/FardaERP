"""PostgreSQL compatibility shims for Gate-5 runtime validation.

FardaERP's production database is MariaDB (docs/VERSIONS.md). The Gate-5
sandbox validates on PostgreSQL because that is what the constrained CI
environment provides. ERPNext v16.34.2 has a small number of SQL constructs
that lenient MariaDB accepts but strict PostgreSQL rejects. This module
monkey-patches ONLY those three functions at runtime — no upstream file is
modified — so the full smoke suite can run on PostgreSQL:

  PG-1  erpnext/stock/stock_balance.py::get_reserved_qty
        uses MySQL `if()` function → CASE WHEN (works on both DBs)

  PG-2  erpnext/controllers/stock_controller.py::StockController.
        set_landed_cost_voucher_amount — SUM(x) + bare x without
        GROUP BY → adds GROUP BY cost_center

  PG-3  erpnext/accounts/general_ledger.py::validate_against_pcv
        aggregate get_value + implicit ORDER BY creation → order_by=""

  PG-4  erpnext/stock/doctype/stock_closing_entry/stock_closing_entry.py::
        get_closing_entry_for_closed_period — same aggregate + ORDER BY issue

Each patch documents the upstream finding so it can be reported upstream
and dropped when fixed. Applied only when site db_type == "postgres".
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.query_builder.functions import Sum
from frappe.utils import flt, getdate

_APPLIED = False


def _patch_get_reserved_qty():
	import erpnext.stock.stock_balance as sb

	def get_reserved_qty(item_code, warehouse):
		dont_reserve_on_return = frappe.get_cached_value(
			"Selling Settings", "Selling Settings", "dont_reserve_sales_order_qty_on_sales_return"
		)
		reserved_qty = frappe.db.sql(
			f"""
			select
				sum(dnpi_qty * ((so_item_qty - so_item_delivered_qty - CASE WHEN dont_reserve_qty_on_return <> 0 THEN so_item_returned_qty ELSE 0 END) / so_item_qty))
			from
				(
					(select
						qty as dnpi_qty,
						(
							select qty from "tabSales Order Item"
							where name = dnpi.parent_detail_docname
							and (delivered_by_supplier is null or delivered_by_supplier = 0)
						) as so_item_qty,
						(
							select delivered_qty from "tabSales Order Item"
							where name = dnpi.parent_detail_docname
							and delivered_by_supplier = 0
						) as so_item_delivered_qty,
						(
							select returned_qty from "tabSales Order Item"
							where name = dnpi.parent_detail_docname
							and delivered_by_supplier = 0
						) as so_item_returned_qty,
						{dont_reserve_on_return} as dont_reserve_qty_on_return,
						parent, name
					from
					(
						select qty, parent_detail_docname, parent, name
						from "tabPacked Item" dnpi_in
						where item_code = %s and warehouse = %s
						and parenttype='Sales Order'
						and item_code != parent_item
						and exists (select * from "tabSales Order" so
						where name = dnpi_in.parent and docstatus = 1 and status not in ('On Hold', 'Closed'))
					) dnpi)
				union
					(select stock_qty as dnpi_qty, qty as so_item_qty,
						delivered_qty as so_item_delivered_qty,
						returned_qty as so_item_returned_qty,
						{dont_reserve_on_return}, parent, name
					from "tabSales Order Item" so_item
					where item_code = %s and warehouse = %s
					and (so_item.delivered_by_supplier is null or so_item.delivered_by_supplier = 0)
					and exists(select * from "tabSales Order" so
						where so.name = so_item.parent and so.docstatus = 1
						and so.status not in ('On Hold', 'Closed')))
				) tab
			where
				so_item_qty >= so_item_delivered_qty
			""",
			(item_code, warehouse, item_code, warehouse),
		)
		return flt(reserved_qty[0][0]) if reserved_qty else 0

	sb.get_reserved_qty = get_reserved_qty


def _patch_set_landed_cost_voucher_amount():
	from erpnext.controllers.stock_controller import StockController

	def set_landed_cost_voucher_amount(self):
		for d in self.get("items"):
			lcv_item = frappe.qb.DocType("Landed Cost Item")
			query = (
				frappe.qb.from_(lcv_item)
				.select(Sum(lcv_item.applicable_charges), lcv_item.cost_center)
				.where((lcv_item.docstatus == 1) & (lcv_item.receipt_document == self.name))
				.groupby(lcv_item.cost_center)
			)
			if self.doctype == "Stock Entry":
				query = query.where(lcv_item.stock_entry_item == d.name)
			else:
				query = query.where(lcv_item.purchase_receipt_item == d.name)

			lc_voucher_data = query.run(as_list=True)

			d.landed_cost_voucher_amount = lc_voucher_data[0][0] if lc_voucher_data else 0.0
			if not d.cost_center and lc_voucher_data and lc_voucher_data[0][1]:
				d.db_set("cost_center", lc_voucher_data[0][1])

	StockController.set_landed_cost_voucher_amount = set_landed_cost_voucher_amount


def _patch_validate_against_pcv():
	from erpnext.accounts import general_ledger

	def validate_against_pcv(is_opening, posting_date, company):
		if is_opening:
			general_ledger.validate_opening_entry_against_pcv(company)

		last_pcv_date = frappe.db.get_value(
			"Period Closing Voucher",
			{"docstatus": 1, "company": company},
			[{"MAX": "period_end_date"}],
			order_by="",
		)
		if last_pcv_date and getdate(posting_date) <= getdate(last_pcv_date):
			message = _("Books have been closed till the period ending on {0}").format(
				formatdate(last_pcv_date)
			)
			message += "</br >"
			message += _("You cannot create/amend any accounting entries till this date.")
			frappe.throw(message, title=_("Period Closed"))

	general_ledger.validate_against_pcv = validate_against_pcv


def _patch_get_sre_reserved_warehouses_for_voucher():
	from erpnext.stock.doctype import stock_reservation_entry as sre_mod

	def get_sre_reserved_warehouses_for_voucher(
		voucher_type: str, voucher_no: str, voucher_detail_no: str | None = None
	) -> list:
		"""PG-5: DISTINCT + ORDER BY creation requires creation in the select list."""
		sre = frappe.qb.DocType("Stock Reservation Entry")
		query = (
			frappe.qb.from_(sre)
			.select(sre.warehouse, sre.creation)
			.distinct()
			.where(
				(sre.docstatus == 1)
				& (sre.voucher_type == voucher_type)
				& (sre.voucher_no == voucher_no)
				& (sre.delivered_qty < sre.reserved_qty)
			)
			.orderby(sre.creation)
		)
		if voucher_detail_no:
			query = query.where(sre.voucher_detail_no == voucher_detail_no)
		warehouses = query.run(as_list=True)
		return [d[0] for d in warehouses] if warehouses else []

	sre_mod.get_sre_reserved_warehouses_for_voucher = get_sre_reserved_warehouses_for_voucher


def _patch_query_payment_ledger():
	from erpnext.accounts.utils import QueryPaymentLedger

	_orig = QueryPaymentLedger.query_for_outstanding

	def query_for_outstanding(self):
		"""PG-6: strict GROUP BY — append non-aggregated selected columns."""
		query = _orig(self)
		ple = frappe.qb.DocType("Payment Ledger Entry")
		for field in (
			ple.account,
			ple.posting_date,
			ple.due_date,
			ple.account_currency,
			ple.cost_center,
			ple.remarks,
		):
			query = query.groupby(field)
		return query

	QueryPaymentLedger.query_for_outstanding = query_for_outstanding


def _patch_get_closing_entry_for_closed_period():
	from erpnext.stock.doctype.stock_closing_entry import stock_closing_entry as sce

	def get_closing_entry_for_closed_period(company):
		closed_upto = frappe.db.get_value(
			"Period Closing Voucher",
			{"docstatus": 1, "company": company},
			[{"MAX": "period_end_date"}],
			order_by="",
		)
		if not closed_upto:
			return None
		return sce._get_completed_closing_entry(company, str(closed_upto))

	sce.get_closing_entry_for_closed_period = get_closing_entry_for_closed_period


def apply():
	"""Apply all PG shims (idempotent, postgres-only)."""
	global _APPLIED
	if _APPLIED or frappe.get_conf(frappe.local.site).get("db_type", "mariadb") != "postgres":
		return
	_patch_get_reserved_qty()
	_patch_set_landed_cost_voucher_amount()
	_patch_validate_against_pcv()
	_patch_get_closing_entry_for_closed_period()
	_patch_get_sre_reserved_warehouses_for_voucher()
	_patch_query_payment_ledger()
	_APPLIED = True
	print("pg_compat: applied 6 upstream strict-PostgreSQL shims (PG-1..PG-6)")
