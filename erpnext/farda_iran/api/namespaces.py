"""Farda API namespaces (§21) — one whitelisted action-dispatch per namespace.

Endpoints (authenticated; NEVER guest):
    /api/method/erpnext.farda_iran.api.namespaces.tax      action=calculate_vat
    /api/method/erpnext.farda_iran.api.namespaces.party    action=get_profile|search
    /api/method/erpnext.farda_iran.api.namespaces.bank     action=resolve
    /api/method/erpnext.farda_iran.api.namespaces.reports  action=run

Contract (registry = api/namespaces_registry.py — single source of truth):
- uniform envelope  {"ok": true, "data": ...} / {"ok": false, "error": {code, message}}
- error codes: VALIDATION · NOT_FOUND · FORBIDDEN · RATE_LIMITED · UNKNOWN
- per-namespace role gates (frozensets in the registry; Guest always rejected)
- farda.reports.run: allow-listed Farda reports only + per-user sliding-window
  rate limit (Redis limiter, REPORTS_RATE_LIMIT)
- READ-ONLY surface: no handler writes; mutations are audited at the model
  layer (audit.service doc_events). No secrets/PII beyond document names.
"""

from __future__ import annotations

import json

import frappe

from .namespaces_registry import (
	NAMESPACE_ACTIONS,
	NAMESPACE_ROLES,
	REPORT_ALLOWLIST,
	REPORT_DOC_NAMES,
	REPORTS_RATE_LIMIT,
)

_PARTY_DOCTYPES = {"Customer": "customer_name", "Supplier": "supplier_name"}
_IDENTITY_FIELDS = (
	"farda_national_id",
	"farda_legal_id",
	"farda_economic_code",
	"farda_postal_code",
	"farda_iban",
	"farda_vat_exempt",
)


def _err(code: str, message: str) -> dict:
	return {"ok": False, "error": {"code": code, "message": message}}


def _reports_rate_ok(user: str) -> bool:
	"""Indirection kept for suite injection (behavior-tested)."""
	from .limiter import is_allowed

	calls, window = REPORTS_RATE_LIMIT
	return is_allowed("farda_ns_reports", user, calls, window)


def _party_get_profile(party_type: str | None = None, name: str | None = None) -> dict:
	party_type = str(party_type or "")
	if party_type not in _PARTY_DOCTYPES:
		raise ValueError("party_type فقط Customer/Supplier است")
	name = str(name or "").strip()
	if not name:
		raise ValueError("name الزامی است")
	title_field = _PARTY_DOCTYPES[party_type]
	row = frappe.db.get_value(
		party_type,
		name,
		[title_field, "farda_search_key", *_IDENTITY_FIELDS],
		as_dict=True,
	)
	if row is None:
		raise frappe.DoesNotExistError(f"{party_type} یافت نشد: {name}")
	out = {"doctype": party_type, "name": name, "title": row.get(title_field)}
	out.update({f: row.get(f) for f in (*_IDENTITY_FIELDS, "farda_search_key")})
	return out


def _party_search(query: str | None = None, party_type: str = "Customer", limit: int = 20) -> dict:
	from .search import search_party

	data = search_party(doctype=str(party_type), query=str(query or ""), limit=int(limit or 20))
	return {"results": data.get("results", [])}


def _tax_calculate_vat(net_amount=None, rate=None) -> dict:
	from erpnext.farda_iran.tax.planner import plan_vat, to_number

	try:
		net = float(net_amount)
	except (TypeError, ValueError):
		raise ValueError("net_amount عددی معتبر نیست")
	if net < 0:
		raise ValueError("net_amount نمی‌تواند منفی باشد")
	if rate is None or str(rate).strip() == "":
		rate = frappe.db.get_single_value("Farda VAT Settings", "default_rate") or 0
	plan = plan_vat([(False, net)], float(rate))
	gross = plan.taxable_net + plan.total_tax
	return {
		"rate": float(plan.rate),
		"taxable_net": to_number(plan.taxable_net, 2),
		"total_tax": to_number(plan.total_tax, 2),
		"gross": to_number(gross, 2),
	}


def _bank_resolve(iban: str | None = None) -> dict:
	from erpnext.farda_iran.utilities.validators import is_valid_iriban

	iban = str(iban or "").strip()
	if not is_valid_iriban(iban):
		raise ValueError("شماره شبا معتبر نیست")
	from erpnext.farda_iran.banking.service import iban_bank_info

	info = iban_bank_info(iban)
	accounts = frappe.get_all(
		"Bank Account",
		filters={"iban": iban},
		fields=["name", "account_name", "bank", "company"],
		limit=10,
	)
	return {**info, "linked_accounts": accounts}


def _reports_run(report: str | None = None, filters=None) -> dict:
	report = str(report or "").strip()
	if report not in REPORT_ALLOWLIST:
		raise ValueError(f"گزارش در فهرست مجاز نیست: {report}")
	if isinstance(filters, str):
		try:
			filters = json.loads(filters or "{}")
		except json.JSONDecodeError:
			raise ValueError("filters JSON معتبر نیست")
	from frappe.desk.query_report import run

	result = run(REPORT_DOC_NAMES[report], filters or {})
	# JSON-safe round-trip (dates/Decimals) without leaking non-serializable internals
	return json.loads(frappe.as_json(result or {}))


_HANDLERS = {
	("tax", "calculate_vat"): _tax_calculate_vat,
	("party", "get_profile"): _party_get_profile,
	("party", "search"): _party_search,
	("bank", "resolve"): _bank_resolve,
	("reports", "run"): _reports_run,
}


def _dispatch(namespace: str, action: str | None = None, **kwargs) -> dict:
	try:
		if not frappe.session.user or frappe.session.user == "Guest":
			return _err("FORBIDDEN", "دسترسی مهمان مجاز نیست")
		if not set(frappe.get_roles()) & NAMESPACE_ROLES[namespace]:
			return _err("FORBIDDEN", "نقش شما مجاز به این ناحیه نیست")
		actions = NAMESPACE_ACTIONS[namespace]
		action = str(action or "")
		if action not in actions:
			raise ValueError(f"action ناشناخته است؛ مجاز: {', '.join(actions)}")
		if namespace == "reports" and not _reports_rate_ok(frappe.session.user):
			return _err("RATE_LIMITED", "تعداد درخواست‌ها بیش از حد مجاز است")
		data = _HANDLERS[(namespace, action)](**kwargs)
		return {"ok": True, "data": data}
	except frappe.RateLimitExceededError:
		return _err("RATE_LIMITED", "تعداد درخواست‌ها بیش از حد مجاز است")
	except frappe.PermissionError:
		return _err("FORBIDDEN", "دسترسی رد شد")
	except frappe.DoesNotExistError:
		return _err("NOT_FOUND", "موجودیت یافت نشد")
	except (frappe.ValidationError, frappe.MandatoryError, ValueError, TypeError) as exc:
		return _err("VALIDATION", str(exc))
	except Exception:
		frappe.log_error(title=f"Farda API {namespace}", message=frappe.get_traceback())
		return _err("UNKNOWN", "خطای غیرمنتظره در سرور")


@frappe.whitelist(methods=["GET", "POST"])
def tax(action: str | None = None, **kwargs) -> dict:
	return _dispatch("tax", action, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def party(action: str | None = None, **kwargs) -> dict:
	return _dispatch("party", action, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def bank(action: str | None = None, **kwargs) -> dict:
	return _dispatch("bank", action, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def reports(action: str | None = None, **kwargs) -> dict:
	return _dispatch("reports", action, **kwargs)
