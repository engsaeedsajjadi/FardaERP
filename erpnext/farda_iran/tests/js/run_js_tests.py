"""Real-JS parity tests for farda_iran/public/js/farda_ui.js.

Generates ~3 years of Gregorian->Jalali vectors from the PYTHON service, then
executes the actual JS with node and asserts parity + currency formatting.

    python erpnext/farda_iran/tests/js/run_js_tests.py     (needs node on PATH)
"""
from __future__ import annotations

import datetime
import json
import os
import shutil
import subprocess
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
if _ROOT not in sys.path:
	sys.path.insert(0, _ROOT)

from farda_iran import jalali  # top-level import (path bootstrap)

if _ROOT in sys.path:
	sys.path.remove(_ROOT)

VECTORS = os.path.join(_HERE, "jalali_vectors.json")


def _generate_vectors() -> dict:
	dates = []
	d = datetime.date(2025, 1, 1)
	end = datetime.date(2028, 12, 31)
	# every day for 2025..2028 minus stride-7 to keep the file lean but dense
	while d <= end:
		jy, jm, jd = jalali.date_to_jalali(d)
		dates.append([f"{d.year:04d}-{d.month:02d}-{d.day:02d}", f"{jy:04d}-{jm:02d}-{jd:02d}"])
		d += datetime.timedelta(days=7)
	return {"count": len(dates), "dates": dates}


def run() -> str:
	if shutil.which("node") is None:
		raise unittest.SkipTest("node not available")
	with open(VECTORS, "w", encoding="utf-8") as f:
		json.dump(_generate_vectors(), f)
	result = subprocess.run(
		["node", os.path.join(_HERE, "parity_test.js")],
		capture_output=True,
		text=True,
		timeout=120,
	)
	output = (result.stdout + result.stderr).strip()
	print(output)
	if result.returncode != 0:
		raise AssertionError(f"JS parity tests failed:\n{output}")
	return "JS parity tests: ALL PASS"


if __name__ == "__main__":
	run()
