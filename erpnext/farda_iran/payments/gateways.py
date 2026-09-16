"""Gateway adapters: ZarinPal · IDPay · NextPay (interface + sandbox support).

- Credentials from environment ONLY: ZARINPAL_MERCHANT_ID / IDPAY_API_KEY /
  NEXTPAY_API_KEY. Sandbox: FARDA_PAYMENT_SANDBOX=1.
- Amounts are IRR (integral) end-to-end; adapters convert nothing — gateways
  are configured (or tested) in Rials. Never multiply/divide here.
- `requests` injected for deterministic tests (transport seam); defaults to
  the real module at call time.

LIVE CREDENTIAL VALIDATION PENDING — sandbox URLs/headers implemented; real
network verification requires merchant credentials.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass

try:  # relative inside the app
	from .core import VerificationReport
except ImportError:  # absolute when path-loaded (package __path__ stays valid)
	from farda_iran.payments.core import VerificationReport  # type: ignore


@dataclass
class PaymentRequestResult:
	ok: bool
	authority: str | None      # gateway token/authority to verify later
	redirect_url: str | None
	error: str | None = None


def _requests():
	import requests

	return requests


def sandbox_mode() -> bool:
	return os.environ.get("FARDA_PAYMENT_SANDBOX", "") == "1"


class PaymentGateway(ABC):
	name = "abstract"

	@abstractmethod
	def create_payment(self, amount_irr: int, callback_url: str, description: str) -> PaymentRequestResult:
		...

	@abstractmethod
	def verify_payment(self, authority: str, amount_irr: int) -> VerificationReport:
		...


class ZarinPalGateway(PaymentGateway):
	name = "zarinpal"
	BASE = "https://api.zarinpal.com/pg/v4/payment"
	SANDBOX_BASE = "https://sandbox.zarinpal.com/pg/v4/payment"
	START_PAY = "https://www.zarinpal.com/pg/StartPay/{authority}"
	SANDBOX_START_PAY = "https://sandbox.zarinpal.com/pg/StartPay/{authority}"

	def __init__(self, merchant_id: str | None = None, http=None):
		self.merchant_id = merchant_id or os.environ.get("ZARINPAL_MERCHANT_ID", "")
		if not self.merchant_id:
			raise ValueError("ZARINPAL_MERCHANT_ID is not set")
		self._http = http

	def create_payment(self, amount_irr: int, callback_url: str, description: str) -> PaymentRequestResult:
		http = self._http or _requests()
		base = self.SANDBOX_BASE if sandbox_mode() else self.BASE
		try:
			resp = http.post(
				f"{base}/request.json",
				json={
					"merchant_id": self.merchant_id,
					"amount": int(amount_irr),
					"callback_url": callback_url,
					"description": description,
				},
				timeout=15,
			)
			data = resp.json().get("data") or {}
			if data.get("authority") and (data.get("code") in (100, 101)):
				tpl = self.SANDBOX_START_PAY if sandbox_mode() else self.START_PAY
				return PaymentRequestResult(ok=True, authority=data["authority"], redirect_url=tpl.format(authority=data["authority"]))
			return PaymentRequestResult(ok=False, authority=None, redirect_url=None, error=str(data.get("message") or data))
		except Exception as exc:
			return PaymentRequestResult(ok=False, authority=None, redirect_url=None, error=str(exc))

	def verify_payment(self, authority: str, amount_irr: int) -> VerificationReport:
		http = self._http or _requests()
		base = self.SANDBOX_BASE if sandbox_mode() else self.BASE
		try:
			resp = http.post(
				f"{base}/verify.json",
				json={"merchant_id": self.merchant_id, "amount": int(amount_irr), "authority": authority},
				timeout=15,
			)
			data = resp.json().get("data") or {}
			code = int(data.get("code", -1))
			return VerificationReport(ok=code in (100, 101), amount_irr=int(data.get("amount", amount_irr)))
		except Exception:
			return VerificationReport(ok=False, amount_irr=None)


class IDPayGateway(PaymentGateway):
	name = "idpay"
	BASE = "https://api.idpay.ir/v1.1"

	def __init__(self, api_key: str | None = None, http=None):
		self.api_key = api_key or os.environ.get("IDPAY_API_KEY", "")
		if not self.api_key:
			raise ValueError("IDPAY_API_KEY is not set")
		self._http = http

	def _headers(self) -> dict:
		headers = {"X-API-KEY": self.api_key, "Content-Type": "application/json"}
		if sandbox_mode():
			headers["X-SANDBOX"] = "1"
		return headers

	def create_payment(self, amount_irr: int, callback_url: str, description: str) -> PaymentRequestResult:
		http = self._http or _requests()
		try:
			resp = http.post(
				f"{self.BASE}/payment",
				headers=self._headers(),
				json={"order_id": description[:60], "amount": int(amount_irr), "callback": callback_url},
				timeout=15,
			)
			data = resp.json()
			if data.get("id") and data.get("link"):
				return PaymentRequestResult(ok=True, authority=data["id"], redirect_url=data["link"])
			return PaymentRequestResult(ok=False, authority=None, redirect_url=None, error=str(data.get("error_message") or data))
		except Exception as exc:
			return PaymentRequestResult(ok=False, authority=None, redirect_url=None, error=str(exc))

	def verify_payment(self, authority: str, amount_irr: int) -> VerificationReport:
		http = self._http or _requests()
		try:
			resp = http.post(
				f"{self.BASE}/payment/verify",
				headers=self._headers(),
				json={"id": authority, "order_id": None},
				timeout=15,
			)
			data = resp.json()
			# status 100/101/200 = paid/already verified/settled
			status = int(data.get("status", -1))
			amount = data.get("amount")
			return VerificationReport(ok=status in (100, 101, 200), amount_irr=int(amount) if amount is not None else None)
		except Exception:
			return VerificationReport(ok=False, amount_irr=None)


class NextPayGateway(PaymentGateway):
	name = "nextpay"
	BASE = "https://nextpay.org/nx/gateway"
	SANDBOX_BASE = "https://sandbox.nextpay.org/nx/gateway"

	def __init__(self, api_key: str | None = None, http=None):
		self.api_key = api_key or os.environ.get("NEXTPAY_API_KEY", "")
		if not self.api_key:
			raise ValueError("NEXTPAY_API_KEY is not set")
		self._http = http

	def create_payment(self, amount_irr: int, callback_url: str, description: str) -> PaymentRequestResult:
		http = self._http or _requests()
		base = self.SANDBOX_BASE if sandbox_mode() else self.BASE
		try:
			resp = http.post(
				f"{base}/token",
				data={"api_key": self.api_key, "order_id": description[:60], "amount": int(amount_irr), "callback_uri": callback_url, "currency": "IRR"},
				timeout=15,
			)
			data = resp.json()
			code = int(data.get("code", -1))
			if data.get("trans_id") and code == -1:
				return PaymentRequestResult(
					ok=True,
					authority=data["trans_id"],
					redirect_url=f"{base}/purchase?trans_id={data['trans_id']}",
				)
			return PaymentRequestResult(ok=False, authority=None, redirect_url=None, error=str(data))
		except Exception as exc:
			return PaymentRequestResult(ok=False, authority=None, redirect_url=None, error=str(exc))

	def verify_payment(self, authority: str, amount_irr: int) -> VerificationReport:
		http = self._http or _requests()
		base = self.SANDBOX_BASE if sandbox_mode() else self.BASE
		try:
			resp = http.get(
				f"{base}/verify",
				params={"api_key": self.api_key, "trans_id": authority, "amount": int(amount_irr), "currency": "IRR"},
				timeout=15,
			)
			data = resp.json()
			code = int(data.get("code", -1))
			amount = data.get("amount")
			return VerificationReport(ok=code == 0, amount_irr=int(amount) if amount is not None else None)
		except Exception:
			return VerificationReport(ok=False, amount_irr=None)


_REGISTRY = {
	ZarinPalGateway.name: ZarinPalGateway,
	IDPayGateway.name: IDPayGateway,
	NextPayGateway.name: NextPayGateway,
}


def available() -> list[str]:
	return sorted(_REGISTRY)


def resolve_class(name: str) -> type[PaymentGateway]:
	cls = _REGISTRY.get(name)
	if cls is None:
		raise ValueError(f"درگاه پرداخت ناشناخته است: {name}")
	return cls


def resolve(preferred: str | None = None) -> PaymentGateway:
	name = preferred or os.environ.get("FARDA_PAYMENT_GATEWAY", "zarinpal")
	cls = _REGISTRY.get(name)
	if cls is None:
		raise ValueError(f"درگاه پرداخت ناشناخته است: {name}")
	return cls()
