"""Build and check the Moadian invoice JSON (RC_IITP.IS_V7.8). Pure stdlib.

Covers every pattern of V7.8 (inp 1–9, 11, 13, 14), invoice types 1 and 2,
and every subject: original (1), correction (2), cancellation (3), sales
return (4). Amounts are whole rials and every derived amount is TRUNCATED,
never rounded (general rule 1). `dis` is the discount of the whole line.
Fields the pattern marks «خارج از الگو» are removed before sending.
"""

from __future__ import annotations

import re
from decimal import ROUND_DOWN, Decimal

from . import spec as S
from . import taxid as taxid_mod

WEEK_MS = 7 * 86_400_000
FUTURE_TOLERANCE_MS = 30_000

TOB_NATURAL, TOB_LEGAL, TOB_PARTNERSHIP, TOB_FOREIGN = 1, 2, 3, 4
SETM_CASH, SETM_CREDIT, SETM_MIXED = 1, 2, 3
INS_ORIGINAL, INS_CORRECTION, INS_CANCEL, INS_RETURN = 1, 2, 3, 4
IRAN = "364"  # ISO 3166 numeric, used by the waybill pattern for city codes

BUYER_FIELDS = ("tob", "bid", "tinb", "bpc", "bbc")
ALWAYS = ("taxid", "indatim", "inno", "ins", "irtaxid", "tins")
HEADER_EXTRA = (
	"sbc", "bbc", "ft", "bpn", "scln", "scc", "cdcn", "cdcd", "crn", "billid", "tax17", "tinc",
	"lno", "lrno", "ocu", "oci", "dco", "dci", "tid", "rid", "lt", "cno", "did", "sg", "asn", "asd", "in", "an",
)
LINE_TEXT = ("sstid", "sstt", "mu", "cut", "odt", "olt", "bsrn")


def _d(value) -> Decimal:
	return Decimal(str(value if value not in (None, "") else 0))


def trunc(value) -> int:
	return int(_d(value).to_integral_value(rounding=ROUND_DOWN))


def _q(value, places: int):
	"""Decimal truncated to `places` decimals, as int when whole (JSON number)."""
	q = _d(value).quantize(Decimal(1).scaleb(-places), rounding=ROUND_DOWN)
	return int(q) if q == q.to_integral_value() else float(q)


def _clean(d: dict) -> dict:
	return {k: v for k, v in d.items() if v not in (None, "", [])}


_FOLD = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _digits(value) -> str | None:
	if value in (None, ""):
		return None
	s = re.sub(r"[\s\-_/]", "", str(value).strip().translate(_FOLD))
	return s or None


def _text(value, limit=400) -> str | None:
	s = str(value or "").strip()
	return s[:limit] or None


def _given(line: dict, key: str) -> bool:
	return line.get(key) not in (None, "")


# ---------------------------------------------------------------- body
def build_line(line: dict, inp: int = 1) -> dict:
	"""One body row. Arithmetic per pattern (S1 §7-38…§7-51, arithmetic rules R4–R19)."""
	am, fee, vra = _d(line.get("am", 1)), _d(line.get("fee")), _d(line.get("vra", 0))
	if inp in S.ZERO_VAT_PATTERNS:
		vra = Decimal(0)
	out = {k: _digits(line.get(k)) if k in ("sstid", "mu", "bsrn") else _text(line.get(k), 255) for k in LINE_TEXT}
	out["sstt"] = _text(line.get("sstt"))
	out["cut"] = (_text(line.get("cut"), 3) or "").upper() or None
	out.update(am=_q(am, 8), vra=_q(vra, 2))
	if _given(line, "nw"):
		out["nw"] = _q(line["nw"], 8)
	if _given(line, "cui"):
		out["cui"] = _q(line["cui"], 2)
	if _given(line, "exr"):
		out["exr"] = _q(line["exr"], 8)

	if inp == 7:  # export: base is the rial value per customs licence
		ssrv, sscv = trunc(line.get("ssrv")), _q(line.get("sscv"), 4)
		if fee > 0:
			out["fee"] = _q(fee, 8)
		vam = trunc(Decimal(ssrv) * vra / 100)
		base = total = ssrv
		out.update(ssrv=ssrv, sscv=sscv)
	else:
		if inp == 2:  # currency sale: prdis = cfee × exr, VAT base = sovat
			cfee = _d(line.get("cfee"))
			prdis = trunc(cfee * _d(line.get("exr")))
			out.update(cfee=_q(cfee, 4), cpr=_q(line.get("cpr"), 8), sovat=trunc(line.get("sovat")))
		else:
			prdis = trunc(fee) if inp == 6 else trunc(am * fee)
			out["fee"] = _q(fee, 8)
			if _given(line, "cfee"):
				out["cfee"] = _q(line["cfee"], 4)
		dis = min(max(trunc(line.get("dis", 0)), 0), prdis)
		if inp == 3:  # gold: VAT on making fee + profit + commission
			consfee, spro, bros = trunc(line.get("consfee")), trunc(line.get("spro")), trunc(line.get("bros"))
			tcpbs = consfee + spro + bros
			adis = prdis + tcpbs - dis
			vam = trunc(Decimal(tcpbs) * 10 / 100 + Decimal(prdis) * vra / 100)
			base, total = tcpbs, adis  # levies are charged on tcpbs; the line total stays adis
			out.update(consfee=consfee, spro=spro, bros=bros, tcpbs=tcpbs)
		else:
			adis = prdis - dis
			if inp == 2:
				vam = trunc(Decimal(out["sovat"]) * vra / 100)
			elif inp == 9 and _given(line, "vba"):
				vam = trunc(am * _d(line["vba"]))
				out["vba"] = _q(line["vba"], 4)
			else:
				vam = trunc(Decimal(adis) * vra / 100)
			base = total = adis
		out.update(prdis=prdis, dis=dis, adis=adis)

	extra = {}
	for amt, rate in (("odam", "odr"), ("olam", "olr")):
		if _given(line, rate):
			extra[rate] = _q(line[rate], 2)
			extra[amt] = trunc(Decimal(base) * _d(line[rate]) / 100)
		elif _given(line, amt):
			extra[amt] = trunc(line[amt])
	out.update(extra)
	out["vam"] = vam
	out["tsstam"] = total + vam + extra.get("odam", 0) + extra.get("olam", 0)
	return _clean(out)


# ---------------------------------------------------------------- build
def _strip_out_of_pattern(section: dict, inty: int, inp: int, keep=ALWAYS) -> dict:
	return {k: v for k, v in section.items() if k in keep or S.status(k, inty, inp) not in ("-",)}


def build(spec: dict) -> dict:
	"""spec: memory_id, serial, indatim (ms), seller_tin, inty, inp, ins, irtaxid,
	buyer {tob,bid,tinb,bpc,bbc}, header {pattern header fields}, setm, paid_amount
	(rial incl. VAT, setm 3 only), lines [...], payments [...]."""
	indatim = int(spec["indatim"])
	tid = taxid_mod.generate(spec["memory_id"], indatim, int(spec["serial"]))
	ins = int(spec.get("ins", INS_ORIGINAL))
	inty = int(spec.get("inty", 1))
	inp = S.pattern_choice(spec.get("inp", 1))
	header = {
		"taxid": tid,
		"indatim": indatim,
		"inno": taxid_mod.inno_of(tid),
		"tins": _digits(spec.get("seller_tin")),
		"ins": ins,
		"irtaxid": (spec.get("irtaxid") or "").strip().upper() or None if ins != INS_ORIGINAL else None,
	}
	if ins == INS_CANCEL:
		# cancellation: amounts, buyer, type and pattern come from the reference invoice
		return {"header": _clean(header), "body": [], "payments": []}

	if ins == INS_ORIGINAL:
		header.update(inty=inty, inp=inp)
		buyer = spec.get("buyer") or {}
		header.update(
			tob=int(buyer["tob"]) if buyer.get("tob") else None,
			bid=_digits(buyer.get("bid")),
			tinb=_digits(buyer.get("tinb")),
			bpc=_digits(buyer.get("bpc")),
			bbc=_digits(buyer.get("bbc")),
		)
	for k, v in (spec.get("header") or {}).items():
		if k not in HEADER_EXTRA or v in (None, "", []):
			continue
		if k == "sg":
			header[k] = [_clean({"sgid": _digits(x.get("sgid")), "sgt": _text(x.get("sgt"))}) for x in v]
		elif k in ("ft", "lt", "cdcd", "asd"):
			header[k] = int(v)
		elif k in ("bpn", "cdcn", "cno"):
			header[k] = _text(v, 20)
		elif k == "tax17":
			header[k] = trunc(v)
		else:
			header[k] = _digits(v)

	body = [build_line(x, inp) for x in spec.get("lines") or []]
	tot = lambda key: sum(int(b.get(key) or 0) for b in body)  # noqa: E731
	tvam, todam, tbill = tot("vam"), tot("odam") + tot("olam"), tot("tsstam")
	header.update(tprdis=tot("prdis"), tdis=tot("dis"), tadis=tot("adis"), tvam=tvam, todam=todam, tbill=tbill)
	if inp == 7:
		header.update(torv=tot("ssrv"), tocv=_q(sum(_d(b.get("sscv")) for b in body), 4))
		if any("nw" in b for b in body):
			header["tonw"] = _q(sum(_d(b.get("nw")) for b in body), 8)
		for k in ("tprdis", "tdis", "tadis"):
			header.pop(k)

	if inty == 1:
		setm = int(spec.get("setm") or SETM_CASH)
		net = tbill - tvam - todam  # cap + insp exclude VAT and other levies
		if setm == SETM_MIXED:
			paid = _d(spec.get("paid_amount"))
			cap = trunc(paid * net / tbill) if tbill else 0
			if cap <= 0:
				setm = SETM_CREDIT
			elif cap >= net:
				setm = SETM_CASH
			else:
				header.update(cap=cap, insp=net - cap)
		header["setm"] = setm

	payments = [_clean({k: (_digits(v) if k not in ("pmt", "pdt", "pv") else int(v)) for k, v in p.items() if v not in (None, "")})
		for p in spec.get("payments") or []]

	# drop fields this pattern ignores (S1 Table 1 «خارج از الگو»)
	header = _strip_out_of_pattern(header, inty, inp)
	body = [_strip_out_of_pattern(b, inty, inp, keep=()) for b in body]
	if ins in (INS_CORRECTION, INS_RETURN):
		for k in BUYER_FIELDS + ("inty", "inp"):
			header.pop(k, None)  # taken from the reference invoice (S1 §7-8 rule 3)
	return {"header": _clean(header), "body": body, "payments": payments}


# ---------------------------------------------------------------- checks
_TYPE = re.compile(r"^(S|N|I|D)(.*)$")


def _format_ok(field: str, value) -> bool:
	code = S.FIELDS.get(field, (None, "?"))[1]
	m = _TYPE.match(code or "")
	if not m or code == "?" or isinstance(value, (list, dict)):
		return True
	kind, rest = m.groups()
	text = str(value)
	if kind == "S":
		n = len(text)
		return n <= int(rest[2:]) if rest.startswith("<=") else n == int(rest)
	if kind == "N":
		if not text.isdigit():
			return False
		if rest.startswith("<="):
			return 1 <= len(text) <= int(rest[2:])
		if "-" in rest:
			lo, hi = rest.split("-")
			return int(lo) <= len(text) <= int(hi)
		return len(text) in {int(x) for x in rest.split("|")}
	if kind == "I":
		return isinstance(value, int) and len(str(abs(value))) <= int(rest.lstrip("<="))
	whole, frac = (int(x) for x in rest.split(","))
	dv = _d(value)
	if dv < 0:
		return False
	sign, digits, exp = dv.normalize().as_tuple()
	fd = max(-exp, 0)
	return fd <= frac and len(str(int(dv))) <= whole


def _err(errors: list, field: str, msg: str) -> None:
	errors.append({"field": field, "message": msg})


def validate(inv: dict, now_ms: int | None = None, inty: int | None = None, inp: int | None = None) -> dict:
	"""Offline checks before sending. Returns {"ok", "errors", "warnings"} (Persian).
	For subjects 2/3/4 pass the reference invoice's inty/inp (they are not in the header)."""
	errors: list = []
	warnings: list = []
	h = inv.get("header") or {}
	ins = h.get("ins")
	inty = h.get("inty", inty) or 1
	inp = h.get("inp", inp) or 1
	tid = h.get("taxid") or ""
	if not taxid_mod.is_valid(tid):
		_err(errors, "taxid", "شماره منحصر به فرد مالیاتی نامعتبر است")
	elif h.get("indatim") and not taxid_mod.is_valid(tid, h["indatim"]):
		_err(errors, "indatim", "روز تاریخ صدور با بخش تاریخ شماره مالیاتی یکی نیست")
	if tid and not taxid_mod.is_valid_memory_id(tid[:6]):
		warnings.append({"field": "taxid", "message": "شناسه حافظه کاراکتر غیرمجاز دارد (۰، I، J، L، Q، V مجاز نیست)"})
	if not re.fullmatch(r"\d{11}|\d{14}", h.get("tins") or ""):
		_err(errors, "tins", "شماره اقتصادی فروشنده باید ۱۱ یا ۱۴ رقم باشد (در اطلاعات شرکت وارد کنید)")
	if now_ms is not None and h.get("indatim"):
		if h["indatim"] > now_ms + FUTURE_TOLERANCE_MS:
			_err(errors, "indatim", "تاریخ صدور در آینده است")
		elif ins == INS_ORIGINAL and now_ms - h["indatim"] > WEEK_MS:
			_err(errors, "indatim", "بیش از یک هفته از تاریخ صدور گذشته؛ مهلت ارسال صورتحساب تمام شده است")
	if ins not in (1, 2, 3, 4):
		_err(errors, "ins", "موضوع صورتحساب نامعتبر است")
	if ins in (2, 3, 4) and not taxid_mod.is_valid(h.get("irtaxid") or ""):
		_err(errors, "irtaxid", "شماره مالیاتی صورتحساب مرجع نامعتبر است")
	if ins == INS_CANCEL:
		return {"ok": not errors, "errors": errors, "warnings": warnings}

	plabel = S.PATTERN_LABELS.get(inp, str(inp))
	if inp not in S.PATTERN_LABELS:
		_err(errors, "inp", "الگوی صورتحساب نامعتبر است")
	if inty == 2 and inp not in S.PATTERNS_BY_TYPE[2]:
		_err(errors, "inty", f"صورتحساب نوع دوم برای الگوی «{plabel}» مجاز نیست؛ نوع اول را انتخاب کنید")
	if ins == INS_RETURN and inp in S.NO_RETURN_PATTERNS:
		_err(errors, "ins", f"برگشت از فروش برای الگوی «{plabel}» مجاز نیست؛ صورتحساب را ابطال کنید")

	# mandatory fields of this type/pattern (buyer fields only on originals)
	for f in S.section_fields("header"):
		if f in ("sg", "sgid", "sgt", "tob") or (ins != INS_ORIGINAL and f in BUYER_FIELDS + ("inty", "inp")):
			continue
		if S.status(f, inty, 1 if inp not in S.PATTERN_LABELS else inp) == "M" and h.get(f) in (None, "", []):
			_err(errors, f, f"«{S.label(f)}» برای الگوی «{plabel}» الزامی است")
	if inp == 8:
		if not h.get("sg"):
			_err(errors, "sg", "فهرست کالاهای حمل‌شده (شناسه و شرح) برای بارنامه الزامی است")
		for side, city in (("ocu", "oci"), ("dco", "dci")):
			if h.get(side) == IRAN and not h.get(city):
				_err(errors, city, f"«{S.label(city)}» وقتی کشور ایران است الزامی است")
		if h.get("lt") == 1 and not h.get("did"):
			_err(errors, "did", "برای حمل جاده‌ای شماره ملی راننده الزامی است")

	if ins == INS_ORIGINAL and inty == 1 and inp not in (7, 11):
		tob, tinb, bid, bpc = h.get("tob"), h.get("tinb"), h.get("bid"), h.get("bpc")
		if tob not in (1, 2, 3, 4):
			_err(errors, "tob", "نوع شخصیت خریدار (حقیقی/حقوقی/…) در اطلاعات مشتری تعیین نشده است")
		elif tob in (2, 3) and not tinb:
			_err(errors, "tinb", "برای خریدار حقوقی یا مشارکت مدنی، شماره اقتصادی لازم است")
		elif tob in (1, 4) and not tinb and not (bid and bpc) and inp not in (5, 6):
			_err(errors, "bid", "برای خریدار حقیقی، شماره اقتصادی یا «کد ملی + کد پستی» لازم است")

	for f, v in h.items():
		if f in S.FIELDS and not _format_ok(f, v):
			_err(errors, f, f"قالب «{S.label(f)}» نادرست است")

	body = inv.get("body") or []
	if not body:
		_err(errors, "body", "صورتحساب هیچ ردیف کالا/خدمتی ندارد")
	if inp in S.SINGLE_LINE_PATTERNS and len(body) > 1:
		_err(errors, "body", f"الگوی «{plabel}» فقط یک ردیف کالا می‌پذیرد")
	for i, b in enumerate(body, 1):
		where = f"ردیف {i}"
		for f in S.section_fields("body"):
			if S.status(f, inty, inp if inp in S.PATTERN_LABELS else 1) == "M" and b.get(f) in (None, ""):
				_err(errors, f"body[{i}].{f}", f"{where}: «{S.label(f)}» الزامی است")
		for f, v in b.items():
			if f in S.FIELDS and not _format_ok(f, v):
				_err(errors, f"body[{i}].{f}", f"{where}: قالب «{S.label(f)}» نادرست است")
		if inp not in (2, 7) and not _d(b.get("am")) > 0:
			_err(errors, f"body[{i}].am", f"{where}: مقدار باید بیشتر از صفر باشد")
		if inp not in (2, 7, 11) and not _d(b.get("fee")) > 0:
			_err(errors, f"body[{i}].fee", f"{where}: مبلغ واحد باید بیشتر از صفر باشد")
		if inp in S.ZERO_VAT_PATTERNS and _d(b.get("vra")) != 0:
			_err(errors, f"body[{i}].vra", f"{where}: نرخ مالیات در الگوی «{plabel}» باید صفر باشد")
		if _d(b.get("vra")) == 0 and (int(b.get("odam") or 0) or int(b.get("olam") or 0)):
			_err(errors, f"body[{i}].odam", f"{where}: وقتی نرخ مالیات صفر است، سایر مالیات و عوارض هم باید صفر باشد")
		if inp == 2:
			cpr, exr = _d(b.get("cpr")), _d(b.get("exr"))
			if not (0 < cpr < exr):
				_err(errors, f"body[{i}].cpr", f"{where}: نرخ خرید ارز باید بیشتر از صفر و کمتر از نرخ فروش باشد")
			cfee, sovat = _d(b.get("cfee")), _d(b.get("sovat"))
			if not (cfee * (exr - cpr) <= sovat + 1 and sovat <= cfee * exr):
				_err(errors, f"body[{i}].sovat", f"{where}: مأخذ مالیات فروش ارز خارج از بازه مجاز است")
		if inp == 3 and int(b.get("consfee") or 0) >= int(b.get("prdis") or 0) > 0:
			warnings.append({"field": f"body[{i}].consfee", "message": f"{where}: اجرت ساخت باید کمتر از ارزش طلا باشد"})
		# arithmetic: rebuild the line from its own inputs and compare
		probe = dict(b, am=1, fee=b.get("adis"), dis=0) if inp == 11 else b
		again = build_line(probe, inp)
		for f in ("prdis", "adis", "tcpbs", "vam", "odam", "olam", "tsstam"):
			if f in b and again.get(f) != b.get(f):
				_err(errors, f"body[{i}].{f}", f"{where}: «{S.label(f)}» با قواعد محاسبه سامانه (قطع اعشار) سازگار نیست")
				break
	if body:
		sums = {k: sum(int(b.get(k) or 0) for b in body) for k in ("prdis", "dis", "adis", "vam", "tsstam", "ssrv")}
		sums["todam"] = sum(int(b.get("odam") or 0) + int(b.get("olam") or 0) for b in body)
		pairs = (("tprdis", "prdis"), ("tdis", "dis"), ("tadis", "adis"), ("tvam", "vam"), ("tbill", "tsstam"), ("todam", "todam"), ("torv", "ssrv"))
		if any(a in h and int(h.get(a) or 0) != sums[b] for a, b in pairs):
			_err(errors, "header", "جمع‌های سرآمد با جمع ردیف‌ها برابر نیست")
		if inp != 7 and sums["prdis"] <= 0 and "tprdis" in h:
			_err(errors, "tprdis", "مبلغ کل صورتحساب باید بیشتر از صفر باشد")
		if h.get("setm") == 3:
			net = sums["tsstam"] - sums["vam"] - sums["todam"]
			if int(h.get("cap", 0)) + int(h.get("insp", 0)) != net:
				_err(errors, "cap", "جمع مبلغ نقدی و نسیه (بدون مالیات) درست نیست")
	if inty == 1 and ins != INS_CANCEL and S.status("setm", 1, inp) == "M" and h.get("setm") not in (1, 2, 3):
		_err(errors, "setm", "روش تسویه نامعتبر است")
	if int(h.get("tax17") or 0) > int(h.get("tvam") or 0):
		_err(errors, "tax17", "مالیات موضوع ماده ۱۷ نمی‌تواند بیشتر از مالیات بر ارزش افزوده باشد")
	seen, unique = set(), []
	for e in errors:
		if e["field"] not in seen:
			seen.add(e["field"])
			unique.append(e)
	return {"ok": not unique, "errors": unique, "warnings": warnings}


def summary(inv: dict, inty=None, inp=None) -> dict:
	h = inv.get("header") or {}
	inp = h.get("inp", inp)
	return {
		"taxid": h.get("taxid"),
		"ins": h.get("ins"),
		"subject_label": S.SUBJECT_LABELS.get(h.get("ins")),
		"inty": h.get("inty", inty),
		"inp": inp,
		"pattern_label": S.PATTERN_LABELS.get(inp),
		"tob": h.get("tob"),
		"buyer": h.get("tinb") or h.get("bid"),
		"lines": len(inv.get("body") or []),
		"tadis": h.get("tadis", h.get("torv")),
		"tvam": h.get("tvam"),
		"todam": h.get("todam"),
		"tbill": h.get("tbill"),
		"setm": h.get("setm"),
		"irtaxid": h.get("irtaxid"),
	}
