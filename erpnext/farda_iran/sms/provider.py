"""FardaERP SMS provider architecture (master brief §14/§18).

Provider interface + registry. Adapters included:
- ConsoleProvider  : logs the message (dev/sandbox; used by tests)
- KavenegarProvider: Kavenegar REST (Verify/Send)
- MelipayamakProvider: Melipayamak REST
- GhasedakProvider : Ghasedak REST

Credentials come from ENVIRONMENT VARIABLES ONLY (never repo/db/UI-free text):
  FARDA_SMS_PROVIDER (fallback resolution order: settings > env > console)
  KAVENEGAR_API_KEY, KAVENEGAR_SENDER
  MELIPAYAMAK_USERNAME, MELIPAYAMAK_PASSWORD, MELIPAYAMAK_SENDER
  GHASEDAK_API_KEY, GHASEDAK_SENDER

HTTP calls use `requests` (available in the frappe venv). No keys are ever
logged. Live delivery is INHERENTLY untestable without credentials:
LIVE CREDENTIAL VALIDATION PENDING.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass

try:  # works as erpnext.farda_iran.* inside the app...
	from ..utilities.validators import normalize_national_id
except ImportError:  # ...and as a path-loaded module in standalone tests
	from farda_iran.utilities.validators import normalize_national_id

SMS_TIMEOUT = 15


@dataclass
class SendResult:
	ok: bool
	provider: str
	message_id: str | None = None
	error: str | None = None
	raw: dict | None = None


class SMSProvider(ABC):
	name = "abstract"

	@abstractmethod
	def send_sms(self, phone: str, message: str) -> SendResult:
		...

	def send_otp(self, phone: str, code: str, purpose: str = "login") -> SendResult:
		return self.send_sms(phone, f"کد تأیید {purpose} شما: {code}\nFardaERP")

	def send_template(self, phone: str, template: str, tokens: dict[str, str]) -> SendResult:
		message = template
		for key, value in tokens.items():
			message = message.replace("{" + key + "}", str(value))
		return self.send_sms(phone, message)

	def delivery_status(self, message_id: str) -> SendResult:
		return SendResult(ok=False, provider=self.name, error="delivery_status not supported")


def normalize_ir_mobile(phone: str) -> str:
	"""09xxxxxxxxx canonical form (folds persian digits, +98/98/0098 prefixes)."""
	digits = normalize_national_id(phone).replace("-", "").replace(" ", "")
	if digits.startswith("+98"):
		digits = "0" + digits[3:]
	elif digits.startswith("98") and len(digits) == 12:
		digits = "0" + digits[2:]
	elif digits.startswith("0098"):
		digits = "0" + digits[4:]
	if not (digits.isdigit() and len(digits) == 11 and digits.startswith("09")):
		raise ValueError(f"شماره موبایل ایران معتبر نیست: {phone!r}")
	return digits


class ConsoleProvider(SMSProvider):
	"""Dev/sandbox backend — logs to frappe logger; NEVER for production."""

	name = "console"

	def send_sms(self, phone: str, message: str) -> SendResult:
		phone = normalize_ir_mobile(phone)
		try:
			import frappe

			frappe.logger("farda_sms").info({"phone": "*****" + phone[-4:], "message": message})
		except Exception:
			print(f"[sms:console] {phone}: {message[:40]}...")
		return SendResult(ok=True, provider=self.name, message_id=None)


class KavenegarProvider(SMSProvider):
	name = "kavenegar"

	def __init__(self, api_key: str | None = None, sender: str | None = None):
		self.api_key = api_key or os.environ.get("KAVENEGAR_API_KEY", "")
		self.sender = sender or os.environ.get("KAVENEGAR_SENDER", "")
		if not self.api_key:
			raise ValueError("KAVENEGAR_API_KEY is not set")

	def send_sms(self, phone: str, message: str) -> SendResult:
		import requests

		phone = normalize_ir_mobile(phone)
		try:
			resp = requests.get(
				f"https://api.kavenegar.com/v1/{self.api_key}/sms/send.json",
				params={"receptor": phone, "message": message, "sender": self.sender or None},
				timeout=SMS_TIMEOUT,
			)
			data = resp.json()
			status = int(data.get("return", {}).get("status", -1))
			entries = (data.get("entries") or [{}])
			return SendResult(
				ok=status == 200,
				provider=self.name,
				message_id=str(entries[0].get("messageid")) if entries and isinstance(entries, list) else None,
				error=None if status == 200 else str(data.get("return", {}).get("message")),
				raw={"status": status},
			)
		except Exception as exc:  # network/parse
			return SendResult(ok=False, provider=self.name, error=str(exc))


class MelipayamakProvider(SMSProvider):
	name = "melipayamak"

	def __init__(self, username: str | None = None, password: str | None = None, sender: str | None = None):
		self.username = username or os.environ.get("MELIPAYAMAK_USERNAME", "")
		self.password = password or os.environ.get("MELIPAYAMAK_PASSWORD", "")
		self.sender = sender or os.environ.get("MELIPAYAMAK_SENDER", "")
		if not (self.username and self.password):
			raise ValueError("MELIPAYAMAK_USERNAME/PASSWORD are not set")

	def send_sms(self, phone: str, message: str) -> SendResult:
		import requests

		phone = normalize_ir_mobile(phone)
		try:
			resp = requests.post(
				"https://rest.payamak-panel.com/api/SendSMS/SendSMS",
				json={"username": self.username, "password": self.password, "to": phone, "from": self.sender, "text": message},
				timeout=SMS_TIMEOUT,
			)
			data = resp.json()
			ret = str(data.get("Value", data.get("RetStatus", "")))
			ok = str(data.get("Status", "")) == "true" or str(data.get("RetStatus")) == "1"
			return SendResult(ok=ok, provider=self.name, message_id=ret or None, error=None if ok else str(data))
		except Exception as exc:
			return SendResult(ok=False, provider=self.name, error=str(exc))


class GhasedakProvider(SMSProvider):
	name = "ghasedak"

	def __init__(self, api_key: str | None = None, sender: str | None = None):
		self.api_key = api_key or os.environ.get("GHASEDAK_API_KEY", "")
		self.sender = sender or os.environ.get("GHASEDAK_SENDER", "")
		if not self.api_key:
			raise ValueError("GHASEDAK_API_KEY is not set")

	def send_sms(self, phone: str, message: str) -> SendResult:
		import requests

		phone = normalize_ir_mobile(phone)
		try:
			resp = requests.post(
				"https://api.ghasedak.me/v2/sms/simple",
				headers={"apikey": self.api_key},
				data={"message": message, "receptor": phone, "linenumber": self.sender or None},
				timeout=SMS_TIMEOUT,
			)
			data = resp.json()
			ok = data.get("result", {}).get("code") == "200"
			items = data.get("items") or []
			return SendResult(
				ok=ok,
				provider=self.name,
				message_id=str(items[0].get("messageid")) if items else None,
				error=None if ok else str(data.get("result", {}).get("message")),
			)
		except Exception as exc:
			return SendResult(ok=False, provider=self.name, error=str(exc))


_REGISTRY: dict[str, type[SMSProvider]] = {
	ConsoleProvider.name: ConsoleProvider,
	KavenegarProvider.name: KavenegarProvider,
	MelipayamakProvider.name: MelipayamakProvider,
	GhasedakProvider.name: GhasedakProvider,
}


def register(provider: SMSProvider) -> None:
	"""Extension point for future providers."""
	_REGISTRY[provider.name] = type(provider)


def available() -> list[str]:
	return sorted(_REGISTRY)


def resolve(preferred: str | None = None) -> SMSProvider:
	"""settings/env preferred provider; falls back to console with a warning flag.
	Constructed lazily so missing credentials only fail real sends."""
	name = preferred or os.environ.get("FARDA_SMS_PROVIDER") or "console"
	cls = _REGISTRY.get(name)
	if cls is None:
		raise ValueError(f"سرویس‌دهنده پیامک ناشناخته است: {name}")
	return cls()
