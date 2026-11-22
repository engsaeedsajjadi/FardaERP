"""دیسکت لیست بیمه تأمین اجتماعی: DSKKAR00.DBF + DSKWOR00.DBF (CORE-038).

Layout = «مشخصات جداول» of the SSO «سیستم وصول حق بیمه» document (23 workshop
and 27 employee columns). Persian text in Iran System (visual order) by
default, Windows-1256 as an option; dates as Jalali YYYYMMDD; year as two
digits. Not yet checked against a file from the current SSO list program —
the download dialog says so.
"""

from __future__ import annotations

import io
import zipfile

from . import dbf, iransystem

KAR_FIELDS = [
	("DSK_ID", "C", 10), ("DSK_NAME", "C", 30), ("DSK_FARM", "C", 30), ("DSK_ADRS", "C", 40),
	("DSK_KIND", "N", 1), ("DSK_YY", "N", 2), ("DSK_MM", "N", 2), ("DSK_LISTNO", "C", 12),
	("DSK_DISC", "C", 30), ("DSK_NUM", "N", 5), ("DSK_TDD", "N", 6), ("DSK_TROOZ", "N", 12),
	("DSK_TMAH", "N", 12), ("DSK_TMAZ", "N", 12), ("DSK_TMASH", "N", 12), ("DSK_TTOTL", "N", 12),
	("DSK_TBIME", "N", 12), ("DSK_TKOSO", "N", 12), ("DSK_BIC", "N", 12), ("DSK_RATE", "N", 5),
	("DSK_PRATE", "N", 2), ("DSK_BIMH", "N", 12), ("MON_PYM", "C", 3),
]
WOR_FIELDS = [
	("DSW_ID", "C", 10), ("DSW_YY", "N", 2), ("DSW_MM", "N", 2), ("DSW_LISTNO", "C", 12),
	("DSW_ID1", "C", 10), ("DSW_FNAME", "C", 50), ("DSW_LNAME", "C", 50), ("DSW_DNAME", "C", 50),
	("DSW_IDNO", "C", 15), ("DSW_IDPLC", "C", 30), ("DSW_IDATE", "C", 8), ("DSW_BDATE", "C", 8),
	("DSW_SEX", "C", 3), ("DSW_NAT", "C", 10), ("DSW_OCP", "C", 50), ("DSW_SDATE", "C", 8),
	("DSW_EDATE", "C", 8), ("DSW_DD", "N", 2), ("DSW_ROOZ", "N", 12), ("DSW_MAH", "N", 12),
	("DSW_MAZ", "N", 12), ("DSW_MASH", "N", 12), ("DSW_TOTL", "N", 12), ("DSW_BIME", "N", 12),
	("DSW_PRATE", "N", 2), ("DSW_JOB", "C", 6), ("PER_NATCOD", "C", 10),
]


def encoder(name: str):
	if (name or "").lower().startswith("windows") or name == "cp1256":
		return lambda s: s.encode("cp1256", "replace")
	return iransystem.encode


def build(workshop: dict, year: int, month: int, rows: list[dict], encoding: str = "Iran System", list_no: str = "01") -> bytes:
	"""workshop: code, name, employer, address, contract_row, employer_rate.
	rows: one dict per employee with the DSW_* business values (see payroll.reports)."""
	yy, enc = int(year) % 100, encoder(encoding)
	wor = []
	for r in rows:
		wor.append(
			{
				"DSW_ID": workshop["code"], "DSW_YY": yy, "DSW_MM": month, "DSW_LISTNO": list_no,
				"DSW_ID1": r.get("insurance_number") or "", "DSW_FNAME": r.get("first_name") or "",
				"DSW_LNAME": r.get("last_name") or "", "DSW_DNAME": r.get("father_name") or "",
				"DSW_IDNO": r.get("id_number") or "", "DSW_IDPLC": r.get("id_place") or "",
				"DSW_IDATE": "", "DSW_BDATE": r.get("birth_date") or "", "DSW_SEX": r.get("sex") or "",
				"DSW_NAT": r.get("nationality") or "ایرانی", "DSW_OCP": r.get("job_title") or "",
				"DSW_SDATE": r.get("start_date") or "", "DSW_EDATE": r.get("end_date") or "",
				"DSW_DD": r["days"], "DSW_ROOZ": r["daily_wage"], "DSW_MAH": r["monthly_wage"],
				"DSW_MAZ": r["benefits"], "DSW_MASH": r["insurable"], "DSW_TOTL": r["total"],
				"DSW_BIME": r["employee_share"], "DSW_PRATE": 0, "DSW_JOB": r.get("job_code") or "",
				"PER_NATCOD": r.get("national_id") or "",
			}
		)
	tot = lambda k: sum(int(w[k] or 0) for w in wor)  # noqa: E731
	kar = {
		"DSK_ID": workshop["code"], "DSK_NAME": workshop.get("name") or "", "DSK_FARM": workshop.get("employer") or "",
		"DSK_ADRS": workshop.get("address") or "", "DSK_KIND": 0, "DSK_YY": yy, "DSK_MM": month,
		"DSK_LISTNO": list_no, "DSK_DISC": workshop.get("description") or "", "DSK_NUM": len(wor),
		"DSK_TDD": tot("DSW_DD"), "DSK_TROOZ": tot("DSW_ROOZ"), "DSK_TMAH": tot("DSW_MAH"),
		"DSK_TMAZ": tot("DSW_MAZ"), "DSK_TMASH": tot("DSW_MASH"), "DSK_TTOTL": tot("DSW_TOTL"),
		"DSK_TBIME": tot("DSW_BIME"), "DSK_TKOSO": sum(int(r.get("employer_share") or 0) for r in rows),
		"DSK_BIC": sum(int(r.get("unemployment") or 0) for r in rows), "DSK_RATE": workshop.get("rate", 23),
		"DSK_PRATE": 0, "DSK_BIMH": 0, "MON_PYM": (workshop.get("contract_row") or "000")[:3],
	}
	buf = io.BytesIO()
	with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
		z.writestr("DSKKAR00.DBF", dbf.write(KAR_FIELDS, [kar], enc))
		z.writestr("DSKWOR00.DBF", dbf.write(WOR_FIELDS, wor, enc))
	return buf.getvalue()
