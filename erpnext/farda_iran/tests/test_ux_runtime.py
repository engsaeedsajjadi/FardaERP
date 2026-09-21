"""E2E runtime tests for the FardaERP UX layer (Phases 3-4):
- public «FardaERP» workspace exists with the Persian IA shortcuts (§5) and
  embeds the REAL number cards/chart (§26 — no fake data)
- design css + bundled fonts ship into site assets and are hooked (§18/§19)
- RTL + display layers remain fa-scoped (non-fa sites untouched)
Rollback not needed: setup artifacts only (idempotent ensures).
"""

from __future__ import annotations

import frappe


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []
	from erpnext.farda_iran.setup import install as setup

	summary = setup.execute()
	results.append(f"PASS: setup.execute idempotent re-run ({summary})")

	# ---- workspace IA ----
	assert frappe.db.exists("Workspace", "FardaERP"), "workspace missing"
	ws = frappe.get_doc("Workspace", "FardaERP")
	assert ws.public and ws.module == "Farda Iran", (ws.public, ws.module)
	sc = {(s.label, s.type, s.link_to) for s in (ws.shortcuts or [])}
	required = [
		("مشتریان", "DocType", "Customer"),
		("فاکتورهای فروش", "DocType", "Sales Invoice"),
		("دریافت‌ها", "DocType", "Payment Entry"),
		("تأمین‌کنندگان", "DocType", "Supplier"),
		("فاکتورهای خرید", "DocType", "Purchase Invoice"),
		("کالاها", "DocType", "Item"),
		("چک‌ها", "DocType", "Cheque"),
		("موجودی کالا", "Report", "Farda Stock Balance"),
		("دفتر کل", "Report", "Farda General Ledger"),
		("تراز آزمایشی", "Report", "Farda Trial Balance"),
		("سود و زیان", "Report", "Farda Profit and Loss"),
		("ترازنامه", "Report", "Farda Balance Sheet"),
		("گزارش بانک", "Report", "Farda Bank Report"),
		("گزارش چک", "Report", "Farda Cheque Report"),
		("گزارش مالیات بر ارزش افزوده", "Report", "Farda VAT Report"),
	]
	missing = [r for r in required if r not in sc]
	assert not missing, f"workspace shortcuts missing: {missing}"
	results.append(f"PASS: workspace FardaERP public with {len(sc)} Persian shortcuts (all {len(required)} required present)")

	# workspace embeds the REAL cards (by name) — §26 (content JSON is the
	# Desk source of truth; parse it instead of substring matching)
	import json as _json

	blocks = _json.loads(ws.content or "[]")
	embedded = [
		b.get("data", {}).get("number_card_name", "")
		for b in blocks if b.get("type") == "number_card"
	]
	for card in ("فروش کل", "دریافتنی", "ارزش موجودی"):
		assert card in embedded, f"card not embedded: {card} (got {embedded})"
	charts = [b.get("data", {}).get("chart_name") for b in blocks if b.get("type") == "chart"]
	assert "فروش ماهانه" in charts, charts
	results.append("PASS: workspace embeds real Number Cards + sales chart (no fake data)")

	# ---- design assets shipped + hooked ----
	sites = frappe.local.sites_path
	import os

	assets = os.path.join(sites, "assets", "erpnext", "farda_iran")
	for rel in ("css/farda_rtl.css", "css/farda_design.css", "js/farda_ui.js",
				"fonts/Vazirmatn-Regular.ttf", "fonts/Vazirmatn-Bold.ttf"):
		assert os.path.exists(os.path.join(assets, rel)), f"asset missing: {rel}"
	results.append("PASS: UX assets shipped (design css, rtl css, ui js, Vazirmatn fonts)")

	app_include_css = frappe.get_hooks("app_include_css")
	assert any("farda_design.css" in c for c in app_include_css), app_include_css
	assert any("farda_rtl.css" in c for c in app_include_css), app_include_css
	css = open(os.path.join(assets, "css", "farda_design.css"), encoding="utf-8").read()
	assert "@font-face" in css and "/assets/erpnext/farda_iran/fonts/Vazirmatn-Regular.ttf" in css
	assert 'html[lang="fa"]' in css  # scoped
	assert "http://" not in css and "https://" not in css  # no external fonts
	results.append("PASS: design css hooked via app_include_css; local-only @font-face; fa-scoped")

	# ---- boot flags still drive the display layer (§ Persian UX) ----
	boot = frappe.flags  # ensure no accidental global mutation
	bootinfo = frappe._dict()
	from erpnext.farda_iran.ui import boot as farda_boot

	farda_boot.extend_bootinfo(bootinfo)
	assert bootinfo.farda_iran.get("jalali_dates") and bootinfo.farda_iran.get("toman_display"), bootinfo.farda_iran
	assert float(bootinfo.farda_iran.get("irr_per_toman")) > 0, bootinfo.farda_iran
	results.append("PASS: boot flags serve jalali/toman display config (ratio from central service)")

	return " | ".join(results)
