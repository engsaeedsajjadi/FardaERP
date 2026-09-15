"""Persian (RTL) invoice PDF renderer — pure-Python fallback for frappe's PDF path.

frappe's own PDF engine (weasyprint) requires system libpango, which is absent
in minimal deployments. This renderer uses reportlab + arabic_reshaper +
python-bidi + the bundled OFL-licensed Vazirmatn font, and shares the SAME
data path as the HTML print format (invoice façade + tax service), so HTML and
PDF never diverge arithmetically.

All heavy imports are lazy: importing this module is free when reportlab is
not installed; render_invoice_pdf raises an informative ImportError instead.
"""

from __future__ import annotations

import io
import os

FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "fonts")
REGULAR = os.path.join(FONT_DIR, "Vazirmatn-Regular.ttf")
BOLD = os.path.join(FONT_DIR, "Vazirmatn-Bold.ttf")

PAGE_W, PAGE_H = 595, 842  # A4 in points
MARGIN = 36
ROW_H = 18


def _shape(text) -> str:
	"""Persian/Arabic shaping + bidi reorder for LTR glyph drawing."""
	from bidi.algorithm import get_display

	try:
		import arabic_reshaper

		return get_display(arabic_reshaper.reshape(str(text)))
	except ImportError:
		return get_display(str(text))


def _register_fonts(pdf):
	from reportlab.pdfbase import pdfmetrics
	from reportlab.pdfbase.ttfonts import TTFont

	for name, path in (("Vazirmatn", REGULAR), ("Vazirmatn-Bold", BOLD)):
		if name not in pdfmetrics.getRegisteredFontNames():
			pdfmetrics.registerFont(TTFont(name, path))


def render_invoice_pdf(doc) -> bytes:
	"""Sales Invoice doc -> Persian PDF bytes (A4, RTL, Vazirmatn)."""
	try:
		from reportlab.lib.utils import ImageReader  # noqa: F401
		from reportlab.pdfgen import canvas
	except ImportError as exc:
		raise ImportError(
			"reportlab is required for the Persian PDF renderer (pip install reportlab)"
		) from exc

	from erpnext.farda_iran.invoice.persian import (
		fa,
		format_jalali_date,
		money_words_irr,
		money_words_toman,
		toman_str,
	)
	from erpnext.farda_iran.tax.service import invoice_totals

	t = invoice_totals(doc)
	buf = io.BytesIO()
	c = canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
	_register_fonts(c)
	w = PAGE_W - 2 * MARGIN

	def txt(x, y, s, font="Vazirmatn", size=10, align="right"):
		c.setFont(font, size)
		s = _shape(s)
		if align == "right":
			c.drawRightString(x, y, s)
		elif align == "center":
			c.drawCentredString(x, y, s)
		else:
			c.drawString(x, y, s)

	def cell(x, y, wd, ht, s, font="Vazirmatn", size=9, align="center", border=1):
		if border:
			c.rect(x, y - ht, wd, ht)
		cx = x + wd - 4 if align == "right" else (x + wd / 2 if align == "center" else x + 4)
		c.setFont(font, size)
		c.drawRightString(cx, y - ht + (ht - size) / 2 + 1, _shape(s)) if align == "right" else (
			c.drawCentredString(cx, y - ht + (ht - size) / 2 + 1, _shape(s))
			if align == "center"
			else c.drawString(cx, y - ht + (ht - size) / 2 + 1, _shape(s))
		)

	# ---- header ----
	y = PAGE_H - MARGIN
	txt(PAGE_W - MARGIN, y, "بسمه تعالی", size=11, align="right")
	y -= 16
	txt(PAGE_W / 2, y, "صورتحساب فروش کالا و خدمات", font="Vazirmatn-Bold", size=13, align="center")
	y -= 18
	txt(PAGE_W - MARGIN, y, f"شماره: {fa(doc.name)}   تاریخ: {fa(format_jalali_date(doc.posting_date))}")
	y -= 20

	# ---- seller / buyer ----
	company = doc.company and _get_doc("Company", doc.company)
	customer = doc.customer and _get_doc("Customer", doc.customer)
	half = w / 2
	cell(MARGIN + half, y, half, 44, "", border=0)
	cell(MARGIN, y, half, 44, "", border=0)
	y_head = y - 12
	txt(MARGIN + half - 4, y_head, "فروشنده", font="Vazirmatn-Bold", size=9, align="right")
	txt(MARGIN + 4, y_head, "خریدار", font="Vazirmatn-Bold", size=9, align="right")
	seller_lines = [
		f"نام: {doc.company}",
		f"شناسه ملی: {fa(company.get('farda_legal_id') or '-') if company else '-'}",
		f"کد اقتصادی: {fa(company.get('farda_economic_code') or '-') if company else '-'}",
	]
	buyer_lines = [
		f"نام: {doc.customer_name or '-'}",
		f"کد ملی: {fa(customer.get('farda_national_id') or '-') if customer else '-'}",
		f"کد اقتصادی: {fa(customer.get('farda_economic_code') or '-') if customer else '-'}",
	]
	for i in range(3):
		yy = y_head - 12 - i * 12
		txt(MARGIN + half - 4, yy, seller_lines[i], size=8, align="right")
		txt(MARGIN + 4, yy, buyer_lines[i], size=8, align="right")
	y -= 48
	c.rect(MARGIN, y, half, 48)
	c.rect(MARGIN + half, y, half, 48)

	# ---- items table ----
	cols = [  # (label, width, attr)
		("ردیف", 0.07 * w, None),
		("شرح کالا / خدمات", 0.39 * w, "item_name"),
		("مقدار", 0.10 * w, "qty"),
		("واحد", 0.10 * w, "uom"),
		("مبلغ واحد (تومان)", 0.17 * w, "rate"),
		("مبلغ کل (تومان)", 0.17 * w, "amount"),
	]
	y -= 16
	cell(MARGIN, y, w, ROW_H, "", border=1)
	cx = MARGIN
	for label, cwd, _attr in cols:
		cell(cx, y, cwd, ROW_H, label, font="Vazirmatn-Bold", size=9)
		cx += cwd
	y -= ROW_H

	items = list(doc.get("items") or [])
	for idx, row in enumerate(items, start=1):
		if y < MARGIN + 150:  # pagination
			c.showPage()
			_register_fonts(c)
			y = PAGE_H - MARGIN
			cx = MARGIN
			for label, cwd, _attr in cols:
				cell(cx, y, cwd, ROW_H, label, font="Vazirmatn-Bold", size=9)
				cx += cwd
			y -= ROW_H
		cx = MARGIN
		values = [
			fa(idx),
			str(row.get("item_name") or "-"),
			fa("%g" % (row.get("qty") or 0)),
			str(row.get("uom") or "-"),
			fa(toman_str(row.get("rate") or 0)),
			fa(toman_str(row.get("amount") or 0)),
		]
		for (_label, cwd, _attr), val in zip(cols, values):
			cell(cx, y, cwd, ROW_H, val, size=8)
			cx += cwd
		y -= ROW_H

	# ---- totals ----
	y -= 8
	rows = [
		("جمع کل (پیش از مالیات)", f"{fa(toman_str(t.net_total))} تومان", False),
		(
			f"مالیات بر ارزش افزوده ({fa('%g' % t.vat_rate)}٪)",
			f"{fa(toman_str(t.vat_amount))} تومان",
			False,
		),
		(
			"مبلغ قابل پرداخت",
			f"{fa(toman_str(t.grand_total))} تومان  ({fa(money_words_irr(t.grand_total))})",
			True,
		),
		("به حروف", money_words_toman(t.grand_total), False),
	]
	for label, value, bold in rows:
		font = "Vazirmatn-Bold" if bold else "Vazirmatn"
		cell(MARGIN, y, w * 0.55, ROW_H, label, font=font, size=9, align="right")
		cell(MARGIN + w * 0.55, y, w * 0.45, ROW_H, value, font=font, size=9)
		y -= ROW_H

	# ---- signatures ----
	y -= 30
	txt(MARGIN + w * 0.75, y, "مهر و امضای فروشنده", align="center")
	txt(MARGIN + w * 0.25, y, "مهر و امضای خریدار", align="center")

	c.save()
	return buf.getvalue()


def _get_doc(doctype: str, name: str):
	"""frappe.get_doc guarded (print contexts always run inside frappe)."""
	try:
		import frappe

		return frappe.get_doc(doctype, name)
	except Exception:
		return None
