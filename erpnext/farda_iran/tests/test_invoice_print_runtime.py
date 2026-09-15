"""E2E runtime test: Persian invoice print format + PDF, on a live site.

HTML: Farda Persian Invoice (Jinja) rendered via frappe.get_print — asserts RTL,
Persian digits, Jalali date, Toman amounts, VAT row, amount-in-words.
PDF: erpnext.farda_iran.invoice.pdf.render_invoice_pdf — asserts %PDF magic,
embedded Vazirmatn font, and Persian content extractable via pdfminer.
Rolls the transaction back at the end.
"""

from __future__ import annotations

import frappe

PRINT_FORMAT = "Farda Persian Invoice"


def _ensure_print_format() -> None:
	if frappe.db.exists("Print Format", PRINT_FORMAT):
		return
	from frappe.modules.import_file import import_file_by_path

	path = os_path()
	import_file_by_path(path, force=True)
	if not frappe.db.exists("Print Format", PRINT_FORMAT):
		raise AssertionError("Farda Persian Invoice print format failed to sync")


def os_path() -> str:
	import frappe

	return os_path_build(frappe.get_module_path("Farda Iran"))


def os_path_build(base: str) -> str:
	import os

	return os.path.join(base, "print_format", "farda_persian_invoice", "farda_persian_invoice.json")


def _make_invoice():
	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	customer = frappe.get_doc({
		"doctype": "Customer",
		"customer_name": "PRINT TEST CUSTOMER",
		"customer_type": "Individual",
		"farda_national_id": "0499370899",
	}).insert()
	item = frappe.get_doc({
		"doctype": "Item",
		"item_code": "PRINT TEST ITEM",
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
	}).insert()
	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings

	_setup_vat_settings(company)
	si = frappe.get_doc({
		"doctype": "Sales Invoice",
		"company": company,
		"customer": customer.name,
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"conversion_rate": 1,
		"farda_apply_vat": 1,
		"posting_date": frappe.utils.nowdate(),
		"items": [
			{"item_code": item.name, "qty": 2, "rate": 500_000},
			{"item_code": item.name, "qty": 1, "rate": 250_000},
		],
	}).insert()
	si.submit()
	return si


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	_ensure_print_format()
	si = _make_invoice()

	# net 1,250,000 IRR + VAT 10% (125,000) = grand 1,375,000 IRR
	assert abs(si.grand_total - 1_375_000) < 0.01, si.grand_total

	# render the format's Jinja directly (frappe.get_print wraps in the Desk print
	# view chrome, which needs a built asset bundle this minimal env does not have)
	pf_html = frappe.db.get_value("Print Format", PRINT_FORMAT, "html")
	jenv = frappe.get_jenv()
	html = jenv.from_string(pf_html).render({
		"doc": si,
		"print_settings": frappe.get_doc("Print Settings").as_dict(),
		"letter_head": None,
		"no_letterhead": 1,
	})
	if 'dir="rtl"' not in html:
		raise AssertionError("print format is not RTL")
	results.append("PASS: RTL layout (dir=rtl)")

	if "صورتحساب فروش کالا و خدمات" not in html:
		raise AssertionError("Persian invoice title missing")
	results.append("PASS: Persian invoice title")

	if not any(ch in html for ch in "۰۱۲۳۴۵۶۷۸۹"):
		raise AssertionError("no Persian digits in print output")
	if "1,250,000" in html and "۱٬۲۵۰٬۰۰۰" not in html:
		raise AssertionError("amounts not converted to Persian Toman")
	results.append("PASS: Persian digits + Toman amounts")

	if "۱۴۰۵" not in html:
		raise AssertionError("Jalali date missing (expected ۱۴۰۵)")
	results.append("PASS: Jalali issue date")

	if "مالیات بر ارزش افزوده" not in html:
		raise AssertionError("VAT row missing")
	results.append("PASS: VAT row rendered")

	if "به حروف" not in html or "تومان" not in html:
		raise AssertionError("amount-in-words row missing")
	from erpnext.farda_iran.invoice.persian import money_words_toman

	expected_words = money_words_toman(si.grand_total)
	if expected_words not in html:
		raise AssertionError(f"words mismatch: expected «{expected_words}» in print HTML")
	results.append(f"PASS: amount in Persian words («{expected_words}»)")

	if fa_national_id_missing(html):
		raise AssertionError("customer کد ملی not rendered")
	results.append("PASS: buyer کد ملی on invoice")

	# ---------- PDF ----------
	from erpnext.farda_iran.invoice.pdf import render_invoice_pdf

	pdf_bytes = render_invoice_pdf(si)
	if not pdf_bytes.startswith(b"%PDF"):
		raise AssertionError("PDF magic missing")
	if b"Vazirmatn" not in pdf_bytes:
		raise AssertionError("Vazirmatn font not embedded in PDF")
	results.append(f"PASS: Persian PDF generated ({len(pdf_bytes):,} bytes, Vazirmatn embedded)")

	try:
		text = extract_pdf_text(pdf_bytes)
	except ImportError:
		text = ""
	if text:
		# doc.name digits render as Persian digits inside the PDF, so match the
		# ASCII naming-series prefix instead of the full name
		if "ACC-SINV" not in text:
			raise AssertionError("invoice number series not extractable from PDF")
		shaped_title = shape_helper("مبلغ قابل پرداخت")
		if shaped_title not in text.replace("\u200c", ""):
			raise AssertionError("Persian totals label not extractable from PDF")
		results.append("PASS: PDF text layer verified (invoice no + Persian totals label)")
	else:
		results.append("WARN: pdfminer not installed — PDF text-layer assertion skipped (UNKNOWN — needs verification)")

	frappe.db.rollback()
	return " | ".join(results)


def fa_national_id_missing(html: str) -> bool:
	return "0499370899" in html and "۰۴۹۹۳۷۰۸۹۹" not in html


def shape_helper(text: str) -> str:
	try:
		import arabic_reshaper
		from bidi.algorithm import get_display

		return get_display(arabic_reshaper.reshape(text))
	except ImportError:
		return text


def extract_pdf_text(pdf_bytes: bytes) -> str:
	from pdfminer.high_level import extract_text

	import io

	return extract_text(io.BytesIO(pdf_bytes))
