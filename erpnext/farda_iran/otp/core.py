"""FardaERP OTP engine — pure, testable core (no frappe import).

Security properties (master brief §14/§19):
- codes: cryptographically random (secrets), fixed length, never logged
- storage: salted SHA-256 with a server-side pepper — plaintext never persisted
- expiry: hard TTL (default 120s)
- attempts: max attempts per challenge (default 3), then challenge is dead
- one-time use: a verified challenge cannot verify twice (replay protection)
- sending rate limits: cooldown between sends + hourly cap per phone
- timing: constant-time digest comparison (hmac.compare_digest)

Storage is abstracted behind a small store interface so the logic is fully
unit-testable; `frappe_store` (frappe-backed, "Farda OTP Log") is provided for
runtime use.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass, field

DEFAULT_TTL_SECONDS = 120
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_COOLDOWN_SECONDS = 60
DEFAULT_HOURLY_LIMIT = 5
CODE_DIGITS = 6


class OtpError(Exception):
	"""User-facing failure (message may be shown in UI)."""


class RateLimited(OtpError):
	pass


class InvalidOrExpired(OtpError):
	"""Deliberately vague: never reveal whether the code or the id was wrong."""


@dataclass
class Challenge:
	id: str
	phone: str
	purpose: str
	code_hash: str
	salt: str
	expires_at: float
	max_attempts: int = DEFAULT_MAX_ATTEMPTS
	attempts: int = 0
	used: bool = False
	created_at: float = field(default_factory=lambda: time.time())


def generate_code(digits: int = CODE_DIGITS) -> str:
	"""Cryptographically random numeric code with no leading-zero bias issue
	(all digit strings 0..10^digits-1 equally likely)."""
	upper = 10**digits
	return str(secrets.randbelow(upper)).zfill(digits)


def load_or_create_pepper(get_env) -> bytes:
	"""Server-side pepper comes from the environment ONLY (never repo/DB)."""
	pepper = get_env("FARDA_OTP_PEPPER")
	if not pepper:
		raise OtpError("FARDA_OTP_PEPPER environment variable is not set")
	return pepper.encode()


def hash_code(code: str, salt: str, pepper: bytes) -> str:
	"""salted code + server pepper -> sha256 hex."""
	material = f"{salt}:{code}".encode() + pepper
	return hashlib.sha256(material).hexdigest()


def can_send(store, phone: str, purpose: str, *, cooldown: int = DEFAULT_COOLDOWN_SECONDS,
             hourly_limit: int = DEFAULT_HOURLY_LIMIT, now: float | None = None) -> None:
	"""Raise RateLimited when the phone is over its sending limits."""
	now = now if now is not None else time.time()
	last = store.last_sent_at(phone, purpose)
	if last is not None and now - last < cooldown:
		raise RateLimited(f"برای ارسال مجدد {int(cooldown - (now - last))} ثانیه صبر کنید")
	recent = store.sent_count_in_hour(phone, purpose, now)
	if recent >= hourly_limit:
		raise RateLimited("تعداد درخواست کد برای این شماره بیش از حد مجاز است")


def create_challenge(store, phone: str, purpose: str, pepper: bytes, *,
                     ttl: int = DEFAULT_TTL_SECONDS,
                     max_attempts: int = DEFAULT_MAX_ATTEMPTS,
                     now: float | None = None) -> Challenge:
	"""Rate-check, generate, hash, persist; returns the challenge (NO code)."""
	now = now if now is not None else time.time()
	can_send(store, phone, purpose, now=now)
	code = generate_code()
	salt = secrets.token_hex(8)
	challenge = Challenge(
		id=secrets.token_urlsafe(16),
		phone=phone,
		purpose=purpose,
		code_hash=hash_code(code, salt, pepper),
		salt=salt,
		expires_at=now + ttl,
		max_attempts=max_attempts,
		created_at=now,
	)
	store.save(challenge, code)  # store may hand `code` to the SMS provider
	store.mark_sent(phone, purpose, now)
	return challenge


def verify(store, challenge_id: str, code: str, pepper: bytes, *, now: float | None = None) -> bool:
	"""One-shot verification; raises InvalidOrExpired on any failure path."""
	now = now if now is not None else time.time()
	challenge = store.get(challenge_id)
	if challenge is None:
		raise InvalidOrExpired("کد نامعتبر است")
	if challenge.used:
		raise InvalidOrExpired("کد نامعتبر است")
	if now > challenge.expires_at:
		store.delete(challenge_id)
		raise InvalidOrExpired("کد منقضی شده است؛ درخواست کد جدید کنید")
	if challenge.attempts >= challenge.max_attempts:
		store.delete(challenge_id)
		raise InvalidOrExpired("تعداد تلاش‌ها بیش از حد مجاز است؛ کد جدید درخواست کنید")
	computed = hash_code(code.strip(), challenge.salt, pepper)
	if hmac.compare_digest(computed, challenge.code_hash):
		challenge.used = True
		challenge.attempts += 1
		store.update(challenge)
		return True
	challenge.attempts += 1
	store.update(challenge)
	if challenge.attempts >= challenge.max_attempts:
		store.delete(challenge_id)
	raise InvalidOrExpired("کد نامعتبر است")
