"""Persian-normalized search endpoints (§10 — real search integration).

Both folds happen over the SAME key: rows are stored with `farda_search_key`
(fold_for_search of the title, set on save + backfilled by farda setup), and the
query is folded the same way at request time. A raw-LIKE fallback also matches
legacy rows that were stored before the key existed.

Permissions: standard login + frappe.get_list (per-doctype read permissions).
No PII beyond the title/docname is returned (no national IDs).
"""

from __future__ import annotations

import frappe
from frappe import _

from erpnext.farda_iran.api.limiter import is_allowed
from erpnext.farda_iran.utilities.normalization import fold_for_search

RATE_LIMIT = 120
RATE_WINDOW = 60

_PARTY_DOCTYPES = {"Customer": "customer_name", "Supplier": "supplier_name"}


def _throttle(bucket: str) -> None:
	if not is_allowed(bucket, frappe.session.user, RATE_LIMIT, RATE_WINDOW):
		frappe.throw(
			frappe._("تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید."),
			frappe.RateLimitExceededError,
		)


def _search(doctype: str, name_field: str, query: str, limit: int) -> list[dict]:
	folded = fold_for_search(query)
	or_filters = [
		{"farda_search_key": ["like", f"%{folded}%"]},
		{name_field: ["like", f"%{query}%"]},
	]
	rows = frappe.get_list(
		doctype,
		filters={"disabled": 0} if frappe.get_meta(doctype).has_field("disabled") else [],
		or_filters=or_filters,
		fields=[f"`{name_field}` as title"],
		limit_page_length=max(1, min(int(limit), 50)),
		order_by=f"`tab{doctype}`.{name_field} asc",
		ignore_permissions=False,
	)
	for r in rows:
		r["doctype"] = doctype
	return rows


@frappe.whitelist(methods=["GET", "POST"])
def search_party(doctype: str, query: str, limit: int = 20) -> dict:
	"""Search Customer/Supplier with Persian normalization (ي/ی، ك/ک، digits، ZWNJ)."""
	_throttle("search")
	doctype = str(doctype)
	if doctype not in _PARTY_DOCTYPES:
		frappe.throw(_("جستجو فقط برای مشتری/تأمین‌کننده است"), frappe.ValidationError)
	query = str(query or "").strip()
	if not query:
		return {"results": []}
	rows = _search(doctype, _PARTY_DOCTYPES[doctype], query, limit)
	return {"results": [{"name": r.get("name"), "title": r.get("title"), "doctype": r["doctype"]} for r in rows]}


@frappe.whitelist(methods=["GET", "POST"])
def search_item(query: str, limit: int = 20) -> dict:
	"""Search Item with Persian normalization."""
	_throttle("search")
	query = str(query or "").strip()
	if not query:
		return {"results": []}
	rows = _search("Item", "item_name", query, limit)
	return {"results": [{"name": r.get("name"), "title": r.get("title"), "doctype": "Item"} for r in rows]}
