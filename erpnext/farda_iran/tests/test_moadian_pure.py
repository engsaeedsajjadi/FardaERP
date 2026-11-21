"""Unit tests: سامانه مودیان — taxid, invoice arithmetic, JWS/JWE, client against a mock (frappe-free)."""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
import unittest

try:
	from farda_iran.moadian import client as mclient, config as mconfig, invoice as minv, jose, taxid
except ImportError:
	from erpnext.farda_iran.moadian import client as mclient, config as mconfig, invoice as minv, jose, taxid

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

DAY = 86_400_000


def _keypair_and_cert():
	key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
	name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "farda-test")])
	now = dt.datetime.now(dt.timezone.utc)
	cert = (
		x509.CertificateBuilder()
		.subject_name(name)
		.issuer_name(name)
		.public_key(key.public_key())
		.serial_number(1)
		.not_valid_before(now - dt.timedelta(days=1))
		.not_valid_after(now + dt.timedelta(days=1))
		.sign(key, hashes.SHA256())
	)
	return key, cert.public_bytes(serialization.Encoding.PEM)


class TaxIdTests(unittest.TestCase):
	def test_official_vector(self):
		# RC_DCPS.SN_V1.3 Appendix 1
		self.assertEqual(taxid.generate("DEF5GH", 18463 * DAY + 1234, 12), "DEF5GH0481F000000000C2")
		self.assertEqual(taxid.control_string("DEF5GH", 18463, 12), "68697057172018463000000000012")

	def test_real_accepted_taxids_verify(self):
		for t in ("A41XRD050B1006A5E4C549", "A2HP31050B0006A607FE94", "DEF5GH0481F000000000C2"):
			self.assertTrue(taxid.is_valid(t), t)
		self.assertFalse(taxid.is_valid("DEF5GH0481F000000000C7"))

	def test_inno_and_day_match(self):
		t = taxid.generate("a11216", 19500 * DAY + 5, 0x1A2B)
		self.assertEqual(taxid.inno_of(t), "0000001A2B")
		self.assertTrue(t.startswith("A11216"))
		self.assertTrue(taxid.is_valid(t, 19500 * DAY + 80_000_000))
		self.assertFalse(taxid.is_valid(t, 19501 * DAY))

	def test_memory_id_alphabet(self):
		self.assertTrue(taxid.is_valid_memory_id("A11216"))
		self.assertFalse(taxid.is_valid_memory_id("A1I216"))
		self.assertFalse(taxid.is_valid_memory_id("A10216"))


def _spec(**kw):
	base = dict(
		memory_id="A11216",
		serial=1,
		indatim=19500 * DAY + 3_600_000,
		seller_tin="10101234565",
		inty=1,
		buyer={"tob": 2, "tinb": "14011576540"},
		setm=2,
		lines=[{"sstid": "2330001234567", "sstt": "کالا", "am": 2, "fee": 10000, "dis": 500, "vra": 9}],
	)
	base.update(kw)
	return base


class InvoiceTests(unittest.TestCase):
	def test_official_worked_example(self):
		# RC_TICS.IS v1.6 example: am 2, fee 10000, dis 500 (whole line), vra 9
		inv = minv.build(_spec())
		b, h = inv["body"][0], inv["header"]
		self.assertEqual((b["prdis"], b["dis"], b["adis"], b["vam"], b["tsstam"]), (20000, 500, 19500, 1755, 21255))
		self.assertEqual((h["tprdis"], h["tdis"], h["tadis"], h["tvam"], h["todam"], h["tbill"]), (20000, 500, 19500, 1755, 0, 21255))
		self.assertEqual(h["inno"], h["taxid"][11:21])
		self.assertNotIn("cap", h)
		self.assertTrue(minv.validate(inv, now_ms=h["indatim"] + 1000)["ok"])

	def test_vat_is_truncated_not_rounded(self):
		inv = minv.build(_spec(lines=[{"sstid": "2330001234567", "am": 1, "fee": 99999, "vra": 10}]))
		self.assertEqual(inv["body"][0]["vam"], 9999)

	def test_mixed_settlement_excludes_vat(self):
		inv = minv.build(_spec(setm=3, paid_amount=11000, lines=[{"sstid": "2330001234567", "am": 1, "fee": 20000, "vra": 10}]))
		h = inv["header"]
		self.assertEqual(h["setm"], 3)
		self.assertEqual(h["cap"] + h["insp"], h["tadis"])
		self.assertEqual(h["cap"], 10000)
		# fully paid -> cash, unpaid -> credit
		self.assertEqual(minv.build(_spec(setm=3, paid_amount=22000))["header"]["setm"], 1)
		self.assertEqual(minv.build(_spec(setm=3, paid_amount=0))["header"]["setm"], 2)

	def test_validation_messages(self):
		inv = minv.build(_spec(seller_tin="123", buyer={"tob": 2}, lines=[{"sstid": "", "am": 1, "fee": 5, "vra": 10}]))
		fields = {e["field"] for e in minv.validate(inv)["errors"]}
		self.assertIn("tins", fields)
		self.assertIn("tinb", fields)
		self.assertIn("body[1].sstid", fields)

	def test_natural_person_needs_national_id_and_postcode(self):
		inv = minv.build(_spec(buyer={"tob": 1, "bid": "0012345678"}))
		self.assertIn("bid", {e["field"] for e in minv.validate(inv)["errors"]})
		inv = minv.build(_spec(buyer={"tob": 1, "bid": "۰۰۱۲۳۴۵۶۷۸", "bpc": "1234567890"}))
		self.assertEqual(inv["header"]["bid"], "0012345678")
		self.assertTrue(minv.validate(inv)["ok"])

	def test_deadline(self):
		inv = minv.build(_spec())
		h = inv["header"]
		self.assertFalse(minv.validate(inv, now_ms=h["indatim"] + 8 * DAY)["ok"])
		self.assertFalse(minv.validate(inv, now_ms=h["indatim"] - 3_600_000)["ok"])

	def test_cancellation_is_header_only(self):
		ref = taxid.generate("A11216", 19500 * DAY, 1)
		inv = minv.build(dict(memory_id="A11216", serial=2, indatim=19501 * DAY, seller_tin="10101234565", ins=3, irtaxid=ref))
		self.assertEqual(inv["body"], [])
		self.assertEqual(inv["header"]["irtaxid"], ref)
		self.assertNotIn("inty", inv["header"])
		self.assertTrue(minv.validate(inv)["ok"])


class JoseTests(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.key, cls.cert_pem = _keypair_and_cert()
		cls.cert = jose.cert_b64(cls.cert_pem)

	def test_jws_roundtrip_and_header(self):
		tok = jose.sign('{"a":"سلام"}', self.key, self.cert)
		header, payload = jose.verify(tok)
		self.assertEqual(header["alg"], "RS256")
		self.assertEqual(header["crit"], ["sigT"])
		self.assertRegex(header["sigT"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
		self.assertEqual(json.loads(payload), {"a": "سلام"})

	def test_jwe_roundtrip(self):
		tok = jose.encrypt(b"hello", self.key.public_key(), kid="k1")
		parts = tok.split(".")
		self.assertEqual(len(parts), 5)
		self.assertEqual(len(jose.b64url_decode(parts[2])), 12)  # 96-bit IV (error 04153)
		hdr = json.loads(jose.b64url_decode(parts[0]))
		self.assertEqual((hdr["alg"], hdr["enc"], hdr["kid"]), ("RSA-OAEP-256", "A256GCM", "k1"))
		self.assertEqual(jose.decrypt(tok, self.key), b"hello")

	def test_csr_rejected(self):
		with self.assertRaises(ValueError):
			jose.cert_b64(b"-----BEGIN CERTIFICATE REQUEST-----\nxx\n-----END CERTIFICATE REQUEST-----")


class MockServer:
	"""In-memory stand-in for the Moadian API, checking what a real server checks."""

	def __init__(self, test):
		self.t = test
		self.org_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
		self.nonces = set()
		self.received = []

	def __call__(self, method, url, headers=None, params=None, data=None, timeout=30):
		path = url.rsplit("/", 1)[-1]
		if path == "nonce":
			n = f"n{len(self.nonces)}"
			self.nonces.add(n)
			return 200, json.dumps({"nonce": n, "expDate": "x"})
		auth = (headers or {}).get("Authorization", "")
		self.t.assertTrue(auth.startswith("Bearer "))
		_h, payload = jose.verify(auth[7:])
		tok = json.loads(payload)
		self.t.assertIn(tok["nonce"], self.nonces)
		self.nonces.discard(tok["nonce"])  # single use
		self.t.assertEqual(tok["clientId"], "A11216")
		if path == "server-information":
			der = self.org_key.public_key().public_bytes(
				serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
			)
			import base64

			return 200, json.dumps({"publicKeys": [{"key": base64.b64encode(der).decode(), "id": "kid-1"}]})
		if path == "invoice":
			packets = json.loads(data)
			out = []
			for p in packets:
				self.t.assertEqual(p["header"]["fiscalId"], "A11216")
				signed = jose.decrypt(p["payload"], self.org_key).decode()
				_hh, inv = jose.verify(signed)
				self.received.append(json.loads(inv))
				out.append({"uid": p["header"]["requestTraceId"], "referenceNumber": "R-1"})
			return 200, json.dumps({"result": out})
		if path == "inquiry-by-uid":
			return 200, json.dumps([{"uid": params["uidList"][0], "status": "SUCCESS", "referenceNumber": "R-1", "data": {"error": [], "warning": []}}])
		return 404, "{}"


class ClientTests(unittest.TestCase):
	def test_full_flow_against_mock(self):
		key, cert_pem = _keypair_and_cert()
		with tempfile.TemporaryDirectory() as d:
			kp, cp = os.path.join(d, "k.pem"), os.path.join(d, "c.pem")
			with open(kp, "wb") as fh:
				fh.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
			with open(cp, "wb") as fh:
				fh.write(cert_pem)
			cfg = mconfig.load({"FARDA_MOADIAN_MEMORY_ID": "a11216", "FARDA_MOADIAN_PRIVATE_KEY_PATH": kp, "FARDA_MOADIAN_CERT_PATH": cp})
			self.assertEqual(cfg.target, "sandbox")
			self.assertEqual(cfg.public_view()["memory_id"], "A1••16")
			server = MockServer(self)
			c = mclient.MoadianClient.from_config(cfg, transport=server)
			inv = minv.build(_spec())
			res = mclient.parse_send_result(c.send_invoices([inv]))
			self.assertTrue(res["uid"])
			self.assertEqual(server.received[0], json.loads(json.dumps(inv)))
			st = mclient.parse_inquiry(c.inquiry_by_uid([res["uid"]])[0])
			self.assertEqual(st["status"], "SUCCESS")

	def test_live_is_locked(self):
		cfg = mconfig.load({"FARDA_MOADIAN_TARGET": "live", "FARDA_MOADIAN_MEMORY_ID": "A11216"})
		self.assertEqual(cfg.base_url, mconfig.LIVE_BASE_URL)
		self.assertTrue(any("قفل" in p for p in cfg.problems()))
		with self.assertRaises(mclient.MoadianError):
			mclient.MoadianClient.from_config(cfg)


if __name__ == "__main__":
	unittest.main()
