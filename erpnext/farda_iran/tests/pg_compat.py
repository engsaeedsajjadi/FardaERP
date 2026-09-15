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


def _patch_get_negative_outstanding_invoices():
	from erpnext.accounts.doctype.payment_entry import payment_entry as pe_mod

	def get_negative_outstanding_invoices(
		party_type,
		party,
		party_account,
		party_account_currency,
		company_currency,
		cost_center=None,
		condition=None,
	):
		"""PG-8: upstream builds raw SQL with MySQL-only constructs:
		"..." double-quoted string literal and if(a, b, c)."""
		scrub = frappe.scrub

		if party_type not in ["Customer", "Supplier"]:
			return []
		voucher_type = "Sales Invoice" if party_type == "Customer" else "Purchase Invoice"
		account = "debit_to" if voucher_type == "Sales Invoice" else "credit_to"
		supplier_condition = ""
		if voucher_type == "Purchase Invoice":
			supplier_condition = "and (release_date is null or release_date <= CURRENT_DATE)"
		if party_account_currency == company_currency:
			rounded_total_field = "base_rounded_total"
			grand_total_field = "base_grand_total"
		else:
			rounded_total_field = "rounded_total"
			grand_total_field = "grand_total"

		return frappe.db.sql(
			f"""
			select
				%s as voucher_type, name as voucher_no, %s as account,
				case when {rounded_total_field} <> 0 then {rounded_total_field} else {grand_total_field} end as invoice_amount,
				outstanding_amount, posting_date,
				due_date, conversion_rate as exchange_rate
			from
				`tab{voucher_type}`
			where
				{scrub(party_type)} = %s and {"debit_to" if party_type == "Customer" else "credit_to"} = %s and docstatus = 1 and
				outstanding_amount < 0
				{supplier_condition}
				{condition or ""}
			order by
				posting_date, name
			""",
			(voucher_type, account, party, party_account),
			as_dict=True,
		)

	pe_mod.get_negative_outstanding_invoices = get_negative_outstanding_invoices


def _patch_get_orders_to_be_billed():
	from erpnext.accounts.doctype.payment_entry import payment_entry as pe_mod

	def get_orders_to_be_billed(
		posting_date,
		party_type,
		party,
		company,
		party_account_currency,
		company_currency,
		cost_center=None,
		filters=None,
	):
		"""PG-9: upstream raw SQL uses MySQL if(a,b,c) and "Closed" as a
		double-quoted string literal — both invalid on PostgreSQL."""
		scrub = frappe.scrub
		voucher_type = None
		if party_type == "Customer":
			voucher_type = "Sales Order"
		elif party_type == "Supplier":
			voucher_type = "Purchase Order"

		if not voucher_type:
			return []

		# dynamic dimension filters
		condition = ""
		active_dimensions = pe_mod.get_dimensions(True)[0]
		for dim in active_dimensions:
			if filters.get(dim.fieldname):
				condition += f" and {dim.fieldname}={frappe.db.escape(filters.get(dim.fieldname))}"

		if party_account_currency == company_currency:
			grand_total_field = "base_grand_total"
			rounded_total_field = "base_rounded_total"
		else:
			grand_total_field = "grand_total"
			rounded_total_field = "rounded_total"

		invoice_amount_expr = (
			f"case when {rounded_total_field} <> 0"
			f" then {rounded_total_field} else {grand_total_field} end"
		)
		orders = frappe.db.sql(
			f"""
			select
				name as voucher_no,
				{invoice_amount_expr} as invoice_amount,
				({invoice_amount_expr} - advance_paid) as outstanding_amount,
				transaction_date as posting_date
			from
				`tab{voucher_type}`
			where
				{scrub(party_type)} = %s
				and docstatus = 1
				and company = %s
				and status != 'Closed'
				and {invoice_amount_expr} > advance_paid
				and abs(100 - per_billed) > 0.01
				{condition}
			order by
				transaction_date, name
			""",
			(party, company),
			as_dict=True,
		)

		order_list = []
		for d in orders:
			if (
				filters
				and filters.get("outstanding_amt_greater_than")
				and filters.get("outstanding_amt_less_than")
				and not (
					flt(filters.get("outstanding_amt_greater_than"))
					<= flt(d.outstanding_amount)
					<= flt(filters.get("outstanding_amt_less_than"))
				)
			):
				continue

			d["voucher_type"] = voucher_type
			# This assumes that the exchange rate required is the one in the SO
			d["exchange_rate"] = pe_mod.get_exchange_rate(
				party_account_currency, company_currency, d.posting_date
			)
			order_list.append(d)

		return order_list

	pe_mod.get_orders_to_be_billed = get_orders_to_be_billed


def _patch_get_held_invoices():
	from erpnext.accounts import utils as accounts_utils

	def get_held_invoices(party_type, party):
		"""PG-7: CURDATE() is MySQL-only; bind today's date as a parameter instead."""
		held_invoices = None
		if party_type == "Supplier":
			held_invoices = frappe.db.sql(
				"select name from `tabPurchase Invoice`"
				" where on_hold = 1"
				" and release_date IS NOT NULL"
				" and release_date > %s",
				(frappe.utils.nowdate(),),
				as_dict=1,
			)
			held_invoices = set(d["name"] for d in held_invoices)
		return held_invoices

	accounts_utils.get_held_invoices = get_held_invoices


def _patch_get_sre_reserved_warehouses_for_voucher():
	import erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry as sre_mod

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

	def query_for_outstanding(self):
		"""PG-6: strict GROUP BY for the payment-ledger CTE (upstream omits
		non-aggregated selected columns; MariaDB tolerates, PostgreSQL does not)."""
		from frappe.query_builder import Criterion
		from frappe.query_builder.functions import Max, Sum
		from pypika import AliasedQuery, Case, Table

		qb = frappe.qb
		ple = self.ple

		filter_on_voucher_no = []
		filter_on_against_voucher_no = []

		if self.vouchers:
			voucher_types = {x.voucher_type for x in self.vouchers}
			voucher_nos = {x.voucher_no for x in self.vouchers}
			filter_on_voucher_no.append(ple.voucher_type.isin(voucher_types))
			filter_on_voucher_no.append(ple.voucher_no.isin(voucher_nos))
			filter_on_against_voucher_no.append(ple.against_voucher_type.isin(voucher_types))
			filter_on_against_voucher_no.append(ple.against_voucher_no.isin(voucher_nos))

		if self.voucher_no:
			filter_on_voucher_no.append(ple.voucher_no.like(f"%{self.voucher_no}%"))
			filter_on_against_voucher_no.append(ple.against_voucher_no.like(f"%{self.voucher_no}%"))

		filter_on_outstanding_amount = []
		if self.min_outstanding:
			op = Table("outstanding").amount_in_account_currency >= self.min_outstanding
			if self.min_outstanding > 0:
				filter_on_outstanding_amount.append(op)
			else:
				filter_on_outstanding_amount.append(
					Table("outstanding").amount_in_account_currency <= self.min_outstanding
				)
		if self.max_outstanding:
			if self.max_outstanding > 0:
				filter_on_outstanding_amount.append(
					Table("outstanding").amount_in_account_currency <= self.max_outstanding
				)
			else:
				filter_on_outstanding_amount.append(
					Table("outstanding").amount_in_account_currency >= self.max_outstanding
				)

		if self.limit and self.get_invoices:
			# NOTE: unreachable in the Gate-5 smoke flow (no limit set).
			outstanding_vouchers = (
				qb.from_(ple)
				.select(
					ple.against_voucher_no.as_("voucher_no"),
					Sum(ple.amount_in_account_currency).as_("amount_in_account_currency"),
					Max(
						Case()
						.when(
							(ple.voucher_no == ple.against_voucher_no)
							& (ple.voucher_type == ple.against_voucher_type),
							(ple.posting_date),
						)
					).as_("invoice_date"),
				)
				.where(ple.delinked == 0)
				.where(Criterion.all(filter_on_against_voucher_no))
				.where(Criterion.all(self.common_filter))
				.where(Criterion.all(self.dimensions_filter))
				.where(Criterion.all(self.voucher_posting_date))
				.groupby(
					ple.against_voucher_type,
					ple.against_voucher_no,
					ple.party_type,
					ple.party,
				)
				.having(qb.Field("amount_in_account_currency") > 0)
				.limit(self.limit)
				.run()
			)
			if outstanding_vouchers:
				filter_on_voucher_no.append(ple.voucher_no.isin([x[0] for x in outstanding_vouchers]))
				filter_on_against_voucher_no.append(
					ple.against_voucher_no.isin([x[0] for x in outstanding_vouchers])
				)

		query_voucher_amount = (
			qb.from_(ple)
			.select(
				ple.account,
				ple.voucher_type,
				ple.voucher_no,
				ple.party_type,
				ple.party,
				ple.posting_date,
				ple.due_date,
				ple.account_currency.as_("currency"),
				ple.cost_center.as_("cost_center"),
				Sum(ple.amount).as_("amount"),
				Sum(ple.amount_in_account_currency).as_("amount_in_account_currency"),
				ple.remarks,
			)
			.where(ple.delinked == 0)
			.where(Criterion.all(filter_on_voucher_no))
			.where(Criterion.all(self.common_filter))
			.where(Criterion.all(self.dimensions_filter))
			.where(Criterion.all(self.voucher_posting_date))
			.groupby(
				ple.account,
				ple.voucher_type,
				ple.voucher_no,
				ple.party_type,
				ple.party,
				ple.posting_date,
				ple.due_date,
				ple.account_currency,
				ple.cost_center,
				ple.remarks,
			)
		)

		query_voucher_outstanding = (
			qb.from_(ple)
			.select(
				ple.account,
				ple.against_voucher_type.as_("voucher_type"),
				ple.against_voucher_no.as_("voucher_no"),
				ple.party_type,
				ple.party,
				ple.posting_date,
				ple.due_date,
				ple.account_currency.as_("currency"),
				Sum(ple.amount).as_("amount"),
				Sum(ple.amount_in_account_currency).as_("amount_in_account_currency"),
			)
			.where(ple.delinked == 0)
			.where(Criterion.all(filter_on_against_voucher_no))
			.where(Criterion.all(self.common_filter))
			.groupby(
				ple.account,
				ple.against_voucher_type,
				ple.against_voucher_no,
				ple.party_type,
				ple.party,
				ple.posting_date,
				ple.due_date,
				ple.account_currency,
			)
		)

		self.cte_query_voucher_amount_and_outstanding = (
			qb.with_(query_voucher_amount, "vouchers")
			.with_(query_voucher_outstanding, "outstanding")
			.from_(AliasedQuery("vouchers"))
			.left_join(AliasedQuery("outstanding"))
			.on(
				(AliasedQuery("vouchers").account == AliasedQuery("outstanding").account)
				& (AliasedQuery("vouchers").voucher_type == AliasedQuery("outstanding").voucher_type)
				& (AliasedQuery("vouchers").voucher_no == AliasedQuery("outstanding").voucher_no)
				& (AliasedQuery("vouchers").party_type == AliasedQuery("outstanding").party_type)
				& (AliasedQuery("vouchers").party == AliasedQuery("outstanding").party)
			)
			.select(
				Table("vouchers").account,
				Table("vouchers").voucher_type,
				Table("vouchers").voucher_no,
				Table("vouchers").party_type,
				Table("vouchers").party,
				Table("vouchers").posting_date,
				Table("vouchers").amount.as_("invoice_amount"),
				Table("vouchers").amount_in_account_currency.as_("invoice_amount_in_account_currency"),
				Table("outstanding").amount.as_("outstanding"),
				Table("outstanding").amount_in_account_currency.as_("outstanding_in_account_currency"),
				(Table("vouchers").amount - Table("outstanding").amount).as_("paid_amount"),
				(
					Table("vouchers").amount_in_account_currency
					- Table("outstanding").amount_in_account_currency
				).as_("paid_amount_in_account_currency"),
				Table("vouchers").due_date,
				Table("vouchers").currency,
				Table("vouchers").cost_center.as_("cost_center"),
				Table("vouchers").remarks,
			)
			.where(Criterion.all(filter_on_outstanding_amount))
		)

		# upstream uses HAVING on a select alias without GROUP BY (MySQL-only
		# semantics); on PostgreSQL filter the real CTE column via WHERE.
		if self.get_invoices:
			self.cte_query_voucher_amount_and_outstanding = (
				self.cte_query_voucher_amount_and_outstanding.where(
					Table("outstanding").amount_in_account_currency > 0
				)
			)
		elif self.get_payments:
			self.cte_query_voucher_amount_and_outstanding = (
				self.cte_query_voucher_amount_and_outstanding.where(
					Table("outstanding").amount_in_account_currency < 0
				)
			)

		if self.limit:
			self.cte_query_voucher_amount_and_outstanding = (
				self.cte_query_voucher_amount_and_outstanding.limit(self.limit)
			)

		self.voucher_outstandings = self.cte_query_voucher_amount_and_outstanding.run(as_dict=True)

	QueryPaymentLedger.query_for_outstanding = query_for_outstanding


def _patch_get_closing_entry_for_closed_period():
	import erpnext.stock.doctype.stock_closing_entry.stock_closing_entry as sce

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
	_patch_get_held_invoices()
	_patch_get_negative_outstanding_invoices()
	_patch_get_orders_to_be_billed()
	_APPLIED = True
	print("pg_compat: applied 9 upstream strict-PostgreSQL shims (PG-1..PG-9)")
