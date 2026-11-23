"""Seasonal transactions list (فهرست معاملات فصلی — ماده ۱۶۹) — pure logic.

Since the Store Terminals & Taxpayers System Act, an e-invoice registered in
سامانهٔ مودیان counts as filed under Art. 169, so the list today is mainly for
purchases, and for small deals whose counterparty identity is missing, which may
be reported in aggregate (تجمیعی) up to 5% of the small-transaction threshold
(1405: 4,230,000,000 rial → 211,500,000 rial). The threshold is a parameter
because it changes every year. This module only groups and checks data; it
gives no tax advice.
"""

from __future__ import annotations

try:
	from ..utilities.validators import (
		is_valid_economic_code,
		is_valid_legal_national_id,
		is_valid_national_id,
		is_valid_postal_code,
		normalize_national_id,
	)
except ImportError:  # pragma: no cover
	from farda_iran.utilities.validators import (
		is_valid_economic_code,
		is_valid_legal_national_id,
		is_valid_national_id,
		is_valid_postal_code,
		normalize_national_id,
	)

DEFAULT_AGGREGATE_LIMIT_RIAL = 211_500_000  # 5% × 4,230,000,000 (حد نصاب معاملات کوچک ۱۴۰۵)

SEASONS = {1: "بهار", 2: "تابستان", 3: "پاییز", 4: "زمستان"}

STATUS_OK = "کامل"
STATUS_INCOMPLETE = "اطلاعات هویتی ناقص"
STATUS_AGGREGATE = "تجمیعی"


def season_months(season: int) -> tuple[int, int]:
	if season not in SEASONS:
		raise ValueError("season must be 1..4")
	return 3 * season - 2, 3 * season


def identity_problems(party: dict) -> list[str]:
	"""Missing/invalid identity items for one counterparty (Persian messages)."""
	ptype = (party.get("person_type") or "").strip()
	nid = normalize_national_id(party.get("national_id") or "")
	lid = normalize_national_id(party.get("legal_id") or "")
	problems = []
	if not ptype:
		problems.append("نوع شخصیت")
	if ptype == "حقیقی" and not is_valid_national_id(nid):
		problems.append("کد ملی")
	elif ptype in ("حقوقی", "مشارکت مدنی") and not is_valid_legal_national_id(lid):
		problems.append("شناسه ملی")
	elif ptype == "اتباع غیرایرانی" and not nid:
		problems.append("کد فراگیر")
	eco = party.get("economic_code")
	if ptype in ("حقوقی", "مشارکت مدنی") and eco and not is_valid_economic_code(eco):
		problems.append("کد اقتصادی")
	postal = party.get("postal_code")
	if postal and not is_valid_postal_code(postal):
		problems.append("کد پستی")
	return problems


def build_rows(invoices: list[dict], parties: dict[str, dict], aggregate_limit: int = DEFAULT_AGGREGATE_LIMIT_RIAL) -> list[dict]:
	"""Group invoices per counterparty.

	invoices: {party, net, discount, tax, total} in rial (returns negative).
	parties:  party name → {name, person_type, national_id, legal_id,
	          economic_code, postal_code, city, phone}
	Invoices of parties with incomplete identity whose own total is within
	aggregate_limit go into one aggregate row; the rest stay per party and are
	flagged so the user can complete the data.
	"""
	per_party: dict[str, dict] = {}
	agg = {"count": 0, "net": 0, "discount": 0, "tax": 0, "total": 0}
	for inv in invoices:
		p = parties.get(inv["party"], {"name": inv["party"]})
		problems = identity_problems(p)
		if problems and abs(inv.get("total") or 0) <= aggregate_limit:
			for k in ("net", "discount", "tax", "total"):
				agg[k] += int(round(inv.get(k) or 0))
			agg["count"] += 1
			continue
		row = per_party.get(inv["party"])
		if row is None:
			ptype = p.get("person_type") or ""
			ident = p.get("legal_id") if ptype in ("حقوقی", "مشارکت مدنی") else p.get("national_id")
			row = per_party[inv["party"]] = {
				"party": inv["party"],
				"party_name": p.get("name") or inv["party"],
				"person_type": ptype,
				"identity": normalize_national_id(ident or ""),
				"economic_code": p.get("economic_code") or "",
				"postal_code": p.get("postal_code") or "",
				"city": p.get("city") or "",
				"phone": p.get("phone") or "",
				"count": 0, "net": 0, "discount": 0, "tax": 0, "total": 0,
				"status": STATUS_INCOMPLETE + ": " + "، ".join(problems) if problems else STATUS_OK,
			}
		for k in ("net", "discount", "tax", "total"):
			row[k] += int(round(inv.get(k) or 0))
		row["count"] += 1
	rows = sorted(per_party.values(), key=lambda r: (r["status"] != STATUS_OK, -r["total"]))
	if agg["count"]:
		rows.append({
			"party": "", "party_name": "معاملات تجمیعی (بدون مشخصات طرف معامله)", "person_type": "",
			"identity": "", "economic_code": "", "postal_code": "", "city": "", "phone": "",
			**agg, "status": STATUS_AGGREGATE,
		})
	for i, r in enumerate(rows, 1):
		r["idx"] = i
	return rows
