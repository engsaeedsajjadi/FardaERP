"""Build and check the Moadian invoice JSON (RC_IITP.IS_V7.8). Pure stdlib.

Only the general sale pattern (inp=1) is produced, as type 1 (full buyer data)
or type 2 (buyer optional), subject original (ins=1) or cancellation (ins=3).
Amounts are whole rials; every derived amount is TRUNCATED, never rounded
(general rule 1). `dis` is the discount of the whole line, not per unit.
"""

from __future__ import annotations

import re
from decimal import ROUND_DOWN, Decimal

from . import taxid as taxid_mod

WEEK_MS = 7 * 86_400_000
FUTURE_TOLERANCE_MS = 30_000

TOB_NATURAL, TOB_LEGAL, TOB_PARTNERSHIP, TOB_FOREIGN = 1, 2, 3, 4
SETM_CASH, SETM_CREDIT, SETM_MIXED = 1, 2, 3


def _d(value) -> Decimal:
	return Decimal(str(value if value not in (None, "") else 0))


def trunc(value) -> int:
	return int(_d(value).to_integral_value(rounding=ROUND_DOWN))


def _num(value: Decimal):
	"""JSON number: int when whole, else up to 8 decimals (am, fee are dec(18,8))."""
	q = value.quantize(Decimal("0.00000001"), rounding=ROUND_DOWN)
	return int(q) if q == q.to_integral_value() else float(q)


def _clean(d: dict) -> dict:
	return {k: v for k, v in d.items() if v not in (None, "")}


def _digits(value) -> str | None:
	if value in (None, ""):
		return None
	s = str(value).strip().translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
	s = re.sub(r"[\s\-_/]", "", s)
	return s or None


def build_line(line: dict) -> dict:
	am, fee = _d(line.get("am", 1)), _d(line.get("fee"))
	vra = _d(line.get("vra", 0))
	prdis = trunc(am * fee)
	dis = min(max(trunc(line.get("dis", 0)), 0), prdis)
	adis = prdis - dis
	vam = trunc(Decimal(adis) * vra / 100)
	return _clean(
		{
			"sstid": _digits(line.get("sstid")),
			"sstt": (str(line.get("sstt") or "").strip()[:400] or None),
			"am": _num(am),
			"mu": _digits(line.get("mu")),
			"fee": _num(fee),
			"prdis": prdis,
			"dis": dis,
			"adis": adis,
			"vra": _num(vra),
			"vam": vam,
			"tsstam": adis + vam,
		}
	)


def build(spec: dict) -> dict:
	"""spec keys: memory_id, serial, indatim (ms), seller_tin, inty (1|2), ins (1|3),
	irtaxid, buyer {tob, bid, tinb, bpc}, setm (1|2|3), paid_amount (rial incl. VAT,
	only for setm 3), lines [{sstid, sstt, am, mu, fee, dis, vra}]."""
	indatim = int(spec["indatim"])
	tid = taxid_mod.generate(spec["memory_id"], indatim, int(spec["serial"]))
	ins = int(spec.get("ins", 1))
	header = {
		"taxid": tid,
		"indatim": indatim,
		"inno": taxid_mod.inno_of(tid),
		"tins": _digits(spec.get("seller_tin")),
		"ins": ins,
	}
	if ins == 3:
		# cancellation: amounts, buyer, type and pattern come from the reference invoice
		header["irtaxid"] = (spec.get("irtaxid") or "").strip().upper() or None
		return {"header": _clean(header), "body": [], "payments": []}

	inty = int(spec.get("inty", 1))
	header.update(inty=inty, inp=1)
	buyer = spec.get("buyer") or {}
	if inty == 1 or any(buyer.get(k) for k in ("tinb", "bid")):
		header.update(
			tob=int(buyer["tob"]) if buyer.get("tob") else None,
			bid=_digits(buyer.get("bid")),
			tinb=_digits(buyer.get("tinb")),
			bpc=_digits(buyer.get("bpc")),
		)
	body = [build_line(x) for x in spec.get("lines") or []]
	tprdis = sum(b["prdis"] for b in body)
	tdis = sum(b["dis"] for b in body)
	tadis = sum(b["adis"] for b in body)
	tvam = sum(b["vam"] for b in body)
	tbill = sum(b["tsstam"] for b in body)
	header.update(tprdis=tprdis, tdis=tdis, tadis=tadis, tvam=tvam, todam=0, tbill=tbill)

	if inty == 1:
		setm = int(spec.get("setm") or SETM_CASH)
		if setm == SETM_MIXED:
			paid = _d(spec.get("paid_amount"))
			# cap/insp exclude VAT: cap + insp = tbill - tvam - todam (= tadis)
			cap = trunc(paid * tadis / tbill) if tbill else 0
			if cap <= 0:
				setm = SETM_CREDIT
			elif cap >= tadis:
				setm = SETM_CASH
			else:
				header.update(cap=cap, insp=tadis - cap)
		header["setm"] = setm
	return {"header": _clean(header), "body": body, "payments": []}


def _err(errors: list, field: str, msg: str) -> None:
	errors.append({"field": field, "message": msg})


def validate(inv: dict, now_ms: int | None = None) -> dict:
	"""Offline checks before sending. Returns {"ok", "errors", "warnings"} (Persian)."""
	errors: list = []
	warnings: list = []
	h = inv.get("header") or {}
	tid = h.get("taxid") or ""
	if not taxid_mod.is_valid(tid):
		_err(errors, "taxid", "شماره منحصر به فرد مالیاتی نامعتبر است")
	elif h.get("indatim") and not taxid_mod.is_valid(tid, h["indatim"]):
		_err(errors, "indatim", "روز تاریخ صدور با بخش تاریخ شماره مالیاتی یکی نیست")
	if not taxid_mod.is_valid_memory_id(tid[:6]):
		warnings.append({"field": "taxid", "message": "شناسه حافظه کاراکتر غیرمجاز دارد (۰، I، J، L، Q، V مجاز نیست)"})
	tins = h.get("tins") or ""
	if not re.fullmatch(r"\d{11}|\d{14}", tins):
		_err(errors, "tins", "شماره اقتصادی فروشنده باید ۱۱ یا ۱۴ رقم باشد (در اطلاعات شرکت وارد کنید)")
	if now_ms is not None and h.get("indatim"):
		if h["indatim"] > now_ms + FUTURE_TOLERANCE_MS:
			_err(errors, "indatim", "تاریخ صدور در آینده است")
		elif now_ms - h["indatim"] > WEEK_MS:
			_err(errors, "indatim", "بیش از یک هفته از تاریخ صدور گذشته؛ مهلت ارسال صورتحساب تمام شده است")

	ins = h.get("ins")
	if ins in (2, 3, 4):
		if not taxid_mod.is_valid(h.get("irtaxid") or ""):
			_err(errors, "irtaxid", "شماره مالیاتی صورتحساب مرجع نامعتبر است")
		return {"ok": not errors, "errors": errors, "warnings": warnings}

	if h.get("inty") == 1:
		tob, tinb, bid, bpc = h.get("tob"), h.get("tinb"), h.get("bid"), h.get("bpc")
		if tob not in (1, 2, 3, 4):
			_err(errors, "tob", "نوع شخصیت خریدار (حقیقی/حقوقی/…) در اطلاعات مشتری تعیین نشده است")
		elif tob in (2, 3) and not tinb:
			_err(errors, "tinb", "برای خریدار حقوقی شماره اقتصادی (شناسه ملی ۱۱ رقمی) لازم است")
		elif tob in (1, 4) and not tinb and not (bid and bpc):
			_err(errors, "bid", "برای خریدار حقیقی شماره اقتصادی یا «کد ملی + کد پستی» لازم است")
		if tinb and not re.fullmatch(r"\d{11}|\d{14}", tinb):
			_err(errors, "tinb", "شماره اقتصادی خریدار باید ۱۱ یا ۱۴ رقم باشد")
		if bid and not re.fullmatch(r"\d{10}|\d{11}|\d{12}", bid):
			_err(errors, "bid", "کد/شناسه ملی خریدار باید ۱۰، ۱۱ یا ۱۲ رقم باشد")
		if bpc and not re.fullmatch(r"\d{10}", bpc):
			_err(errors, "bpc", "کد پستی خریدار باید ۱۰ رقم باشد")
		if h.get("setm") not in (1, 2, 3):
			_err(errors, "setm", "روش تسویه نامعتبر است")

	body = inv.get("body") or []
	if not body:
		_err(errors, "body", "صورتحساب هیچ ردیف کالا/خدمتی ندارد")
	for i, b in enumerate(body, 1):
		where = f"ردیف {i}"
		if not re.fullmatch(r"\d{13}", b.get("sstid") or ""):
			_err(errors, f"body[{i}].sstid", f"{where}: شناسه ۱۳ رقمی کالا/خدمت مودیان در کارت کالا ثبت نشده است")
		if not _d(b.get("am")) > 0:
			_err(errors, f"body[{i}].am", f"{where}: مقدار باید بیشتر از صفر باشد")
		if not _d(b.get("fee")) > 0:
			_err(errors, f"body[{i}].fee", f"{where}: مبلغ واحد باید بیشتر از صفر باشد")
		if b.get("mu") and not re.fullmatch(r"\d{1,8}", b["mu"]):
			_err(errors, f"body[{i}].mu", f"{where}: کد واحد اندازه‌گیری باید عددی باشد")
		prdis = trunc(_d(b.get("am")) * _d(b.get("fee")))
		adis = prdis - int(b.get("dis") or 0)
		vam = trunc(Decimal(adis) * _d(b.get("vra")) / 100)
		if (b.get("prdis"), b.get("adis"), b.get("vam"), b.get("tsstam")) != (prdis, adis, vam, adis + vam):
			_err(errors, f"body[{i}]", f"{where}: محاسبات مبلغ با قواعد سامانه (قطع اعشار) سازگار نیست")
	if body:
		sums = {k: sum(int(b.get(k) or 0) for b in body) for k in ("prdis", "dis", "adis", "vam", "tsstam")}
		pairs = (("tprdis", "prdis"), ("tdis", "dis"), ("tadis", "adis"), ("tvam", "vam"), ("tbill", "tsstam"))
		if any(int(h.get(a) or 0) != sums[b] for a, b in pairs):
			_err(errors, "header", "جمع‌های سرآمد با جمع ردیف‌ها برابر نیست")
		if sums["prdis"] <= 0:
			_err(errors, "tprdis", "مبلغ کل صورتحساب باید بیشتر از صفر باشد")
		if h.get("setm") == 3 and int(h.get("cap", 0)) + int(h.get("insp", 0)) != sums["adis"]:
			_err(errors, "cap", "جمع مبلغ نقدی و نسیه (بدون مالیات) با مبلغ پس از تخفیف برابر نیست")
	return {"ok": not errors, "errors": errors, "warnings": warnings}


def summary(inv: dict) -> dict:
	h = inv.get("header") or {}
	return {
		"taxid": h.get("taxid"),
		"ins": h.get("ins"),
		"inty": h.get("inty"),
		"tob": h.get("tob"),
		"buyer": h.get("tinb") or h.get("bid"),
		"lines": len(inv.get("body") or []),
		"tadis": h.get("tadis"),
		"tvam": h.get("tvam"),
		"tbill": h.get("tbill"),
		"setm": h.get("setm"),
		"irtaxid": h.get("irtaxid"),
	}
