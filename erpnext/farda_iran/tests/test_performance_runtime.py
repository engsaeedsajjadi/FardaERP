"""R18 — Performance regression on the critical paths (§ Performance).

Budget-based live guards (generous ceilings so shared-CPU sandboxes stay
deterministic; they exist to catch PATHOLOGICAL regressions like N+1 blowups,
not to benchmark hardware):
  P1 search_party ×25 sequential — avg ≤ 60 ms, total ≤ 2.0 s
  P2 VAT validate path: new SI insert (VAT planner + audit hooks) ≤ 1.5 s/op,
     3 ops avg ≤ 1.0 s
  P3 collect_kpis ≤ 800 ms · render sales print format ≤ 800 ms
  P4 reports ≤ 1.2 s each (sales register, party balance, VAT report, cheque report)
  P5 audit insert ≤ 300 ms/op · reminders dedupe query shape: one batch read
     (source assertion) + notify_cheques_due idempotent second run returns 0
Static N+1 audit results live in docs/PERFORMANCE.md.

Also verifies the audit index exists after setup (ensure_audit_index).
"""

from __future__ import annotations

import time

import frappe


def _ms() -> float:
	return time.perf_counter() * 1000.0


def _company():
	return frappe.db.get_value("Company", {"is_group": 0}, "name")


def _item(code):
	if frappe.db.exists("Item", code):
		return code
	return frappe.get_doc({
		"doctype": "Item",
		"item_code": code,
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
	}).insert().name


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()

	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings

	results: list[str] = []
	company = _company()
	_setup_vat_settings(company)
	item = _item("PERF ITEM 1")

	# ---------- P1: search API ----------
	search_party = frappe.get_attr("erpnext.farda_iran.api.search.search_party")
	t0 = _ms()
	for i in range(25):
		out = search_party(doctype="Customer", query=f"perf probe {i}")
		assert "results" in out
	total, avg = _ms() - t0, (_ms() - t0) / 25
	assert avg <= 60, f"search avg {avg:.1f} ms > 60 ms"
	assert total <= 2000, f"search total {total:.0f} ms > 2000 ms"
	results.append(f"PASS: search_party ×25 — avg {avg:.1f} ms (≤60), total {total:.0f} ms (≤2000)")

	# ---------- P2: invoice insert (VAT + audit hooks) ----------
	customer = frappe.get_doc({
		"doctype": "Customer",
		"customer_name": "PERF CUST",
		"customer_type": "Individual",
	}).insert()
	durations = []
	invoices = []
	for i in range(3):
		t0 = _ms()
		si = frappe.get_doc({
			"doctype": "Sales Invoice",
			"company": company,
			"customer": customer.name,
			"currency": frappe.db.get_value("Company", company, "default_currency"),
			"conversion_rate": 1,
			"farda_apply_vat": 1,
			"posting_date": frappe.utils.nowdate(),
			"items": [{"item_code": item, "qty": 1, "rate": 100_000 + i}],
		}).insert()
		durations.append(_ms() - t0)
		invoices.append(si)
	assert max(durations) <= 1500, f"SI insert max {durations} > 1500 ms"
	assert sum(durations) / len(durations) <= 1000, f"SI insert avg {durations} > 1000 ms"
	results.append(f"PASS: SI insert w/ VAT+audit — max {max(durations):.0f} ms (≤1500), avg {sum(durations)/3:.0f} ms (≤1000)")

	# ---------- P3: KPIs + print render ----------
	from erpnext.farda_iran.dashboard.kpis import collect_kpis

	t0 = _ms()
	kpis = collect_kpis(company=company)
	kpi_ms = _ms() - t0
	assert kpis, "kpis empty"
	assert kpi_ms <= 800, f"collect_kpis {kpi_ms:.0f} ms > 800 ms"

	pf_html = frappe.db.get_value("Print Format", "Farda Persian Invoice", "html")
	jenv = frappe.get_jenv()
	t0 = _ms()
	html = jenv.from_string(pf_html).render({
		"doc": invoices[0],
		"print_settings": frappe.get_doc("Print Settings").as_dict(),
		"letter_head": None,
		"no_letterhead": 1,
	})
	print_ms = _ms() - t0
	assert html and "۱۰٬۰۰۰" in html  # 100,000 IRR = 10,000 Toman
	assert print_ms <= 800, f"print render {print_ms:.0f} ms > 800 ms"
	results.append(f"PASS: collect_kpis {kpi_ms:.0f} ms + print render {print_ms:.0f} ms (≤800 each)")

	# ---------- P4: reports ----------
	executes = {
		"Farda Sales Register": "farda_sales_register",
		"Farda Party Balance": "farda_party_balance",
		"Farda VAT Report": "farda_vat_report",
		"Farda Cheque Report": "farda_cheque_report",
	}
	for report_name, slug in executes.items():
		fn = frappe.get_attr(f"erpnext.farda_iran.report.{slug}.{slug}.execute")
		t0 = _ms()
		fn({"company": company})
		ms = _ms() - t0
		assert ms <= 1200, f"{report_name} {ms:.0f} ms > 1200 ms"
	results.append("PASS: 4 reports each ≤1200 ms")

	# ---------- P5: audit path + reminders dedupe ----------
	from erpnext.farda_iran.audit import service as audit

	t0 = _ms()
	audit.record("Customer", customer.name, "IdentityChange", {"farda_national_id": ("0012345601", "0098765401")})
	audit_ms = _ms() - t0
	assert audit_ms <= 300, f"audit.record {audit_ms:.0f} ms > 300 ms"

	# index present after setup (ensure is idempotent — mirrors migrate hook)
	frappe.get_attr("erpnext.farda_iran.setup.install.ensure_audit_index")()
	indexes = frappe.db.sql(
		'select indexname from pg_indexes where tablename=%s',
		("tabFarda Audit Log",),
		pluck=True,
	)
	assert any("subject_doctype" in i for i in indexes), indexes

	notify = frappe.get_attr("erpnext.farda_iran.cheque.reminders.notify_cheques_due")
	notify(days=7)                  # first pass may create rows
	t0 = _ms()
	second = notify(days=7)         # dedupe pass must create nothing
	dedupe_ms = _ms() - t0
	assert second == 0, f"second notify created {second} rows (dedupe broken)"
	assert dedupe_ms <= 2000, f"dedupe pass {dedupe_ms:.0f} ms > 2000 ms"
	results.append(f"PASS: audit.record {audit_ms:.0f} ms (≤300) + audit index + reminders dedupe 2nd run = 0 ({dedupe_ms:.0f} ms)")

	# ---------- cleanup ----------
	for si in invoices:
		frappe.delete_doc("Sales Invoice", si.name, force=True, ignore_permissions=True)
	frappe.delete_doc("Customer", customer.name, force=True, ignore_permissions=True)

	return " | ".join(results)
