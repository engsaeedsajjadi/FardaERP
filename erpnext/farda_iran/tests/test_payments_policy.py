"""Tests for the payment policy engine + gateway request formation (deterministic;
transport is injected, so these are REAL behavioral tests of OUR code, not mocks
of success)."""

import os
import sys
import unittest
from types import SimpleNamespace

import importlib.util

_HERE = os.path.dirname(os.path.abspath(__file__))
_PAYMENTS = os.path.abspath(os.path.join(_HERE, "..", "payments"))


def _load(name: str, filename: str):
	# `farda_iran` is already importable (sys.modules) from earlier test modules,
	# so the absolute fallback inside these modules resolves via its __path__.
	spec = importlib.util.spec_from_file_location(name, os.path.join(_PAYMENTS, filename))
	mod = importlib.util.module_from_spec(spec)
	sys.modules[name] = mod
	spec.loader.exec_module(mod)
	return mod


paycore = _load("farda_pay_core", "core.py")
paygw = _load("farda_pay_gateways", "gateways.py")


def settled(authority="A1", amount=1_000_000):
	return paycore.SettledTransaction(authority=authority, settled=False, amount_irr=amount)


class TestPolicyEngine(unittest.TestCase):
	def test_accept_first_success(self):
		logged = settled()
		d = paycore.evaluate(logged, 1_000_000, paycore.VerificationReport(True, 1_000_000))
		self.assertEqual(d.decision, paycore.Decision.ACCEPT)

	def test_amount_mismatch_never_settles(self):
		logged = settled()
		d = paycore.evaluate(logged, 1_000_000, paycore.VerificationReport(True, 999_999))
		self.assertEqual(d.decision, paycore.Decision.FAIL_AMOUNT)

	def test_gateway_failure_fails(self):
		d = paycore.evaluate(settled(), 1_000_000, paycore.VerificationReport(False, None))
		self.assertEqual(d.decision, paycore.Decision.FAIL_STATUS)

	def test_duplicate_success_callback_is_already_settled(self):
		logged = paycore.SettledTransaction(authority="A1", settled=True, amount_irr=1_000_000)
		d = paycore.evaluate(logged, 1_000_000, paycore.VerificationReport(True, 1_000_000))
		self.assertEqual(d.decision, paycore.Decision.ALREADY_SETTLED)
		self.assertTrue(d.already)

	def test_replay_attack_low_amount_after_settlement(self):
		# attacker replays success with a DIFFERENT amount -> amount gate first
		logged = paycore.SettledTransaction(authority="A1", settled=True, amount_irr=1_000_000)
		d = paycore.evaluate(logged, 1_000_000, paycore.VerificationReport(True, 100))
		self.assertEqual(d.decision, paycore.Decision.FAIL_AMOUNT)

	def test_unknown_authority_rejected(self):
		d = paycore.evaluate(None, 1_000_000, paycore.VerificationReport(True, 1_000_000))
		self.assertEqual(d.decision, paycore.Decision.FAIL_UNKNOWN_TX)


class FakeResponse:
	def __init__(self, payload):
		self._payload = payload

	def json(self):
		return self._payload


class RecordingHTTP:
	"""Captures outgoing calls — lets us assert the REQUEST our adapter builds."""

	def __init__(self, response_payload):
		self.payload = response_payload
		self.calls = []

	def post(self, url, **kwargs):
		self.calls.append(("POST", url, kwargs))
		return FakeResponse(self.payload)

	def get(self, url, **kwargs):
		self.calls.append(("GET", url, kwargs))
		return FakeResponse(self.payload)


class TestZarinPalRequestFormation(unittest.TestCase):
	def test_request_shape_and_redirect(self):
		http = RecordingHTTP({"data": {"code": 100, "authority": "A000123"}})
		gw = paygw.ZarinPalGateway(merchant_id="M-123", http=http)
		result = gw.create_payment(1_500_000, "https://site/pay-cb", "inv-1")
		self.assertTrue(result.ok)
		self.assertEqual(result.authority, "A000123")
		self.assertIn("StartPay/A000123", result.redirect_url)
		method, url, kwargs = http.calls[0]
		self.assertIn("/request.json", url)
		self.assertEqual(kwargs["json"]["amount"], 1_500_000)  # IRR untouched
		self.assertEqual(kwargs["json"]["merchant_id"], "M-123")

	def test_verify_maps_codes(self):
		http = RecordingHTTP({"data": {"code": 101, "amount": 1_500_000}})
		gw = paygw.ZarinPalGateway(merchant_id="M-123", http=http)
		report = gw.verify_payment("A000123", 1_500_000)
		self.assertTrue(report.ok)
		self.assertEqual(report.amount_irr, 1_500_000)

	def test_sandbox_base_when_env(self):
		os.environ["FARDA_PAYMENT_SANDBOX"] = "1"
		try:
			http = RecordingHTTP({"data": {"code": 100, "authority": "S1"}})
			gw = paygw.ZarinPalGateway(merchant_id="M", http=http)
			gw.create_payment(1000, "cb", "d")
			self.assertIn("sandbox.zarinpal.com", http.calls[0][1])
		finally:
			del os.environ["FARDA_PAYMENT_SANDBOX"]


class TestIDPayAndNextPay(unittest.TestCase):
	def test_idpay_headers_and_amount(self):
		http = RecordingHTTP({"id": "T9", "link": "https://idpay.ir/link"})
		gw = paygw.IDPayGateway(api_key="K", http=http)
		result = gw.create_payment(250_000, "cb", "order-9")
		self.assertTrue(result.ok)
		method, url, kwargs = http.calls[0]
		self.assertIn("idpay.ir", url)
		self.assertEqual(kwargs["headers"]["X-API-KEY"], "K")
		self.assertEqual(kwargs["json"]["amount"], 250_000)

	def test_nextpay_uses_irr_currency(self):
		http = RecordingHTTP({"code": -1, "trans_id": "NX1"})
		gw = paygw.NextPayGateway(api_key="K", http=http)
		result = gw.create_payment(700_000, "cb", "o")
		self.assertTrue(result.ok)
		kwargs = http.calls[0][2]
		self.assertEqual(kwargs["data"]["currency"], "IRR")
		self.assertEqual(kwargs["data"]["amount"], 700_000)


class TestRegistry(unittest.TestCase):
	def test_available_and_unknown(self):
		self.assertIn("zarinpal", paygw.available())
		with self.assertRaises(ValueError):
			paygw.resolve("unknown-gw")

	def test_gateway_lowball_never_settles_unsettled_tx(self):
		"""Gateway echoes a lower amount than logged -> FAIL_AMOUNT even if caller echoes gateway value."""
		logged = paycore.SettledTransaction(authority="A1", settled=False, amount_irr=1_000_000)
		report = paycore.VerificationReport(ok=True, amount_irr=500_000)
		d = paycore.evaluate(logged, report.amount_irr, report)  # buggy-caller style: expected = echo
		self.assertEqual(d.decision, paycore.Decision.FAIL_AMOUNT)
		self.assertTrue(any("logged" in r for r in d.reasons), d.reasons)

	def test_gateway_lowball_after_settlement_stays_idempotent_but_noted(self):
		logged = paycore.SettledTransaction(authority="A1", settled=True, amount_irr=1_000_000)
		report = paycore.VerificationReport(ok=True, amount_irr=500_000)
		d = paycore.evaluate(logged, report.amount_irr, report)
		self.assertEqual(d.decision, paycore.Decision.ALREADY_SETTLED)
		self.assertTrue(d.already)
		self.assertTrue(any("differs from logged" in r for r in d.reasons), d.reasons)


if __name__ == "__main__":
	unittest.main()
