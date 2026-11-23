"""Pure tests: seasonal transactions, legal books, bank group-payment files, workflows."""

import unittest

try:
	from farda_iran.banking import batch_formats as B
	from farda_iran.compliance import legal_books as L
	from farda_iran.compliance import seasonal as S
	from farda_iran.setup import workflows as W
except ImportError:
	from erpnext.farda_iran.banking import batch_formats as B
	from erpnext.farda_iran.compliance import legal_books as L
	from erpnext.farda_iran.compliance import seasonal as S
	from erpnext.farda_iran.setup import workflows as W

GOOD_NID = "0499370899"  # valid check digit
GOOD_IBAN = "IR820540102680020817909002"


class TestSeasonal(unittest.TestCase):
	def test_season_months(self):
		self.assertEqual(S.season_months(1), (1, 3))
		self.assertEqual(S.season_months(4), (10, 12))
		with self.assertRaises(ValueError):
			S.season_months(5)

	def test_identity(self):
		self.assertEqual(S.identity_problems({"person_type": "حقیقی", "national_id": GOOD_NID}), [])
		self.assertIn("کد ملی", S.identity_problems({"person_type": "حقیقی", "national_id": "123"}))
		self.assertIn("نوع شخصیت", S.identity_problems({}))
		self.assertIn("شناسه ملی", S.identity_problems({"person_type": "حقوقی", "legal_id": "1"}))

	def test_grouping_and_aggregate(self):
		parties = {"A": {"name": "علی", "person_type": "حقیقی", "national_id": GOOD_NID}, "B": {"name": "ناشناس"}}
		inv = [
			{"party": "A", "net": 100, "discount": 0, "tax": 10, "total": 110},
			{"party": "A", "net": 50, "discount": 5, "tax": 5, "total": 50},
			{"party": "B", "net": 1000, "discount": 0, "tax": 100, "total": 1100},  # small → aggregate
			{"party": "B", "net": 10**9, "discount": 0, "tax": 10**8, "total": 11 * 10**8},  # big → flagged
		]
		rows = S.build_rows(inv, parties, aggregate_limit=211_500_000)
		a = next(r for r in rows if r["party"] == "A")
		self.assertEqual((a["count"], a["total"], a["status"]), (2, 160, S.STATUS_OK))
		b = next(r for r in rows if r["party"] == "B")
		self.assertTrue(b["status"].startswith(S.STATUS_INCOMPLETE))
		agg = rows[-1]
		self.assertEqual((agg["status"], agg["total"], agg["count"]), (S.STATUS_AGGREGATE, 1100, 1))
		self.assertEqual([r["idx"] for r in rows], list(range(1, len(rows) + 1)))
		self.assertEqual(rows[0]["party"], "A")  # complete rows first


class TestLegalBooks(unittest.TestCase):
	ACC = [
		{"name": "Assets", "parent_account": None}, {"name": "Current", "parent_account": "Assets"},
		{"name": "Cash", "parent_account": "Current"}, {"name": "Bank", "parent_account": "Current"},
		{"name": "Income", "parent_account": None}, {"name": "Sales", "parent_account": "Income"},
	]
	GL = [
		{"posting_date": "2026-11-01", "account": "Cash", "debit": 100, "credit": 0},
		{"posting_date": "2026-11-01", "account": "Sales", "debit": 0, "credit": 100},
		{"posting_date": "2026-11-02", "account": "Bank", "debit": 50, "credit": 0},
		{"posting_date": "2026-11-02", "account": "Cash", "debit": 0, "credit": 50},
		{"posting_date": "2026-11-03", "account": "Cash", "debit": 30, "credit": 0},
		{"posting_date": "2026-11-03", "account": "Sales", "debit": 0, "credit": 30},
	]

	def test_ancestor_map(self):
		m = L.ancestor_map(self.ACC, 1)
		self.assertEqual(m["Cash"], "Current")
		self.assertEqual(m["Assets"], "Assets")
		self.assertEqual(L.ancestor_map(self.ACC, 0)["Cash"], "Assets")

	def test_journal_balanced_and_numbered(self):
		j = L.journal(self.GL, L.ancestor_map(self.ACC, 1), rows_per_page=3)
		totals = [r for r in j if r["kind"] == "total"]
		self.assertEqual(len(totals), 3)
		for t in totals:
			self.assertEqual(t["debit"], t["credit"])
		lines = [r for r in j if r["kind"] == "line"]
		self.assertEqual([r["row"] for r in lines], list(range(1, len(lines) + 1)))
		self.assertEqual([t["doc_no"] for t in totals], [1, 2, 3])
		self.assertEqual(lines[-1]["page"], 2)  # 6 lines, 3 per page
		day1 = [r for r in lines if r["doc_no"] == 1]
		self.assertGreater(day1[0]["debit"], 0)  # debits listed first

	def test_ledger_running_balance(self):
		j = L.journal(self.GL, L.ancestor_map(self.ACC, 1))
		books = L.ledger(j, {"Current": 10})
		cur = books["Current"]
		self.assertEqual(cur[0]["desc"], "مانده از قبل")
		self.assertEqual((cur[-1]["balance"], cur[-1]["side"]), (140, "بد"))  # 10+100+50-50+30
		self.assertEqual((books["Sales"][-1]["balance"], books["Sales"][-1]["side"]), (130, "بس"))


class TestBankFiles(unittest.TestCase):
	ROWS = [{"payee_name": "رضا", "iban": "ir82 0540 1026 8002 0817 9090 02", "account_no": "123456", "amount": 1500000, "description": "حقوق", "payment_id": "77"}]

	def test_clean_iban(self):
		self.assertEqual(B.clean_iban("ir82 0540 1026 8002 0817 9090 02"), GOOD_IBAN)
		self.assertEqual(B.clean_iban("۸۲۰۵۴۰۱۰۲۶۸۰۰۲۰۸۱۷۹۰۹۰۰۲"), GOOD_IBAN)

	def test_validate(self):
		self.assertEqual(B.validate_rows(self.ROWS, "paya_excel"), [])
		bad = [{"payee_name": "", "iban": "IR00", "amount": 0}]
		p = B.validate_rows(bad, "paya_excel")
		self.assertEqual(len(p), 3)
		self.assertTrue(B.validate_rows([], "paya_excel"))
		self.assertTrue(B.validate_rows([{"payee_name": "x", "amount": 1, "account_no": "12345678901"}], "mellat_pay"))

	def test_mellat_layout(self):
		data = B.build_mellat_pay(self.ROWS).decode("cp1256").split("\r\n")
		self.assertEqual(data[0], "0000000001" + "000000001500000")
		row = data[1]
		self.assertEqual(len(row), 10 + 15 + 17 + 30 + 30)
		self.assertTrue(row.startswith("0000123456000000001500000"))
		self.assertTrue(row.endswith("رضا"))

	def test_paya_excel(self):
		try:
			import openpyxl  # noqa: F401
		except ImportError:
			self.skipTest("openpyxl not installed")
		import io

		from openpyxl import load_workbook

		ws = load_workbook(io.BytesIO(B.build_paya_excel(self.ROWS))).active
		self.assertEqual([c.value for c in ws[1]], B.PAYA_COLUMNS)
		self.assertEqual([c.value for c in ws[2]][:3], [1, GOOD_IBAN, 1500000])

	def test_build_file_refuses_bad(self):
		with self.assertRaises(ValueError):
			B.build_file([{"payee_name": "x", "iban": "bad", "amount": 5}], "paya_excel")

	def test_summary(self):
		s = B.summary(self.ROWS)
		self.assertEqual((s["count"], s["total"]), (1, 1500000))


class TestWorkflows(unittest.TestCase):
	def test_definitions_consistent(self):
		for wf in W.WORKFLOWS:
			names = {s[0] for s in wf["states"]}
			self.assertTrue(names <= set(W.STATES), wf["name"])
			for state, action, nxt, role, cond, self_ok in wf["transitions"]:
				self.assertIn(state, names, wf["name"])
				self.assertIn(nxt, names, wf["name"])
				self.assertIn(action, W.ACTIONS)
				self.assertIn(self_ok, (0, 1))
			# every state but the initial one is reachable
			reach = {t[2] for t in wf["transitions"]}
			self.assertEqual(names - reach, {"پیش‌نویس"}, wf["name"])

	def test_ceo_split_is_exhaustive(self):
		po = next(w for w in W.WORKFLOWS if w["doctype"] == "Purchase Order")
		conds = [t[4] for t in po["transitions"] if t[0] == "در انتظار تأیید مدیر خرید" and t[1] == "تأیید"]
		for amount in (1, W.CEO_LIMIT_RIAL, W.CEO_LIMIT_RIAL + 1):
			hits = [c for c in conds if eval(c, {}, {"doc": type("D", (), {"base_grand_total": amount})})]
			self.assertEqual(len(hits), 1, amount)


if __name__ == "__main__":
	unittest.main()
