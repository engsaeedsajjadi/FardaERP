"""Unit tests: SSO insurance-list disk (DBF + Iran System), frappe-free."""

import io
import unittest
import zipfile

try:
	from farda_iran.payroll import dbf, iransystem, sso_disk
except ImportError:
	from erpnext.farda_iran.payroll import dbf, iransystem, sso_disk

ROWS = [
	dict(insurance_number="1234567890", first_name="علی", last_name="رضایی", father_name="حسن",
		id_number="123", id_place="تهران", birth_date="13700101", sex="مرد", job_title="کارگر",
		start_date="", end_date="", days=31, daily_wage=5_541_850, monthly_wage=171_797_350,
		benefits=31_000_000, insurable=202_797_350, total=202_797_350, employee_share=14_195_815,
		employer_share=40_559_470, unemployment=6_083_921, job_code="123456", national_id="0012345678"),
	dict(insurance_number="2234567890", first_name="مریم", last_name="احمدی", father_name="رضا",
		days=20, daily_wage=6_000_000, monthly_wage=120_000_000, benefits=0, insurable=120_000_000,
		total=120_000_000, employee_share=8_400_000, employer_share=24_000_000, unemployment=3_600_000,
		national_id="0023456789"),
]
WS = dict(code="1234567", name="کارگاه نمونه", employer="شرکت نمونه", address="تهران", contract_row="000")


class IranSystemTests(unittest.TestCase):
	def test_samples(self):
		self.assertEqual(iransystem.encode("علی"), bytes([0xFC, 0xF3, 0xE4]))
		self.assertEqual(iransystem.encode("سلام"), bytes([0xF4, 0xF2, 0xA8]))

	def test_ascii_kept(self):
		self.assertEqual(iransystem.encode("ABC 12"), b"ABC 12")


class DbfTests(unittest.TestCase):
	def test_round_trip(self):
		fields = [("A", "C", 5), ("B", "N", 6)]
		data = dbf.write(fields, [{"A": "xy", "B": 42}, {"A": "", "B": 0}], lambda s: s.encode("ascii"))
		self.assertEqual(data[0], 0x03)
		self.assertEqual(data[-1], 0x1A)
		_, recs = dbf.read(data)
		self.assertEqual(len(recs), 2)
		self.assertEqual(recs[0]["A"].strip(), b"xy")
		self.assertEqual(int(recs[0]["B"]), 42)

	def test_overflow(self):
		with self.assertRaises(ValueError):
			dbf.write([("B", "N", 2)], [{"B": 123}], lambda s: s.encode())


class SsoDiskTests(unittest.TestCase):
	def setUp(self):
		z = zipfile.ZipFile(io.BytesIO(sso_disk.build(WS, 1405, 7, ROWS)))
		self.names = sorted(z.namelist())
		_, self.kar = dbf.read(z.read("DSKKAR00.DBF"))
		_, self.wor = dbf.read(z.read("DSKWOR00.DBF"))

	def test_files_and_columns(self):
		self.assertEqual(self.names, ["DSKKAR00.DBF", "DSKWOR00.DBF"])
		self.assertEqual(len(sso_disk.KAR_FIELDS), 23)
		self.assertEqual(len(sso_disk.WOR_FIELDS), 27)
		self.assertEqual(len(self.kar), 1)
		self.assertEqual(len(self.wor), 2)

	def test_totals(self):
		k = self.kar[0]
		self.assertEqual(int(k["DSK_NUM"]), 2)
		self.assertEqual(int(k["DSK_TDD"]), 51)
		self.assertEqual(int(k["DSK_TMASH"]), 322_797_350)
		self.assertEqual(int(k["DSK_TBIME"]), 22_595_815)
		self.assertEqual(int(k["DSK_TKOSO"]), 64_559_470)
		self.assertEqual(int(k["DSK_BIC"]), 9_683_921)
		self.assertEqual(int(k["DSK_YY"]), 5)
		self.assertEqual(int(k["DSK_MM"]), 7)

	def test_employee_text(self):
		w = self.wor[0]
		self.assertEqual(w["DSW_FNAME"].rstrip(b" "), bytes([0xFC, 0xF3, 0xE4]))
		self.assertEqual(w["PER_NATCOD"].strip(), b"0012345678")


if __name__ == "__main__":
	unittest.main()
