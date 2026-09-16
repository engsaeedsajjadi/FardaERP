# FardaERP — §24 audit trail service.
#
# Append-only, fail-open audit log for the Farda surfaces:
#   payment (Payment Entry submit/cancel) · cheque status transitions ·
#   VAT settings changes · identity-data changes (farda_* / iban fields).
# Rows carry: subject, action, old/new values (SANITIZED), user (owner),
# timestamp (creation), IP. Secrets are never stored; identity numbers are
# masked to their last 4 digits (PII minimization) while still proving change.

import json
import re

import frappe

SECRET_KEY_RE = re.compile(
	r"pass|secret|token|key|otp|auth|merchant|pin|credential|signature|hash", re.I
)
IDENTITY_KEY_RE = re.compile(
	r"national|legal|economic|postal|iban|card|ssn|mobile|phone|email|national_id", re.I
)

# exact tracked fields per doctype (besides the farda_*/iban prefix rule)
TRACKED_EXACT = {
	"Cheque": {"status"},
	"Farda VAT Settings": {"enabled", "default_rate", "effective_from", "vat_account"},
}
PREFIXES = ("farda_", "iban")


def redact_value(key: str, value) -> str:
	"""Mask a single field value according to its fieldname."""
	if value is None:
		return None
	s = str(value)
	if SECRET_KEY_RE.search(key or ""):
		return "***"
	if IDENTITY_KEY_RE.search(key or ""):
		return ("…" + s[-4:]) if len(s) > 4 else "***"
	return s


def redact_json(mapping: dict) -> str:
	"""Sanitize {field: value-or-(old,new)} into a masked JSON document."""
	out = {}
	for k, v in (mapping or {}).items():
		if isinstance(v, (tuple, list)) and len(v) == 2:
			out[k] = [redact_value(k, v[0]), redact_value(k, v[1])]
		else:
			out[k] = redact_value(k, v)
	return json.dumps(out, ensure_ascii=False, sort_keys=True, default=str)


def record(
	subject_doctype: str,
	subject_name: str,
	action: str,
	changed: dict | None = None,
	details: str | None = None,
) -> None:
	"""Append one audit row. Fail-open: business operations must never break
	because auditing failed — failures land in the error log instead."""
	if subject_doctype == "Farda Audit Log":  # never audit the audit
		return
	try:
		old_map, new_map = {}, {}
		for k, pair in (changed or {}).items():
			o, n = (pair if isinstance(pair, (tuple, list)) else (None, pair))
			old_map[k], new_map[k] = o, n
		doc = frappe.get_doc(
			{
				"doctype": "Farda Audit Log",
				"subject_doctype": subject_doctype,
				"subject_name": subject_name,
				"action": action,
				"old_value": redact_json(old_map) if old_map else None,
				"new_value": redact_json(new_map) if new_map else None,
				"details": details,
				"ip_address": getattr(frappe.local, "request_ip", None),
			}
		)
		doc.flags.farda_audit_internal = True
		doc.insert(ignore_permissions=True, ignore_links=True)
	except Exception:
		frappe.log_error(title="Farda audit record failed", message=frappe.get_traceback())


def _tracked_fields(doc) -> set:
	exact = TRACKED_EXACT.get(doc.doctype)
	if exact:
		return exact
	try:
		return {
			f.fieldname
			for f in doc.meta.get("fields", [])
			if f.fieldname.startswith(PREFIXES)
		}
	except Exception:
		return set()


def on_doc_update(doc, method=None):
	"""doc_events handler bound to after_insert + on_update."""
	tracked = _tracked_fields(doc)
	if not tracked:
		return
	before = doc.get_doc_before_save()
	if before is None:  # insert
		changed = {f: (None, doc.get(f)) for f in tracked if doc.get(f) not in (None, "")}
		if changed:
			record(doc.doctype, doc.name, "Create", changed)
		return
	changed = {}
	for f in tracked:
		old, new = before.get(f), doc.get(f)
		if old != new:
			changed[f] = (old, new)
	if not changed:
		return
	if doc.doctype == "Cheque" and set(changed) == {"status"}:
		action = "StatusChange"
	elif doc.doctype == "Farda VAT Settings":
		action = "SettingsChange"
	else:
		action = "IdentityChange"
	record(doc.doctype, doc.name, action, changed)


def on_payment_entry(doc, method=None):
	"""doc_events handler for Payment Entry on_submit / on_cancel."""
	action = "Submit" if method == "on_submit" else "Cancel"
	record(
		"Payment Entry",
		doc.name,
		action,
		details=f"payment_type={doc.payment_type} party={doc.party} amount_irr={doc.paid_amount}",
	)
