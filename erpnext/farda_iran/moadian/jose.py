"""Minimal JWS (RS256) and JWE (RSA-OAEP-256 + A256GCM) for the Moadian API.

Uses only the `cryptography` package (already a Frappe dependency).
JWS header follows the official SDK: alg RS256, typ jose, x5c [cert], sigT,
crit [sigT], cty text/plain. sigT is set at EVERY signature (not once per
process). JWE uses a fresh 256-bit CEK and a 96-bit IV per message.
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def b64url(data: bytes) -> str:
	return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
	return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _json(obj) -> bytes:
	return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def load_private_key(pem: bytes, password: str | None = None):
	key = serialization.load_pem_private_key(pem, password=password.encode() if password else None)
	if not isinstance(key, rsa.RSAPrivateKey):
		raise ValueError("کلید خصوصی باید از نوع RSA باشد")
	return key


def cert_b64(pem: bytes) -> str:
	"""Certificate as standard base64 DER for the x5c header. Rejects a CSR."""
	if b"CERTIFICATE REQUEST" in pem:
		raise ValueError("فایل گواهی، درخواست گواهی (CSR) است؛ گواهی صادرشده (CERTIFICATE) لازم است")
	cert = x509.load_pem_x509_certificate(pem)
	return base64.b64encode(cert.public_bytes(serialization.Encoding.DER)).decode("ascii")


def sign(payload: bytes | str, private_key, cert_b64_value: str, now: datetime | None = None) -> str:
	if isinstance(payload, str):
		payload = payload.encode("utf-8")
	sig_t = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
	header = {
		"alg": "RS256",
		"typ": "jose",
		"x5c": [cert_b64_value],
		"sigT": sig_t,
		"crit": ["sigT"],
		"cty": "text/plain",
	}
	signing_input = f"{b64url(_json(header))}.{b64url(payload)}".encode("ascii")
	signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
	return f"{signing_input.decode('ascii')}.{b64url(signature)}"


def load_server_public_key(key_text: str):
	"""server-information returns the key as base64 DER (SubjectPublicKeyInfo) or PEM."""
	text = (key_text or "").strip()
	if text.startswith("-----BEGIN"):
		return serialization.load_pem_public_key(text.encode())
	return serialization.load_der_public_key(base64.b64decode(text))


def encrypt(plaintext: bytes | str, public_key, kid: str | None = None) -> str:
	if isinstance(plaintext, str):
		plaintext = plaintext.encode("utf-8")
	header = {"alg": "RSA-OAEP-256", "enc": "A256GCM"}
	if kid:
		header["kid"] = kid
	protected = b64url(_json(header))
	cek = os.urandom(32)
	iv = os.urandom(12)
	encrypted_key = public_key.encrypt(
		cek, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
	)
	sealed = AESGCM(cek).encrypt(iv, plaintext, protected.encode("ascii"))
	ciphertext, tag = sealed[:-16], sealed[-16:]
	return ".".join((protected, b64url(encrypted_key), b64url(iv), b64url(ciphertext), b64url(tag)))


def decrypt(token: str, private_key) -> bytes:
	"""Inverse of encrypt (used by tests and a local mock server)."""
	protected, ek, iv, ct, tag = token.split(".")
	cek = private_key.decrypt(
		b64url_decode(ek), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
	)
	return AESGCM(cek).decrypt(b64url_decode(iv), b64url_decode(ct) + b64url_decode(tag), protected.encode("ascii"))


def verify(token: str) -> tuple[dict, bytes]:
	"""Verify an RS256 JWS against its own x5c certificate. Returns (header, payload)."""
	h64, p64, s64 = token.split(".")
	header = json.loads(b64url_decode(h64))
	cert = x509.load_der_x509_certificate(base64.b64decode(header["x5c"][0]))
	cert.public_key().verify(b64url_decode(s64), f"{h64}.{p64}".encode("ascii"), padding.PKCS1v15(), hashes.SHA256())
	return header, b64url_decode(p64)
