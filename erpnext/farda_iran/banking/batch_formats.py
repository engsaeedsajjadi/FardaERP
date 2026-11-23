"""Group payment files for Iranian banks (پرداخت گروهی) — pure logic.

Formats
- paya_excel:  inter-bank Paya group transfer by IBAN, one row per payee, as an
  Excel sheet (شبا، مبلغ ریال، نام صاحب حساب، شرح، شناسه واریز). Internet-bank
  upload templates differ slightly per bank; column titles/order are kept in
  one place (PAYA_COLUMNS) so a bank's sample file can be matched quickly.
- mellat_pay:  Bank Mellat in-bank group deposit (.PAY), fixed width,
  Windows-1256: header = count(10) + total(15); each row = account(10) +
  amount(15) + transaction id(17) + note(30, right-aligned) + name(30,
  right-aligned). Payees must hold Mellat accounts.

Amounts are rial integers. Nothing here talks to a bank.
"""

from __future__ import annotations

import io

try:
	from ..utilities.validators import is_valid_iriban, normalize_national_id
	from .service import bank_name_from_iban
except ImportError:  # pragma: no cover
	from farda_iran.banking.service import bank_name_from_iban
	from farda_iran.utilities.validators import is_valid_iriban, normalize_national_id

PAYA_COLUMNS = ["ردیف", "شماره شبا", "مبلغ (ریال)", "نام صاحب حساب", "شرح", "شناسه واریز"]

FORMATS = {
	"paya_excel": {"label": "پایا گروهی — فایل اکسل (همهٔ بانک‌ها)", "ext": "xlsx", "needs": "iban"},
	"mellat_pay": {"label": "بانک ملت — واریز گروهی به حساب‌های ملت (.PAY)", "ext": "PAY", "needs": "account"},
}

BANK_FORMATS = {
	"ملت": ["paya_excel", "mellat_pay"],
	"ملی": ["paya_excel"],
	"سامان": ["paya_excel"],
	"پاسارگاد": ["paya_excel"],
	"تجارت": ["paya_excel"],
	"صادرات": ["paya_excel"],
}


def clean_iban(value: str) -> str:
	v = normalize_national_id(value or "").upper()
	if v.startswith("IR"):
		v = v[2:]
	return "IR" + v if v else ""


def validate_rows(rows: list[dict], fmt: str) -> list[str]:
	"""Persian problems, one per bad row; empty list = ready."""
	if fmt not in FORMATS:
		return ["قالب فایل بانک نامعتبر است."]
	problems = []
	if not rows:
		problems.append("هیچ ردیفی برای پرداخت وجود ندارد.")
	for i, r in enumerate(rows, 1):
		who = r.get("payee_name") or f"ردیف {i}"
		amt = r.get("amount") or 0
		if int(round(amt)) <= 0:
			problems.append(f"{who}: مبلغ باید بیشتر از صفر باشد.")
		if int(round(amt)) != amt:
			problems.append(f"{who}: مبلغ ریالی باید عدد صحیح باشد.")
		if not (r.get("payee_name") or "").strip():
			problems.append(f"ردیف {i}: نام صاحب حساب خالی است.")
		if FORMATS[fmt]["needs"] == "iban":
			if not is_valid_iriban(clean_iban(r.get("iban") or "")):
				problems.append(f"{who}: شماره شبا نامعتبر یا خالی است.")
		else:
			acc = normalize_national_id(r.get("account_no") or "")
			if not acc.isdigit() or not (1 <= len(acc) <= 10):
				problems.append(f"{who}: شماره حساب ملت باید حداکثر ۱۰ رقم باشد.")
	return problems


def build_paya_excel(rows: list[dict]) -> bytes:
	from openpyxl import Workbook

	wb = Workbook()
	ws = wb.active
	ws.title = "پرداخت گروهی"
	ws.sheet_view.rightToLeft = True
	ws.append(PAYA_COLUMNS)
	for i, r in enumerate(rows, 1):
		ws.append([
			i,
			clean_iban(r.get("iban")),
			int(round(r.get("amount") or 0)),
			(r.get("payee_name") or "").strip(),
			(r.get("description") or "").strip()[:100],
			(r.get("payment_id") or "").strip(),
		])
	for col, width in zip("ABCDEF", (6, 30, 16, 28, 40, 20)):
		ws.column_dimensions[col].width = width
	for row in ws.iter_rows(min_row=2, min_col=2, max_col=2):
		for cell in row:
			cell.number_format = "@"  # keep IBAN as text
	buf = io.BytesIO()
	wb.save(buf)
	return buf.getvalue()


def build_mellat_pay(rows: list[dict]) -> bytes:
	lines = [str(len(rows)).zfill(10) + str(sum(int(round(r.get("amount") or 0)) for r in rows)).zfill(15)]
	for r in rows:
		acc = normalize_national_id(r.get("account_no") or "").zfill(10)
		amt = str(int(round(r.get("amount") or 0))).zfill(15)
		txn = normalize_national_id(r.get("payment_id") or "")[:17].zfill(17)
		note = (r.get("description") or "").strip()[:30].rjust(30)
		name = (r.get("payee_name") or "").strip()[:30].rjust(30)
		lines.append(acc + amt + txn + note + name)
	return ("\r\n".join(lines) + "\r\n").encode("cp1256", errors="replace")


def build_file(rows: list[dict], fmt: str) -> bytes:
	problems = validate_rows(rows, fmt)
	if problems:
		raise ValueError("\n".join(problems))
	return build_paya_excel(rows) if fmt == "paya_excel" else build_mellat_pay(rows)


def summary(rows: list[dict]) -> dict:
	by_bank: dict[str, int] = {}
	for r in rows:
		b = bank_name_from_iban(clean_iban(r.get("iban") or "")) or "نامشخص"
		by_bank[b] = by_bank.get(b, 0) + 1
	return {"count": len(rows), "total": sum(int(round(r.get("amount") or 0)) for r in rows), "by_bank": by_bank}
