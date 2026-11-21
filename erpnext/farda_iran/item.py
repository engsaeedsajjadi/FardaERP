# Copyright (c) 2026, FardaERP and contributors
"""§10 fold-at-rest for Item titles: canonical Persian letters + folded search key."""

from __future__ import annotations


def validate(doc, method: str | None = None) -> None:
	from .utilities.normalization import fold_for_search, normalize

	_validate_moadian_ids(doc)
	name = doc.get("item_name") or ""
	if not name:
		return
	try:
		doc.farda_search_key = fold_for_search(name)
	except Exception:
		pass
	canon = normalize(name)
	if canon != name:
		doc.set("item_name", canon)


def _validate_moadian_ids(doc) -> None:
	"""CORE-034: شناسه کالا/خدمت must be 13 digits; Persian digits are accepted and folded."""
	import re

	import frappe

	fold = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
	for field, pattern, msg in (
		("farda_sstid", r"\d{13}", "شناسه کالا/خدمت سامانه مودیان باید دقیقاً ۱۳ رقم باشد"),
		("farda_moadian_unit", r"\d{1,8}", "کد واحد اندازه‌گیری مودیان باید عددی باشد"),
	):
		value = doc.get(field)
		if not value:
			continue
		clean = re.sub(r"\s", "", str(value).translate(fold))
		if not re.fullmatch(pattern, clean):
			frappe.throw(msg)
		doc.set(field, clean)
