"""E2E runtime tests: §10 Persian search integration + §11 Bank Account integration.

Executed on the live site. Rolls the transaction back at the end.
"""

from __future__ import annotations

import frappe

VALID_IBAN = "IR200170000000000123456789"  # code 017 → بانک ملی ایران
MISMATCH_IBAN = "IR840120000000000123456789"  # code 012 → بانک ملت (different bank)


def run_search() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	import erpnext.farda_iran.setup.install as farda_setup

	farda_setup.execute()  # custom fields + backfill (idempotent)

	# ---- fold-at-rest on Customer ----
	cust = frappe.get_doc({
		"doctype": "Customer",
		"customer_name": "كارخانه يخ ايران",  # Arabic ي + ك
		"customer_type": "Company",
	}).insert()
	stored_name = frappe.db.get_value("Customer", cust.name, "customer_name")
	assert stored_name == "کارخانه یخ ایران", stored_name  # canonical letters at rest
	key = frappe.db.get_value("Customer", cust.name, "farda_search_key")
	assert key and key == "كارخانه يخ ايران".lower().replace("ي", "ی").replace("ك", "ک").replace("\u200c", ""), key
	results.append(f"PASS: customer stored canonically + search key set («{stored_name}»)")

	api = frappe.get_attr("erpnext.farda_iran.api.search.search_party")

	# ---- fold-at-query finds it (Arabic spelling query) ----
	out = api(doctype="Customer", query="كارخانه يخ", limit=20)  # Arabic ي
	assert any(r["name"] == cust.name for r in out["results"]), out
	results.append("PASS: Arabic-spelled query «كارخانه يخ» finds canonical row")

	# Persian spelling query also finds it
	out = api(doctype="Customer", query="کارخانه یخ")
	assert any(r["name"] == cust.name for r in out["results"]), out
	results.append("PASS: Persian-spelled query «کارخانه یخ» finds same row")

	# digits normalization in query
	item = frappe.get_doc({
		"doctype": "Item",
		"item_code": "SEARCHRT PICH",
		"item_name": "پيچ ۱۲۳",  # Arabic ي + Persian digits
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
	}).insert()
	stored_item_name = frappe.db.get_value("Item", item.name, "item_name")
	assert stored_item_name == "پیچ 123", stored_item_name
	search_item = frappe.get_attr("erpnext.farda_iran.api.search.search_item")
	out = search_item(query="پيچ 123")  # Arabic ي + ASCII digits
	assert any(r["name"] == item.name for r in out["results"]), out
	results.append(f"PASS: item «{stored_item_name}» found via «پيچ 123» (digits+yeh folded)")

	# ---- legacy fallback: no search key, Arabic-stored title, raw-LIKE match ----
	legacy = frappe.get_doc({
		"doctype": "Customer",
		"customer_name": "شركت قديمی",
		"customer_type": "Company",
	}).insert()
	# simulate a pre-integration row: raw Arabic title + empty key
	frappe.db.set_value("Customer", legacy.name, "customer_name", "شركت قديمی", update_modified=False)
	frappe.db.set_value("Customer", legacy.name, "farda_search_key", "", update_modified=False)
	out = api(doctype="Customer", query="قديمی")  # raw LIKE against stored raw title
	assert any(r["name"] == legacy.name for r in out["results"]), out
	results.append("PASS: legacy row (no key, raw Arabic title) matched via raw-LIKE fallback")

	# ---- permissions: guest denied ----
	frappe.set_user("Guest")
	try:
		api(doctype="Customer", query="x")
	except (frappe.AuthenticationError, frappe.exceptions.PermissionError):
		results.append("PASS: guest denied on search API (auth/permission)")
	else:
		raise AssertionError("guest could call search API")
	frappe.set_user("Administrator")

	# ---- restricted doctype ----
	try:
		api(doctype="User", query="admin")
	except frappe.exceptions.ValidationError:
		results.append("PASS: non-party doctype rejected")
	else:
		raise AssertionError("User doctype searchable!")

	frappe.db.rollback()
	return " | ".join(results)


def run_bank() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	gl_account = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
	resolve = frappe.get_attr("erpnext.farda_iran.api.banking.resolve_iban")

	# ---- API resolution ----
	info = resolve(iban="ir 20۰۱۷ 0000000000123456789")  # messy input
	assert info["valid"] and info["bank_code"] == "017" and info["bank_name"] == "بانک ملی ایران", info
	results.append(f"PASS: resolve_iban normalizes + resolves «{info['iban']}» → {info['bank_name']}")

	assert resolve(iban="IR06290")["valid"] is False
	results.append("PASS: invalid IBAN → {valid: False} (no throw)")

	# ---- negative: bad IBAN rejected ----
	try:
		frappe.get_doc({
			"doctype": "Bank Account",
			"account_name": "BAD IBAN ACC",
			"company": company,
			"account": gl_account,
			"iban": "IR200170000000000123456788",  # check digit off
		}).insert()
	except frappe.exceptions.ValidationError:
		results.append("PASS: invalid IBAN rejected by Bank Account validate")
	else:
		raise AssertionError("bad IBAN accepted")

	# ---- happy path: registry bank auto-created and linked ----
	ba = frappe.get_doc({
		"doctype": "Bank Account",
		"account_name": "MAIN BANK ACC",
		"company": company,
		"account": gl_account,
		"iban": VALID_IBAN,
	}).insert()
	assert ba.iban == VALID_IBAN
	bank_title = frappe.db.get_value("Bank", ba.bank, "bank_name")
	assert bank_title == "بانک ملی ایران", (ba.bank, bank_title)
	results.append(f"PASS: Bank «{bank_title}» auto-created + linked from IBAN")

	# ---- mismatch between selected bank and IBAN registry ----
	try:
		melt = frappe.db.get_value("Bank", {"bank_name": "بانک ملت"}, "name") or frappe.get_doc(
			{"doctype": "Bank", "bank_name": "بانک ملت"}
		).insert(ignore_permissions=True).name
		frappe.get_doc({
			"doctype": "Bank Account",
			"account_name": "MISMATCH ACC",
			"company": company,
			"account": gl_account,
			"bank": melt,
			"iban": VALID_IBAN,  # ملی، but bank says ملت
		}).insert()
	except frappe.exceptions.ValidationError as e:
		assert "هم‌خوانی" in str(e), e
		results.append("PASS: bank↔IBAN mismatch rejected with Persian error")
	else:
		raise AssertionError("mismatch accepted")

	# ---- card Luhn ----
	try:
		frappe.get_doc({
			"doctype": "Bank Account",
			"account_name": "CARD ACC BAD",
			"company": company,
			"account": gl_account,
			"farda_card_number": "6037999999999999",
		}).insert()
	except frappe.exceptions.ValidationError:
		results.append("PASS: bad card number rejected (Luhn)")
	else:
		raise AssertionError("bad card accepted")

	ba2 = frappe.get_doc({
		"doctype": "Bank Account",
		"account_name": "CARD ACC OK",
		"company": company,
		"account": gl_account,
		"iban": MISMATCH_IBAN,  # ملت
	}).insert()
	assert frappe.db.get_value("Bank", ba2.bank, "bank_name") == "بانک ملت"
	results.append("PASS: second IBAN → بانک ملت linked (registry mapping correct)")

	frappe.db.rollback()
	return " | ".join(results)
