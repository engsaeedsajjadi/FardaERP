"""Frappe glue for سامانه مودیان: Sales Invoice -> Moadian JSON -> sandbox/live.

Two-step send, as agreed with the user:
  1. prepare(): builds and validates the JSON, reserves a serial/taxid, stores a
     «آماده ارسال» log and returns a summary + confirmation code. Offline.
  2. send(log, confirm_code): re-checks everything; the code must match a hash
     of the exact JSON + target + base URL, so what was shown is what is sent.
The target defaults to the sandbox; live needs FARDA_MOADIAN_ALLOW_LIVE=1.
Keys and the memory id come only from environment variables (config.py).
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, now_datetime

from . import client as mclient
from . import config as mconfig
from . import invoice as minv

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
ORIGINAL, CANCELLATION = "اصلی", "ابطال"
PENDING = (SENT, PROCESSING, ERROR)
INQUIRY_STATUS = {"SUCCESS": OK, "FAILED": FAILED, "IN_PROGRESS": PROCESSING, "NOT_FOUND": NOT_FOUND, "TIMEOUT": FAILED}

TOB = {"حقیقی": 1, "حقوقی": 2, "مشارکت مدنی": 3, "اتباع غیرایرانی": 4}
SETM_LABEL = {1: "نقدی", 2: "نسیه", 3: "نقدی و نسیه"}


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


def _indatim_ms(doc) -> int:
	"""posting_date + posting_time in the site time zone -> Unix ms (never in the future)."""
	from zoneinfo import ZoneInfo

	local = get_datetime(f"{doc.posting_date} {doc.posting_time or '00:00:00'}").replace(microsecond=0)
	tz = ZoneInfo(frappe.utils.get_system_timezone() or "Asia/Tehran")
	ms = int(local.replace(tzinfo=tz).astimezone(timezone.utc).timestamp() * 1000)
	return min(ms, _now_ms())


def _next_serial() -> int:
	"""Ascending, never reused (row-locked on the Single + max already logged)."""
	frappe.db.sql(
		"select value from `tabSingles` where doctype=%s and field='last_serial' for update", (SETTINGS,)
	)
	current = cint(frappe.db.get_single_value(SETTINGS, "last_serial"))
	logged = cint(frappe.db.sql(f"select max(serial) from `tab{LOG}`")[0][0])
	serial = max(current, logged) + 1
	frappe.db.set_single_value(SETTINGS, "last_serial", serial)
	return serial


def _digits(v) -> str:
	return minv._digits(v) or ""


def _invoice_type(s, override=None) -> int:
	if override in (1, 2, "1", "2"):
		return int(override)
	return 2 if (s.get("default_invoice_type") or "").startswith("نوع دوم") else 1


def _check_access(doc, ptype="submit"):
	if not frappe.has_permission("Sales Invoice", ptype, doc=doc):
		frappe.throw(_("شما مجوز ارسال این فاکتور به سامانه مودیان را ندارید"), frappe.PermissionError)


def _set_invoice_fields(invoice: str, log) -> None:
	frappe.db.set_value(
		"Sales Invoice",
		invoice,
		{
			"farda_moadian_status": f"{log.subject}: {log.status}",
			"farda_moadian_taxid": log.taxid if log.subject == ORIGINAL else frappe.db.get_value("Sales Invoice", invoice, "farda_moadian_taxid"),
			"farda_moadian_reference": log.reference_number or "",
			"farda_moadian_log": log.name,
		},
		update_modified=False,
	)


# ---------------------------------------------------------------- mapping
def build_spec(doc, serial: int, memory_id: str, inty: int, indatim: int) -> dict:
	"""Sales Invoice -> builder spec (pure dict). Raises with a Persian message."""
	if doc.docstatus != 1:
		frappe.throw(_("فقط فاکتور ثبت‌شده (Submit) را می‌توان به سامانه مودیان فرستاد"))
	if doc.is_return:
		frappe.throw(_("فاکتور برگشتی در این نسخه ارسال نمی‌شود؛ برای برگشت کامل، صورتحساب اصلی را در سامانه ابطال کنید"))
	company_currency = frappe.get_cached_value("Company", doc.company, "default_currency")
	if company_currency != "IRR":
		frappe.throw(_("ارز اصلی شرکت باید ریال (IRR) باشد؛ مبالغ سامانه مودیان ریالی است"))

	company = frappe.db.get_value("Company", doc.company, ["farda_economic_code", "tax_id"], as_dict=True) or {}
	cust = (
		frappe.db.get_value(
			"Customer",
			doc.customer,
			["farda_person_type", "farda_national_id", "farda_legal_id", "farda_economic_code", "farda_postal_code"],
			as_dict=True,
		)
		or frappe._dict()
	)
	tob = TOB.get(cust.farda_person_type)
	buyer = {
		"tob": tob,
		"tinb": _digits(cust.farda_economic_code),
		"bid": _digits(cust.farda_legal_id if tob in (2, 3) else cust.farda_national_id),
		"bpc": _digits(cust.farda_postal_code),
	}

	from erpnext.farda_iran.tax.service import _get_exempt_flags, get_applicable_vat_rate

	rate = get_applicable_vat_rate(doc) if doc.get("farda_apply_vat") else 0.0
	items = doc.get("items") or []
	exempt = _get_exempt_flags(items)
	codes = sorted({r.item_code for r in items if r.item_code})
	item_meta = {
		d.name: d
		for d in frappe.get_all("Item", filters={"name": ["in", codes]}, fields=["name", "farda_sstid", "farda_moadian_unit"])
	} if codes else {}
	default_mu = (_settings().get("default_unit_code") or "").strip()
	lines = []
	for row, is_exempt in zip(items, exempt):
		meta = item_meta.get(row.item_code) or frappe._dict()
		qty = flt(row.qty)
		rate_rial = flt(row.base_rate)
		list_rial = flt(row.base_price_list_rate)
		fee = list_rial if list_rial > rate_rial else rate_rial
		prdis = minv.trunc(minv._d(qty) * minv._d(fee))
		net = minv.trunc(flt(row.base_net_amount))
		lines.append(
			{
				"sstid": meta.farda_sstid,
				"sstt": row.item_name or row.item_code,
				"am": qty,
				"mu": meta.farda_moadian_unit or default_mu or None,
				"fee": fee,
				"dis": max(prdis - net, 0),
				"vra": 0 if is_exempt else rate,
			}
		)

	grand = flt(doc.rounded_total or doc.grand_total)
	outstanding = flt(doc.outstanding_amount)
	if outstanding <= 0.5:
		setm, paid = 1, None
	elif abs(outstanding - grand) <= 0.5:
		setm, paid = 2, None
	else:
		setm, paid = 3, (grand - outstanding) * flt(doc.conversion_rate or 1)
	return {
		"memory_id": memory_id,
		"serial": serial,
		"indatim": indatim,
		"seller_tin": company.get("farda_economic_code") or company.get("tax_id"),
		"inty": inty,
		"ins": 1,
		"buyer": buyer,
		"setm": setm,
		"paid_amount": paid,
		"lines": lines,
	}


# ---------------------------------------------------------------- API
@frappe.whitelist()
def get_status(sales_invoice: str | None = None) -> dict:
	cfg = mconfig.load()
	out = {"config": cfg.public_view(), "enabled": cint(_settings().get("enabled", 1))}
	if sales_invoice:
		frappe.has_permission("Sales Invoice", "read", doc=sales_invoice, throw=True)
		out["logs"] = frappe.get_all(
			LOG,
			filters={"sales_invoice": sales_invoice},
			fields=["name", "subject", "status", "taxid", "uid", "reference_number", "target_label", "creation", "messages"],
			order_by="creation desc",
			limit=10,
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


def _active_log(sales_invoice: str, subject: str):
	rows = frappe.get_all(
		LOG,
		filters={"sales_invoice": sales_invoice, "subject": subject, "status": ["in", (READY, SENT, PROCESSING, OK, ERROR)]},
		fields=["name", "status"],
		order_by="creation desc",
		limit=1,
	)
	return frappe.get_doc(LOG, rows[0].name) if rows else None


def _preview(log, cfg, validation=None) -> dict:
	inv = json.loads(log.invoice_json)
	if validation is None:
		validation = minv.validate(inv, now_ms=_now_ms())
	summary = minv.summary(inv)
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
def prepare(sales_invoice: str, subject: str = "original", invoice_type=None) -> dict:
	"""Step 1 (offline): build + validate, reserve the taxid, return what will be sent."""
	doc = frappe.get_doc("Sales Invoice", sales_invoice)
	_check_access(doc)
	cfg = mconfig.load()
	s = _settings()
	if not cint(s.get("enabled", 1)):
		frappe.throw(_("ارسال به سامانه مودیان در «تنظیمات سامانه مودیان» غیرفعال است"))
	if not cfg.memory_id:
		frappe.throw(_("شناسه یکتای حافظه مالیاتی تنظیم نشده است (FARDA_MOADIAN_MEMORY_ID در فایل .env)"))

	is_cancel = subject in ("cancel", CANCELLATION)
	subj = CANCELLATION if is_cancel else ORIGINAL
	existing = _active_log(sales_invoice, subj)
	if existing and existing.status != READY:
		frappe.throw(
			_("این فاکتور قبلاً با وضعیت «{0}» ارسال شده است. برای پیگیری از «استعلام وضعیت» استفاده کنید.").format(existing.status)
		)

	indatim = _now_ms() if is_cancel else _indatim_ms(doc)
	day = indatim // minv.taxid_mod.DAY_MS
	if existing and cint(existing.indatim or 0) // minv.taxid_mod.DAY_MS == day:
		serial = cint(existing.serial)  # same draft, same day -> keep the reserved taxid
		log = existing
	else:
		serial = _next_serial()
		log = existing or frappe.new_doc(LOG)

	if is_cancel:
		original = frappe.get_all(
			LOG, filters={"sales_invoice": sales_invoice, "subject": ORIGINAL, "status": OK}, fields=["taxid"], limit=1
		)
		if not original:
			frappe.throw(_("صورتحساب اصلی این فاکتور در سامانه «ثبت شد» نیست؛ ابطال لازم نیست"))
		company = frappe.db.get_value("Company", doc.company, ["farda_economic_code", "tax_id"], as_dict=True)
		spec = {
			"memory_id": cfg.memory_id,
			"serial": serial,
			"indatim": indatim,
			"seller_tin": company.farda_economic_code or company.tax_id,
			"ins": 3,
			"irtaxid": original[0].taxid,
		}
	else:
		spec = build_spec(doc, serial, cfg.memory_id, _invoice_type(s, invoice_type), indatim)

	inv = minv.build(spec)
	payload = _canonical(inv)
	h = inv["header"]
	log.update(
		{
			"sales_invoice": sales_invoice,
			"subject": subj,
			"status": READY,
			"company": doc.company,
			"customer": doc.customer,
			"taxid": h["taxid"],
			"serial": serial,
			"indatim": str(h["indatim"]),
			"reference_taxid": h.get("irtaxid"),
			"tbill": h.get("tbill") or 0,
			"tvam": h.get("tvam") or 0,
			"target_label": cfg.target_label,
			"invoice_json": payload,
			"confirm_code": _confirm_code(cfg, payload),
			"messages": "",
		}
	)
	log.flags.ignore_permissions = True
	log.save() if not log.is_new() else log.insert()
	return _preview(log, cfg)


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
	inv = json.loads(entry.invoice_json)
	check = minv.validate(inv, now_ms=_now_ms())
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
			f"{exc}\nممکن است صورتحساب به سامانه رسیده باشد؛ پیش از ارسال دوباره، در کارپوشه بررسی کنید."
			" این شماره مالیاتی دوباره ارسال نمی‌شود."
		)
	entry.flags.ignore_permissions = True
	entry.save()
	_set_invoice_fields(entry.sales_invoice, entry)
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
		msgs = ("صورتحساب در سامانه مودیان ثبت شد.\n\n" + msgs).strip()
	elif entry.status == FAILED and not msgs:
		msgs = "سامانه صورتحساب را نپذیرفت. پس از اصلاح، دوباره ارسال کنید (با شماره مالیاتی جدید)."
	entry.messages = msgs
	entry.response_json = json.dumps(item, ensure_ascii=False, indent=1)[:60000]


@frappe.whitelist(methods=["POST"])
def inquire(log: str) -> dict:
	entry = frappe.get_doc(LOG, log)
	frappe.has_permission("Sales Invoice", "read", doc=entry.sales_invoice, throw=True)
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
	_set_invoice_fields(entry.sales_invoice, entry)
	return {"status": entry.status, "messages": entry.messages, "log": entry.name}


def poll_pending() -> None:
	"""Scheduler (every 10 min): ask the system about invoices still in progress."""
	if not frappe.db.exists("DocType", LOG) or not cint(_settings().get("auto_inquiry", 1)):
		return
	cfg = mconfig.load()
	if cfg.problems():
		return
	rows = frappe.get_all(
		LOG, filters={"status": ["in", (SENT, PROCESSING)], "uid": ["is", "set"]}, fields=["name", "uid"], limit=100
	)
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
		_set_invoice_fields(entry.sales_invoice, entry)
	frappe.db.commit()


def on_sales_invoice_cancel(doc, method=None) -> None:
	"""Cancelling in ERPNext does not cancel in the tax system — say so plainly."""
	if not frappe.db.exists("DocType", LOG):
		return
	registered = frappe.db.exists(LOG, {"sales_invoice": doc.name, "subject": ORIGINAL, "status": OK})
	cancelled = frappe.db.exists(LOG, {"sales_invoice": doc.name, "subject": CANCELLATION, "status": OK})
	if registered and not cancelled:
		frappe.msgprint(
			_(
				"این فاکتور در سامانه مودیان ثبت شده است. لغو آن در فردا، صورتحساب را در سامانه باطل نمی‌کند؛"
				" قبل از لغو از دکمه «سامانه مودیان ← ابطال در سامانه» استفاده کنید یا در کارپوشه ابطال کنید."
			),
			title=_("سامانه مودیان"),
			indicator="orange",
		)
