"""Legal books (دفاتر قانونی) — journal (روزنامه) and ledger (کل). Pure logic.

Statutory practice: the journal records each day's activity summarised per
general-ledger account (حساب کل) — debits first, then credits — as one daily
document with a running row number and page number; the ledger posts the same
daily totals per account with a running balance. Account level is a
parameter because charts differ (default: the level right under the roots).
"""

from __future__ import annotations

from collections import OrderedDict


def ancestor_map(accounts: list[dict], level: int) -> dict[str, str]:
	"""account → its ancestor at `level` (0 = root). Shallower accounts map to themselves.

	accounts: [{name, parent_account}] for one company.
	"""
	parent = {a["name"]: a.get("parent_account") for a in accounts}
	out = {}
	for name in parent:
		chain = [name]
		seen = {name}
		p = parent.get(name)
		while p and p not in seen:
			chain.append(p)
			seen.add(p)
			p = parent.get(p)
		chain.reverse()  # root … name
		out[name] = chain[min(level, len(chain) - 1)]
	return out


def journal(entries: list[dict], amap: dict[str, str], rows_per_page: int = 30) -> list[dict]:
	"""entries: GL rows {posting_date (ISO str/date), account, debit, credit} sorted by date.

	Returns rows: {doc_no, page, row, date, account, debit, credit, kind}
	plus a «جمع سند» row closing each day (kind == "total").
	"""
	days: "OrderedDict[str, dict]" = OrderedDict()
	for e in entries:
		day = str(e["posting_date"])
		acc = amap.get(e["account"], e["account"])
		d = days.setdefault(day, OrderedDict())
		t = d.setdefault(acc, [0, 0])
		t[0] += int(round(e.get("debit") or 0))
		t[1] += int(round(e.get("credit") or 0))
	rows, row_no, doc_no = [], 0, 0
	for day, accs in days.items():
		lines = []
		for acc, (dr, cr) in accs.items():  # gross daily turnover per side, not netted
			if dr:
				lines.append((0, acc, dr, 0))
			if cr:
				lines.append((1, acc, 0, cr))
		lines.sort(key=lambda x: (x[0], x[1]))
		if not lines:
			continue
		doc_no += 1
		tdr = tcr = 0
		for _side, acc, dr, cr in lines:
			row_no += 1
			tdr += dr
			tcr += cr
			rows.append({"doc_no": doc_no, "page": (row_no - 1) // rows_per_page + 1, "row": row_no, "date": day, "account": acc, "debit": dr, "credit": cr, "kind": "line"})
		rows.append({"doc_no": doc_no, "page": (row_no - 1) // rows_per_page + 1, "row": None, "date": day, "account": "جمع سند", "debit": tdr, "credit": tcr, "kind": "total"})
	return rows


def ledger(journal_rows: list[dict], opening: dict[str, int] | None = None) -> "OrderedDict[str, list[dict]]":
	"""Per-account postings from the journal with a running balance.

	opening: account → balance (debit positive) before the period.
	"""
	opening = opening or {}
	books: "OrderedDict[str, list[dict]]" = OrderedDict()
	for r in sorted((r for r in journal_rows if r["kind"] == "line"), key=lambda r: (r["account"], r["row"])):
		books.setdefault(r["account"], [])
	for acc in list(books) + [a for a in opening if a not in books and opening[a]]:
		books.setdefault(acc, [])
	out: "OrderedDict[str, list[dict]]" = OrderedDict()
	for acc in sorted(books):
		bal = int(opening.get(acc, 0))
		lines = [{"date": None, "doc_no": None, "page": None, "desc": "مانده از قبل", "debit": 0, "credit": 0, "balance": abs(bal), "side": _side(bal)}] if bal else []
		for r in journal_rows:
			if r["kind"] != "line" or r["account"] != acc:
				continue
			bal += r["debit"] - r["credit"]
			lines.append({"date": r["date"], "doc_no": r["doc_no"], "page": r["page"], "desc": f"طبق سند روزانهٔ شمارهٔ {r['doc_no']}", "debit": r["debit"], "credit": r["credit"], "balance": abs(bal), "side": _side(bal)})
		out[acc] = lines
	return out


def _side(balance: int) -> str:
	return "بد" if balance > 0 else ("بس" if balance < 0 else "—")
