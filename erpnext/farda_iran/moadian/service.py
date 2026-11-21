"""Frappe glue for سامانه مودیان: Sales Invoice -> Moadian JSON -> sandbox/live.

Every ERPNext document maps to one Moadian subject:
  submitted invoice                    -> اصلی (ins 1)
  amendment of a registered invoice    -> اصلاحی (ins 2, irtaxid = latest registered version)
  credit note (return) of a registered -> برگشت از فروش (ins 4: sold minus returned so far);
                                          if nothing is left it becomes ابطال
  «ابطال در سامانه» button             -> ابطال (ins 3)
Documents linked by amended_from / return_against form one chain; every log
stores the chain root so the newest registered version is always referenced.

Two-step send: prepare() builds, validates and reserves a taxid (offline);
send(log, confirm_code) submits exactly what was shown (hash of JSON + target).
The target defaults to the sandbox; live needs FARDA_MOADIAN_ALLOW_LIVE=1.
Keys and the memory id come only from environment variables (config.py).
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import date, timezone
from decimal import ROUND_DOWN, Decimal

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, getdate, now_datetime

from . import client as mclient
from . import config as mconfig
from . import invoice as minv
from . import spec as S

LOG = "Farda Moadian Log"
SETTINGS = "Farda Moadian Settings"

READY, SENT, PROCESSING, OK, FAILED, NOT_FOUND, ERROR = (
	"آماده ارسال",
	"ارسال شد",
	"در حال پردازش",
	"ثبت شد",
	"رد شد",
	"یافت نشد",
	"خطای ارسال",
)
PENDING = (SENT, PROCESSING, ERROR)
INQUIRY_STATUS = {"SUCCESS": OK, "FAILED": FAILED, "IN_PROGRESS": PROCESSING, "NOT_FOUND": NOT_FOUND, "TIMEOUT": FAILED}

ORIGINAL, CORRECTION, CANCELLATION, RETURN = (S.SUBJECT_LABELS[i] for i in (1, 2, 3, 4))
INS_OF = {ORIGINAL: 1, CORRECTION: 2, CANCELLATION: 3, RETURN: 4}
ACTION_SUBJECT = {"original": ORIGINAL, "correction": CORRECTION, "cancel": CANCELLATION, "return": RETURN}
ACTION_LABEL = {
	"original": "ارسال به سامانه مودیان",
	"correction": "ارسال اصلاحیه به سامانه",
	"return": "ارسال برگشت از فروش به سامانه",
	"cancel": "ابطال در سامانه مودیان",
}

TOB = {"حقیقی": 1, "حقوقی": 2, "مشارکت مدنی": 3, "اتباع غیرایرانی": 4}
SETM_LABEL = {1: "نقدی", 2: "نسیه", 3: "نقدی و نسیه"}
PATTERN_OPTIONS = [f"{k} - {v}" for k, v in S.PATTERN_LABELS.items()]


# ---------------------------------------------------------------- helpers
def _settings():
	return frappe.get_cached_doc(SETTINGS) if frappe.db.exists("DocType", SETTINGS) else frappe._dict()


def _now_ms() -> int:
	return int(time.time() * 1000)


def _confirm_code(cfg, invoice_json: str) -> str:
	raw = f"{cfg.target}|{cfg.base_url}|{invoice_json}".encode("utf-8")
	return hashlib.sha256(raw).hexdigest()[:6].upper()


def _canonical(inv: dict) -> str:
	return json.dumps(inv, ensure_ascii=False, separators=(",", ":"))


def _doc_ms(doc) -> int:
	"""posting_date + posting_time in the site time zone -> Unix ms (never in the future)."""
	from zoneinfo import ZoneInfo

	local = get_datetime(f"{doc.posting_date} {doc.posting_time or '00:00:00'}").replace(microsecond=0)
	tz = ZoneInfo(frappe.utils.get_system_timezone() or "Asia/Tehran")
	ms = int(local.replace(tzinfo=tz).astimezone(timezone.utc).timestamp() * 1000)
	return min(ms, _now_ms())


def _unix_days(value) -> int | None:
	return (getdate(value) - date(1970, 1, 1)).days if value else None


def _choice(value) -> int | None:
	try:
		return int(str(value).split("-")[0].strip()) if value else None
	except ValueError:
		return None


def _next_serial() -> int:
	"""Ascending, never reused (row-locked on the Single + max already logged)."""
	frappe.db.sql("select value from `tabSingles` where doctype=%s and field='last_serial' for update", (SETTINGS,))
	current = cint(frappe.db.get_single_value(SETTINGS, "last_serial"))
	logged = cint(frappe.db.sql(f"select max(serial) from `tab{LOG}`")[0][0])
	serial = max(current, logged) + 1
	frappe.db.set_single_value(SETTINGS, "last_serial", serial)
	return serial


def _invoice_type(doc, override=None) -> int:
	if override in (1, 2, "1", "2"):
		return int(override)
	own = _choice(doc.get("farda_moadian_invoice_type"))
	if own in (1, 2):
		return own
	return 2 if (_settings().get("default_invoice_type") or "").startswith("نوع دوم") else 1


def _check_access(doc, ptype="submit"):
	if not frappe.has_permission("Sales Invoice", ptype, doc=doc):
		frappe.throw(_("شما مجوز ارسال این فاکتور به سامانه مودیان را ندارید"), frappe.PermissionError)


def ensure_pattern(doc) -> int:
	"""Fill the invoice pattern from settings when empty; return it as a number."""
	if not doc.get("farda_moadian_pattern") and doc.meta.has_field("farda_moadian_pattern"):
		doc.farda_moadian_pattern = _settings().get("default_pattern") or PATTERN_OPTIONS[0]
	return S.pattern_choice(doc.get("farda_moadian_pattern"))


# ---------------------------------------------------------------- rows -> lines
def raw_line(row, pattern: int, rate, doc=None, qty=None, net=None, meta=None) -> dict:
	"""Sales Invoice Item -> builder line (rial amounts, pattern-specific fields).
	qty/net override the row (used for 'sold minus returned' on sales returns)."""
	meta = meta or {}
	full_qty = flt(row.qty)
	qty = flt(full_qty if qty is None else qty)
	ratio = Decimal(str(qty)) / Decimal(str(full_qty)) if full_qty else Decimal(1)
	net = flt(row.base_net_amount if net is None else net)
	rate_rial, list_rial = flt(row.base_rate), flt(row.base_price_list_rate)
	unit = list_rial if list_rial > rate_rial else rate_rial
	gross = minv.trunc(Decimal(str(qty)) * Decimal(str(unit)))
	scaled = lambda f: minv.trunc(Decimal(str(flt(row.get(f)))) * ratio)  # noqa: E731
	line = {
		"sstid": meta.get("sstid"),
		"sstt": row.item_name or row.item_code,
		"am": qty,
		"mu": meta.get("mu"),
		"fee": unit,
		"dis": max(gross - minv.trunc(net), 0),
		"vra": rate,
	}
	for k in ("odt", "odr", "olt", "olr"):
		if row.get(f"farda_md_{k}"):
			line[k] = row.get(f"farda_md_{k}")
	if pattern == 2:  # currency sale: quantity = currency amount, rate = rial per unit
		cpr = flt(row.get("farda_md_cpr"))
		line.update(cfee=qty, exr=unit, cut=row.get("farda_md_cut"), cpr=cpr)
		line["sovat"] = scaled("farda_md_sovat") if row.get("farda_md_sovat") else minv.trunc(Decimal(str(qty)) * Decimal(str(unit - cpr)))
	elif pattern == 3:  # gold: price includes making fee + profit + commission
		consfee, spro, bros = scaled("farda_md_consfee"), scaled("farda_md_spro"), scaled("farda_md_bros")
		tcpbs = consfee + spro + bros
		fee = (Decimal(gross - tcpbs) / Decimal(str(qty))).quantize(Decimal("0.00000001"), rounding=ROUND_DOWN) if qty else 0
		line.update(fee=fee, consfee=consfee, spro=spro, bros=bros)
		if row.get("farda_md_cui"):
			line["cui"] = row.get("farda_md_cui")
	elif pattern == 6:  # airline ticket: one ticket per line, fee = ticket price
		line.update(am=1, fee=gross)
	elif pattern == 7:  # export: rial and currency value of the line
		foreign = doc is not None and doc.get("currency") and doc.currency != "IRR"
		line.update(
			ssrv=minv.trunc(net),
			sscv=(flt(row.net_amount) * float(ratio)) if foreign else flt(row.get("farda_md_sscv")) * float(ratio),
			cut=doc.currency if foreign else row.get("farda_md_cut"),
			exr=flt(doc.conversion_rate) if foreign else None,
			nw=flt(row.get("farda_md_nw") or row.get("total_weight")) * float(ratio) or None,
		)
	elif pattern == 9 and row.get("farda_md_vba"):
		line["vba"] = row.get("farda_md_vba")
	return line


def line_from_row(row, pattern: int, rate, doc=None) -> dict:
	return minv.build_line(raw_line(row, pattern, rate, doc=doc), pattern)


def _item_meta(items) -> dict:
	codes = sorted({r.item_code for r in items if r.item_code})
	if not codes:
		return {}
	default_mu = (_settings().get("default_unit_code") or "").strip() or None
	return {
		d.name: {"sstid": d.farda_sstid, "mu": d.farda_moadian_unit or default_mu}
		for d in frappe.get_all("Item", filters={"name": ["in", codes]}, fields=["name", "farda_sstid", "farda_moadian_unit"])
	}


def _row_rates(doc, pattern: int) -> list:
	from erpnext.farda_iran.tax.service import _get_exempt_flags, get_applicable_vat_rate

	rate = get_applicable_vat_rate(doc) if doc.get("farda_apply_vat") else 0.0
	if pattern in S.ZERO_VAT_PATTERNS:
		rate = 0
	items = doc.get("items") or []
	return [0 if ex else rate for ex in _get_exempt_flags(items)]


def _header_extra(doc, pattern: int) -> dict:
	g = lambda n: doc.get(f"farda_md_{n}")  # noqa: E731
	h = {"sbc": (_settings().get("seller_branch_code") or "").strip() or None}
	if pattern == 4:
		h["crn"] = g("crn")
	elif pattern == 5:
		h["billid"] = g("billid")
	elif pattern == 6:
		h.update(ft=_choice(g("ft")), tinc=g("tinc"), bpn=g("bpn"))
	elif pattern == 2:
		h["bpn"] = g("bpn")
	elif pattern == 7:
		h.update(scc=g("scc"), cdcn=g("cdcn"), cdcd=_unix_days(g("cdcd")), bpn=g("bpn"))
	elif pattern == 8:
		for k in ("lno", "lrno", "ocu", "oci", "dco", "dci", "tid", "rid", "cno", "did"):
			h[k] = g(k)
		h["lt"] = _choice(g("lt"))
		h["sg"] = [{"sgid": r.sgid, "sgt": r.sgt} for r in doc.get("farda_md_carried_goods") or []]
	elif pattern == 11:
		h.update(asn=g("asn"), asd=_unix_days(g("asd")))
	elif pattern == 13:
		h.update(**{"in": g("in"), "an": g("an")})
	return h


def _buyer(customer: str) -> dict:
	c = (
		frappe.db.get_value(
			"Customer",
			customer,
			["farda_person_type", "farda_national_id", "farda_legal_id", "farda_economic_code", "farda_postal_code"],
			as_dict=True,
		)
		or frappe._dict()
	)
	tob = TOB.get(c.farda_person_type)
	return {
		"tob": tob,
		"tinb": c.farda_economic_code,
		"bid": c.farda_legal_id if tob in (2, 3) else c.farda_national_id,
		"bpc": c.farda_postal_code,
	}


def _seller_tin(company: str):
	c = frappe.db.get_value("Company", company, ["farda_economic_code", "tax_id"], as_dict=True) or {}
	return c.get("farda_economic_code") or c.get("tax_id")


def _settlement(doc) -> tuple[int, float | None]:
	grand = flt(doc.rounded_total or doc.grand_total)
	outstanding = flt(doc.outstanding_amount)
	if outstanding <= 0.5:
		return 1, None
	if abs(outstanding - grand) <= 0.5:
		return 2, None
	return 3, (grand - outstanding) * flt(doc.conversion_rate or 1)


def _check_doc(doc) -> None:
	if frappe.get_cached_value("Company", doc.company, "default_currency") != "IRR":
		frappe.throw(_("ارز اصلی شرکت باید ریال (IRR) باشد؛ مبالغ سامانه مودیان ریالی است"))


def build_spec(doc, serial: int, memory_id: str, inty: int, indatim: int, ins: int = 1, irtaxid=None) -> dict:
	"""Submitted Sales Invoice -> builder spec (pure dict)."""
	if doc.docstatus != 1:
		frappe.throw(_("فقط فاکتور ثبت‌شده (Submit) را می‌توان به سامانه مودیان فرستاد"))
	_check_doc(doc)
	pattern = ensure_pattern(doc)
	items = doc.get("items") or []
	meta = _item_meta(items)
	lines = [
		raw_line(row, pattern, rate, doc=doc, meta=meta.get(row.item_code))
		for row, rate in zip(items, _row_rates(doc, pattern))
	]
	setm, paid = _settlement(doc)
	return {
		"memory_id": memory_id,
		"serial": serial,
		"indatim": indatim,
		"seller_tin": _seller_tin(doc.company),
		"inty": inty,
		"inp": pattern,
		"ins": ins,
		"irtaxid": irtaxid,
		"buyer": _buyer(doc.customer),
		"header": _header_extra(doc, pattern),
		"setm": setm,
		"paid_amount": paid,
		"lines": lines,
	}


def build_return_spec(credit_note, serial, memory_id, indatim, ref) -> dict | None:
	"""ins 4: the invoice that was sold, minus everything returned up to this credit note.
	Returns None when nothing is left (then the invoice must be cancelled instead)."""
	sold = frappe.get_doc("Sales Invoice", credit_note.return_against)
	_check_doc(sold)
	pattern = ensure_pattern(sold)
	returns = frappe.get_all(
		"Sales Invoice",
		filters={"return_against": sold.name, "docstatus": 1, "is_return": 1, "creation": ["<=", credit_note.creation]},
		pluck="name",
	)
	returned = {}
	for name in returns:
		for r in frappe.get_doc("Sales Invoice", name).items:
			key = r.get("sales_invoice_item") or r.item_code
			q, n = returned.get(key, (0.0, 0.0))
			returned[key] = (q - flt(r.qty), n - flt(r.base_net_amount))
	items = sold.get("items") or []
	meta = _item_meta(items)
	lines = []
	used = set()
	for row, rate in zip(items, _row_rates(sold, pattern)):
		key = row.name if row.name in returned else (row.item_code if row.item_code not in used else None)
		q, n = returned.get(key, (0.0, 0.0)) if key else (0.0, 0.0)
		if key:
			used.add(key)
		left_qty, left_net = flt(row.qty) - q, flt(row.base_net_amount) - n
		if left_qty <= 0:
			continue
		lines.append(raw_line(row, pattern, rate, doc=sold, qty=left_qty, net=left_net, meta=meta.get(row.item_code)))
	if not lines:
		return None
	ref_header = (json.loads(ref.invoice_json or "{}").get("header") or {}) if ref else {}
	setm = cint(ref_header.get("setm")) or _settlement(sold)[0]
	return {
		"memory_id": memory_id,
		"serial": serial,
		"indatim": indatim,
		"seller_tin": _seller_tin(sold.company),
		"inty": cint(ref.inty) or 1,
		"inp": pattern,
		"ins": 4,
		"irtaxid": ref.taxid,
		"header": _header_extra(sold, pattern),
		"setm": 2 if setm == 3 else setm,
		"lines": lines,
	}


# ---------------------------------------------------------------- chains
def chain_root(name: str) -> str:
	seen, cur = set(), name
	while cur and cur not in seen:
		seen.add(cur)
		d = frappe.db.get_value("Sales Invoice", cur, ["amended_from", "is_return", "return_against"], as_dict=True)
		if not d:
			break
		nxt = d.return_against if d.is_return and d.return_against else d.amended_from
		if not nxt:
			return cur
		cur = nxt
	return cur


def chain_state(root: str) -> frappe._dict:
	logs = frappe.get_all(
		LOG,
		filters={"chain_root": root},
		fields=["name", "sales_invoice", "subject", "status", "taxid", "uid", "reference_number", "target_label",
			"creation", "sent_at", "messages", "inty", "inp", "invoice_json", "indatim", "customer"],
		order_by="creation asc",
	)
	ok = sorted((l for l in logs if l.status == OK), key=lambda l: (l.sent_at or l.creation))
	last = ok[-1] if ok else None
	cancelled = bool(last and last.subject == CANCELLATION)
	return frappe._dict(
		logs=logs,
		registered=None if cancelled or not last else last,  # newest live version in the system
		cancelled=cancelled,
		pending=[l for l in logs if l.status in PENDING],
	)


def available_actions(doc) -> tuple[list[str], str | None]:
	if doc.docstatus not in (1, 2):
		return [], None
	st = chain_state(chain_root(doc.name))
	if st.pending:
		return [], "ارسال قبلی این فاکتور هنوز نتیجه نگرفته؛ ابتدا «استعلام وضعیت» را بزنید."
	own_ok = {l.subject for l in st.logs if l.sales_invoice == doc.name and l.status == OK}
	reg = st.registered
	if doc.is_return:
		if doc.docstatus != 1 or RETURN in own_ok or CANCELLATION in own_ok:
			return [], None
		if not reg:
			return [], "فاکتور اصلیِ این برگشتی در سامانه ثبت نشده یا ابطال شده است؛ ارسال برگشت لازم نیست."
		return ["return"], None
	actions = []
	if reg:
		if doc.docstatus == 1 and doc.name != reg.sales_invoice and doc.get("amended_from") and CORRECTION not in own_ok:
			actions.append("correction")
		actions.append("cancel")
	elif doc.docstatus == 1 and ORIGINAL not in own_ok:
		actions.append("original")
	return actions, None


def _set_invoice_fields(entry) -> None:
	value = f"{entry.subject}: {entry.status}"
	for name in {entry.sales_invoice, entry.chain_root} - {None, ""}:
		frappe.db.set_value(
			"Sales Invoice",
			name,
			{
				"farda_moadian_status": value,
				"farda_moadian_taxid": entry.taxid if entry.status == OK and entry.subject != CANCELLATION else frappe.db.get_value("Sales Invoice", name, "farda_moadian_taxid"),
				"farda_moadian_reference": entry.reference_number or "",
				"farda_moadian_log": entry.name,
			},
			update_modified=False,
		)


# ---------------------------------------------------------------- API
@frappe.whitelist()
def get_status(sales_invoice: str | None = None) -> dict:
	cfg = mconfig.load()
	out = {"config": cfg.public_view(), "enabled": cint(_settings().get("enabled", 1))}
	if sales_invoice:
		doc = frappe.get_doc("Sales Invoice", sales_invoice)
		doc.check_permission("read")
		actions, notice = available_actions(doc)
		root = chain_root(doc.name)
		st = chain_state(root)
		out.update(
			chain_root=root,
			actions=[{"action": a, "label": ACTION_LABEL[a]} for a in actions],
			notice=notice,
			pattern=S.pattern_choice(doc.get("farda_moadian_pattern")),
			logs=[
				{k: l[k] for k in ("name", "sales_invoice", "subject", "status", "taxid", "uid", "target_label", "creation")}
				for l in reversed(st.logs)
			][:15],
		)
	return out


@frappe.whitelist()
def test_connection() -> dict:
	"""Read-only call (fiscal-information) to check key, certificate and memory id."""
	frappe.only_for(("System Manager", "Accounts Manager"))
	cfg = mconfig.load()
	try:
		info = mclient.MoadianClient.from_config(cfg).fiscal_information()
	except mclient.MoadianError as exc:
		return {"ok": False, "message": str(exc), "detail": exc.body, "target_label": cfg.target_label}
	keep = {k: info.get(k) for k in ("nameTrade", "fiscalStatus", "economicCode", "saleThreshold") if isinstance(info, dict)}
	return {"ok": True, "message": "اتصال برقرار است", "info": keep, "target_label": cfg.target_label}


def _draft_for(doc_name: str, subject: str):
	rows = frappe.get_all(LOG, filters={"sales_invoice": doc_name, "subject": subject, "status": READY}, pluck="name", limit=1)
	return frappe.get_doc(LOG, rows[0]) if rows else None


def _correction_guard(doc, ref, spec_lines) -> None:
	"""S1 §5: buyer, type, pattern, goods ids and VAT rates cannot change in a correction."""
	if ref.customer and doc.customer != ref.customer:
		frappe.throw(_("خریدار تغییر کرده است؛ با اصلاحیه ممکن نیست. صورتحساب قبلی را ابطال و این فاکتور را به‌عنوان صورتحساب جدید بفرستید."))
	if cint(ref.inp) and cint(ref.inp) != S.pattern_choice(doc.get("farda_moadian_pattern")):
		frappe.throw(_("الگوی صورتحساب تغییر کرده است؛ ابطال و ارسال صورتحساب جدید لازم است."))
	before = {(b.get("sstid"), str(minv._d(b.get("vra")).normalize())) for b in (json.loads(ref.invoice_json or "{}").get("body") or [])}
	for ln in spec_lines:
		key = (minv._digits(ln.get("sstid")), str(minv._d(0 if cint(ref.inp) in S.ZERO_VAT_PATTERNS else ln.get("vra")).normalize()))
		if before and key not in before:
			frappe.throw(
				_("کالا با شناسه {0} یا نرخ مالیات آن در صورتحساب قبلی نبود؛ اصلاحیه فقط مبلغ و مقدار را تغییر می‌دهد. ابطال و ارسال صورتحساب جدید لازم است.").format(key[0] or "—")
			)


def _preview(log, cfg, validation) -> dict:
	inv = json.loads(log.invoice_json)
	summary = minv.summary(inv, inty=cint(log.inty), inp=cint(log.inp))
	summary["setm_label"] = SETM_LABEL.get(summary.get("setm"))
	return {
		"log": log.name,
		"status": log.status,
		"subject": log.subject,
		"summary": summary,
		"validation": validation,
		"config": cfg.public_view(),
		"confirm_code": log.confirm_code if validation["ok"] and not cfg.problems() else None,
		"invoice": inv,
	}


@frappe.whitelist(methods=["POST"])
def prepare(sales_invoice: str, action: str = "original", invoice_type=None) -> dict:
	"""Step 1 (offline): build + validate, reserve the taxid, return what will be sent."""
	doc = frappe.get_doc("Sales Invoice", sales_invoice)
	_check_access(doc)
	cfg = mconfig.load()
	if not cint(_settings().get("enabled", 1)):
		frappe.throw(_("ارسال به سامانه مودیان در «تنظیمات سامانه مودیان» غیرفعال است"))
	if not cfg.memory_id:
		frappe.throw(_("شناسه یکتای حافظه مالیاتی تنظیم نشده است (FARDA_MOADIAN_MEMORY_ID در فایل .env)"))
	allowed, notice = available_actions(doc)
	if action not in allowed:
		frappe.throw(notice or _("این عملیات برای این سند در وضعیت فعلی ممکن نیست"))

	root = chain_root(doc.name)
	st = chain_state(root)
	ref = st.registered
	subject = ACTION_SUBJECT[action]
	note = None
	if action == "return":
		indatim = _doc_ms(doc)
	elif action == "cancel":
		indatim = _now_ms()
	else:
		indatim = _doc_ms(doc)
	if ref and action != "original":
		indatim = min(max(indatim, cint(ref.indatim) + 1000), _now_ms())  # after the reference (S1 §7-2)

	log = _draft_for(doc.name, subject)
	day = indatim // minv.taxid_mod.DAY_MS
	if log and cint(log.indatim) // minv.taxid_mod.DAY_MS == day:
		serial = cint(log.serial)  # same draft, same day -> keep the reserved taxid
	else:
		serial = _next_serial()
		log = log or frappe.new_doc(LOG)

	inty = cint(ref.inty) if ref else _invoice_type(doc, invoice_type)
	if action == "original":
		spec = build_spec(doc, serial, cfg.memory_id, inty, indatim)
	elif action == "correction":
		spec = build_spec(doc, serial, cfg.memory_id, inty, indatim, ins=2, irtaxid=ref.taxid)
		_correction_guard(doc, ref, spec["lines"])
	elif action == "return":
		spec = build_return_spec(doc, serial, cfg.memory_id, indatim, ref)
		if spec is None:  # everything returned -> cancellation (S1 §5)
			subject = CANCELLATION
			note = "همه اقلام برگشت خورده است؛ طبق دستورالعمل، صورتحساب در سامانه «ابطال» می‌شود."
	if subject == CANCELLATION:
		spec = {"memory_id": cfg.memory_id, "serial": serial, "indatim": indatim, "seller_tin": _seller_tin(doc.company), "ins": 3, "irtaxid": ref.taxid}

	inv = minv.build(spec)
	payload = _canonical(inv)
	h = inv["header"]
	inp = cint(spec.get("inp")) or (cint(ref.inp) if ref else 1)
	log.update(
		{
			"sales_invoice": doc.name,
			"chain_root": root,
			"subject": subject,
			"status": READY,
			"company": doc.company,
			"customer": doc.customer,
			"inty": inty,
			"inp": inp,
			"pattern_label": S.PATTERN_LABELS.get(inp),
			"taxid": h["taxid"],
			"serial": serial,
			"indatim": str(h["indatim"]),
			"reference_taxid": h.get("irtaxid"),
			"tbill": h.get("tbill") or 0,
			"tvam": h.get("tvam") or 0,
			"target_label": cfg.target_label,
			"invoice_json": payload,
			"confirm_code": _confirm_code(cfg, payload),
			"messages": note or "",
		}
	)
	log.flags.ignore_permissions = True
	log.save() if not log.is_new() else log.insert()

	validation = minv.validate(inv, now_ms=_now_ms(), inty=inty, inp=inp)
	if note:
		validation["warnings"].insert(0, {"field": "ins", "message": note})
	if subject in (ORIGINAL, CORRECTION) and h.get("tbill") is not None:
		erp_total = minv.trunc(flt(doc.base_grand_total))  # before rounding adjustment
		if abs(erp_total - int(h["tbill"])) > max(len(inv["body"]), 1):
			validation["warnings"].append(
				{"field": "tbill", "message": f"جمع صورتحساب در سامانه ({h['tbill']:,} ریال) با جمع فاکتور ({erp_total:,} ریال) فرق دارد؛ مالیات‌ها و تخفیف‌های فاکتور را بررسی کنید."}
			)
	return _preview(log, cfg, validation)


@frappe.whitelist(methods=["POST"])
def send(log: str, confirm_code: str) -> dict:
	"""Step 2: re-check and submit exactly the JSON the user confirmed."""
	entry = frappe.get_doc(LOG, log)
	doc = frappe.get_doc("Sales Invoice", entry.sales_invoice)
	_check_access(doc)
	cfg = mconfig.load()
	if entry.status != READY:
		frappe.throw(_("این مورد در وضعیت «{0}» است و دوباره ارسال نمی‌شود").format(entry.status))
	problems = cfg.problems()
	if problems:
		frappe.throw("<br>".join(problems), title=_("تنظیمات اتصال کامل نیست"))
	if not confirm_code or confirm_code != _confirm_code(cfg, entry.invoice_json):
		frappe.throw(_("کد تأیید با صورتحساب یا محیط ارسال همخوانی ندارد؛ پیش‌نمایش را دوباره باز کنید"))
	st = chain_state(entry.chain_root or chain_root(doc.name))
	if st.pending:
		frappe.throw(_("ارسال دیگری از همین فاکتور هنوز نتیجه نگرفته؛ ابتدا استعلام کنید"))
	if entry.reference_taxid and (not st.registered or st.registered.taxid != entry.reference_taxid):
		frappe.throw(_("نسخهٔ ثبت‌شده در سامانه تغییر کرده است؛ پیش‌نمایش را دوباره باز کنید"))
	inv = json.loads(entry.invoice_json)
	check = minv.validate(inv, now_ms=_now_ms(), inty=cint(entry.inty), inp=cint(entry.inp))
	if not check["ok"]:
		frappe.throw("<br>".join(e["message"] for e in check["errors"]), title=_("صورتحساب قابل ارسال نیست"))

	entry.sent_at = now_datetime()
	entry.sent_by = frappe.session.user
	try:
		res = mclient.MoadianClient.from_config(cfg).send_invoices([inv])
		parsed = mclient.parse_send_result(res)
		entry.response_json = json.dumps(res, ensure_ascii=False, indent=1)[:60000]
		if parsed["uid"] and not parsed["errors"]:
			entry.status = PROCESSING
			entry.uid = parsed["uid"]
			entry.reference_number = parsed["reference_number"]
			entry.messages = "صورتحساب تحویل سامانه شد و در صف پردازش است. نتیجه با «استعلام وضعیت» مشخص می‌شود."
		else:
			entry.status = FAILED
			entry.messages = _format_messages(parsed["errors"], [])
	except mclient.MoadianError as exc:
		entry.status = ERROR
		entry.response_json = exc.body or ""
		entry.messages = (
			f"{exc}\nممکن است صورتحساب به سامانه رسیده باشد؛ پیش از هر اقدام دیگر، در کارپوشه بررسی کنید."
			" این شماره مالیاتی دوباره ارسال نمی‌شود."
		)
	entry.flags.ignore_permissions = True
	entry.save()
	_set_invoice_fields(entry)
	return {"status": entry.status, "messages": entry.messages, "log": entry.name, "uid": entry.uid}


def _format_messages(errors, warnings) -> str:
	def fmt(items, title):
		lines = []
		for e in items or []:
			if isinstance(e, dict):
				lines.append(f"• [{e.get('code') or '-'}] {e.get('message') or e.get('detail') or ''}".strip())
			else:
				lines.append(f"• {e}")
		return (title + ":\n" + "\n".join(lines)) if lines else ""

	return "\n\n".join(x for x in (fmt(errors, "خطاها"), fmt(warnings, "هشدارها")) if x)


def _apply_inquiry(entry, item: dict) -> None:
	r = mclient.parse_inquiry(item)
	entry.status = INQUIRY_STATUS.get(r["status"], entry.status)
	entry.reference_number = r["reference_number"] or entry.reference_number
	msgs = _format_messages(r["errors"], r["warnings"])
	if entry.status == OK:
		msgs = (f"{entry.subject} در سامانه مودیان ثبت شد.\n\n" + msgs).strip()
	elif entry.status == FAILED and not msgs:
		msgs = "سامانه صورتحساب را نپذیرفت. پس از اصلاح، دوباره ارسال کنید (با شماره مالیاتی جدید)."
	entry.messages = msgs
	entry.response_json = json.dumps(item, ensure_ascii=False, indent=1)[:60000]


@frappe.whitelist(methods=["POST"])
def inquire(log: str) -> dict:
	entry = frappe.get_doc(LOG, log)
	frappe.get_doc("Sales Invoice", entry.sales_invoice).check_permission("read")
	if not entry.uid:
		frappe.throw(_("برای این مورد شناسه پیگیری (UID) ثبت نشده است؛ وضعیت را در کارپوشه بررسی کنید"))
	cfg = mconfig.load()
	try:
		items = mclient.MoadianClient.from_config(cfg).inquiry_by_uid([entry.uid])
	except mclient.MoadianError as exc:
		frappe.throw(str(exc), title=_("استعلام انجام نشد"))
	entry.last_inquiry_at = now_datetime()
	entry.inquiry_count = cint(entry.inquiry_count) + 1
	match = next((i for i in items if i.get("uid") == entry.uid), items[0] if items else None)
	if match:
		_apply_inquiry(entry, match)
	entry.flags.ignore_permissions = True
	entry.save()
	_set_invoice_fields(entry)
	return {"status": entry.status, "messages": entry.messages, "log": entry.name}


@frappe.whitelist(methods=["POST"])
def resolve_unknown(log: str, registered: int = 0) -> dict:
	"""After a network error without UID: the accountant checked کارپوشه and records the result."""
	frappe.only_for(("System Manager", "Accounts Manager"))
	entry = frappe.get_doc(LOG, log)
	if entry.status != ERROR or entry.uid:
		frappe.throw(_("این مورد نیاز به ثبت دستی وضعیت ندارد"))
	entry.status = OK if cint(registered) else FAILED
	entry.messages = (entry.messages or "") + f"\n\nوضعیت پس از بررسی در کارپوشه به‌دست {frappe.session.user} ثبت شد."
	entry.flags.ignore_permissions = True
	entry.save()
	_set_invoice_fields(entry)
	return {"status": entry.status}


def poll_pending() -> None:
	"""Scheduler (every 10 min): ask the system about invoices still in progress."""
	if not frappe.db.exists("DocType", LOG) or not cint(_settings().get("auto_inquiry", 1)):
		return
	cfg = mconfig.load()
	if cfg.problems():
		return
	rows = frappe.get_all(LOG, filters={"status": ["in", (SENT, PROCESSING)], "uid": ["is", "set"]}, fields=["name", "uid"], limit=100)
	if not rows:
		return
	try:
		items = mclient.MoadianClient.from_config(cfg).inquiry_by_uid([r.uid for r in rows])
	except mclient.MoadianError:
		frappe.log_error("Farda Moadian: scheduled inquiry failed")
		return
	by_uid = {i.get("uid"): i for i in items}
	for r in rows:
		item = by_uid.get(r.uid)
		if not item:
			continue
		entry = frappe.get_doc(LOG, r.name)
		entry.last_inquiry_at = now_datetime()
		entry.inquiry_count = cint(entry.inquiry_count) + 1
		_apply_inquiry(entry, item)
		entry.flags.ignore_permissions = True
		entry.save()
		_set_invoice_fields(entry)
	frappe.db.commit()


def on_sales_invoice_cancel(doc, method=None) -> None:
	"""Cancelling in ERPNext does not cancel in the tax system — say what to do."""
	if not frappe.db.exists("DocType", LOG) or doc.is_return:
		return
	st = chain_state(chain_root(doc.name))
	if st.registered and not st.cancelled:
		frappe.msgprint(
			_(
				"این فاکتور در سامانه مودیان ثبت شده است و لغو آن در فردا، صورتحساب را در سامانه باطل نمی‌کند.<br>"
				"• اگر فاکتور را <b>اصلاح (Amend)</b> می‌کنید: پس از ثبت نسخهٔ جدید، دکمه «ارسال اصلاحیه به سامانه» را بزنید.<br>"
				"• اگر معامله کلاً انجام نشده: از دکمه «ابطال در سامانه مودیان» استفاده کنید."
			),
			title=_("سامانه مودیان"),
			indicator="orange",
		)


@frappe.whitelist()
def default_pattern() -> str:
	"""Business pattern from settings, used by the form before the first save."""
	return _settings().get("default_pattern") or PATTERN_OPTIONS[0]
