"""fa translation audit — counts entries/empties and lists empty msgids.

    python erpnext/farda_iran/translations/audit.py [--fill-batch]

--fill-batch applies the curated core-ERP batch (translations/batch1.py) to
erpnext/locale/fa.po (idempotent; only fills EMPTY translations).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PO = REPO / "erpnext" / "locale" / "fa.po"
ENTRY = re.compile(r'(msgid "((?:[^"\\]|\\.)*)"\nmsgstr "((?:[^"\\]|\\.)*)")')


def audit() -> dict:
	content = PO.read_text(encoding="utf-8")
	entries = ENTRY.findall(content)
	empty = [src for src, dst in [(e[1], e[2]) for e in entries] if not dst.strip()]
	return {"total": len(entries), "empty": len(empty), "empty_sources": empty}


def fill(mapping: dict[str, str]) -> int:
	"""Fill EMPTY translations only; never overwrite existing ones."""
	content = PO.read_text(encoding="utf-8")
	filled = 0

	def repl(match: re.Match) -> str:
		nonlocal filled
		block, src, dst = match.group(1), match.group(2), match.group(3)
		if dst.strip():
			return block
		target = mapping.get(src)
		if target is None:
			return block
		filled += 1
		return f'msgid "{src}"\nmsgstr "{target}"'

	new = ENTRY.sub(repl, content)
	PO.write_text(new, encoding="utf-8")
	return filled


if __name__ == "__main__":
	stats = audit()
	print(f"fa.po: {stats['total']} entries, {stats['empty']} empty")
	if "--fill-batch" in sys.argv:
		sys.path.insert(0, str(Path(__file__).parent))
		from batch1 import AUTONOMOUS_BATCH as BATCH1
		try:
			from batch2 import BATCH2
		except ImportError:
			BATCH2 = {}

		n = fill({**BATCH1, **BATCH2})
		print(f"filled {n} translations from BATCH1+BATCH2")
		stats = audit()
		print(f"after: {stats['total']} entries, {stats['empty']} empty")
