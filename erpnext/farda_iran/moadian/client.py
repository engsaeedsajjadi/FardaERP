"""HTTP client for the Moadian v2 API (RC_TICS.IS). No frappe dependency.

Flow: GET nonce -> token = JWS{nonce, clientId} -> GET server-information
(tax org public key, kept in memory for this client only) -> invoice JSON
signed (JWS) then encrypted (JWE) -> POST invoice -> inquiry-by-uid.
`transport` is injectable so tests can run against a local mock.
"""

from __future__ import annotations

import json
import uuid

from . import jose
from .config import MoadianConfig


class MoadianError(Exception):
	def __init__(self, message: str, status: int | None = None, body: str | None = None):
		super().__init__(message)
		self.status = status
		self.body = (body or "")[:4000]


def _requests_transport(method, url, headers=None, params=None, data=None, timeout=30):
	import requests

	resp = requests.request(method, url, headers=headers, params=params, data=data, timeout=timeout)
	return resp.status_code, resp.text


class MoadianClient:
	def __init__(self, cfg: MoadianConfig, private_key, cert_b64: str, transport=None):
		self.cfg = cfg
		self.key = private_key
		self.cert = cert_b64
		self.transport = transport or _requests_transport
		self._server_key = None

	@classmethod
	def from_config(cls, cfg: MoadianConfig, transport=None) -> "MoadianClient":
		problems = cfg.problems()
		if problems:
			raise MoadianError("؛ ".join(problems))
		with open(cfg.private_key_path, "rb") as fh:
			key = jose.load_private_key(fh.read(), cfg.key_password)
		with open(cfg.cert_path, "rb") as fh:
			cert = jose.cert_b64(fh.read())
		return cls(cfg, key, cert, transport)

	# -- plumbing -------------------------------------------------------
	def _call(self, method: str, path: str, params=None, body=None, auth=True):
		headers = {"Accept": "application/json"}
		if auth:
			headers["Authorization"] = f"Bearer {self.token()}"
		data = None
		if body is not None:
			headers["Content-Type"] = "application/json"
			data = json.dumps(body, ensure_ascii=False).encode("utf-8")
		try:
			status, text = self.transport(method, self.cfg.base_url + path, headers=headers, params=params, data=data)
		except Exception as exc:  # network: the request may or may not have arrived
			raise MoadianError(f"ارتباط با سامانه برقرار نشد: {type(exc).__name__}") from exc
		if status >= 400:
			raise MoadianError(f"پاسخ خطا از سامانه (HTTP {status})", status, text)
		try:
			return json.loads(text) if text else {}
		except ValueError:
			raise MoadianError("پاسخ سامانه JSON معتبر نیست", status, text)

	def token(self) -> str:
		res = self._call("GET", "nonce", params={"timeToLive": 30}, auth=False)
		nonce = res.get("nonce") if isinstance(res, dict) else None
		if not nonce:
			raise MoadianError("سامانه nonce برنگرداند", body=json.dumps(res, ensure_ascii=False))
		payload = json.dumps({"nonce": nonce, "clientId": self.cfg.memory_id}, separators=(",", ":"))
		return jose.sign(payload, self.key, self.cert)

	def server_key(self):
		if self._server_key is None:
			info = self._call("GET", "server-information")
			keys = (info or {}).get("publicKeys") or []
			if not keys:
				raise MoadianError("کلید عمومی سازمان امور مالیاتی دریافت نشد")
			k = keys[0]
			self._server_key = (jose.load_server_public_key(k.get("key")), k.get("id"))
		return self._server_key

	# -- API ------------------------------------------------------------
	def fiscal_information(self) -> dict:
		return self._call("GET", "fiscal-information", params={"memoryId": self.cfg.memory_id})

	def send_invoices(self, invoices: list[dict]) -> dict:
		pub, kid = self.server_key()
		packets = []
		for inv in invoices:
			signed = jose.sign(json.dumps(inv, ensure_ascii=False, separators=(",", ":")), self.key, self.cert)
			packets.append(
				{
					"payload": jose.encrypt(signed, pub, kid),
					"header": {"requestTraceId": str(uuid.uuid4()), "fiscalId": self.cfg.memory_id},
				}
			)
		return self._call("POST", "invoice", body=packets)

	def inquiry_by_uid(self, uids: list[str]) -> list:
		res = self._call("GET", "inquiry-by-uid", params={"uidList": list(uids)[:100], "fiscalId": self.cfg.memory_id})
		return res if isinstance(res, list) else (res or {}).get("result") or []

	def inquiry_by_reference(self, refs: list[str]) -> list:
		res = self._call("GET", "inquiry-by-reference-id", params={"referenceIds": list(refs)[:100]})
		return res if isinstance(res, list) else (res or {}).get("result") or []


def parse_send_result(res) -> dict:
	"""Pick uid / referenceNumber / errors out of the POST invoice response."""
	items = res.get("result") if isinstance(res, dict) else res
	first = (items or [{}])[0] if isinstance(items, list) else {}
	errors = (res.get("errors") if isinstance(res, dict) else None) or first.get("errors") or []
	return {
		"uid": first.get("uid"),
		"reference_number": first.get("referenceNumber"),
		"errors": errors,
	}


def parse_inquiry(item: dict) -> dict:
	data = item.get("data") or {}
	if isinstance(data, str):
		try:
			data = json.loads(data)
		except ValueError:
			data = {}
	return {
		"uid": item.get("uid"),
		"reference_number": item.get("referenceNumber"),
		"status": (item.get("status") or "").upper(),
		"errors": data.get("error") or [],
		"warnings": data.get("warning") or [],
	}
