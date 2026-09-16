# Copyright (c) 2026, FardaERP and contributors
"""§10 fold-at-rest for Item titles: canonical Persian letters + folded search key."""

from __future__ import annotations


def validate(doc, method: str | None = None) -> None:
	from .utilities.normalization import fold_for_search, normalize

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
