"""Moadian connection settings — read ONLY from environment variables.

Secrets never live in the database, the repository or logs:
  FARDA_MOADIAN_MEMORY_ID            شناسه یکتای حافظه مالیاتی (6 chars)
  FARDA_MOADIAN_PRIVATE_KEY_PATH     path to the RSA private key (PEM), mode 600
  FARDA_MOADIAN_PRIVATE_KEY_PASSWORD optional, for an encrypted key
  FARDA_MOADIAN_CERT_PATH            path to the issued certificate (PEM, not a CSR)
  FARDA_MOADIAN_TARGET               sandbox (default) | live
  FARDA_MOADIAN_SANDBOX_BASE_URL     sandbox API base (default below — confirm it)
  FARDA_MOADIAN_LIVE_BASE_URL        live API base (default: official v2 URL)
  FARDA_MOADIAN_ALLOW_LIVE           must be "1" before anything reaches the live system
"""

from __future__ import annotations

import os
from dataclasses import dataclass

LIVE_BASE_URL = "https://tp.tax.gov.ir/requestsmanager/api/v2/"
# Not published in RC_TICS.IS; host seen in public sandbox logs. Confirm with your
# trusted company / کارپوشه and override with FARDA_MOADIAN_SANDBOX_BASE_URL.
SANDBOX_BASE_URL = "https://sandboxrc.tax.gov.ir/requestsmanager/api/v2/"

TARGET_LABELS = {"sandbox": "محیط آزمایشی (سندباکس)", "live": "سامانه اصلی مودیان"}


@dataclass(frozen=True)
class MoadianConfig:
	memory_id: str
	private_key_path: str
	cert_path: str
	key_password: str | None
	target: str
	base_url: str
	allow_live: bool

	@property
	def target_label(self) -> str:
		return TARGET_LABELS.get(self.target, self.target)

	def problems(self) -> list[str]:
		out = []
		if not self.memory_id:
			out.append("FARDA_MOADIAN_MEMORY_ID (شناسه یکتای حافظه مالیاتی) تنظیم نشده است")
		elif len(self.memory_id) != 6:
			out.append("شناسه یکتای حافظه مالیاتی باید ۶ کاراکتر باشد")
		for label, path in (("کلید خصوصی", self.private_key_path), ("گواهی", self.cert_path)):
			if not path:
				out.append(f"مسیر فایل {label} تنظیم نشده است")
			elif not os.path.isfile(path):
				out.append(f"فایل {label} در مسیر تنظیم‌شده پیدا نشد")
		if self.target not in TARGET_LABELS:
			out.append("FARDA_MOADIAN_TARGET باید sandbox یا live باشد")
		if self.target == "live" and not self.allow_live:
			out.append("ارسال به سامانه اصلی قفل است (FARDA_MOADIAN_ALLOW_LIVE=1 تنظیم نشده)")
		if not self.base_url.startswith("https://"):
			out.append("آدرس سامانه باید با https شروع شود")
		return out

	def public_view(self) -> dict:
		"""Safe to show in the UI: no key material, memory id masked."""
		mid = self.memory_id
		return {
			"target": self.target,
			"target_label": self.target_label,
			"base_url": self.base_url,
			"memory_id": (mid[:2] + "••" + mid[-2:]) if len(mid) == 6 else ("—" if not mid else "نامعتبر"),
			"private_key": bool(self.private_key_path and os.path.isfile(self.private_key_path)),
			"certificate": bool(self.cert_path and os.path.isfile(self.cert_path)),
			"allow_live": self.allow_live,
			"problems": self.problems(),
		}


def load(env: dict | None = None) -> MoadianConfig:
	env = os.environ if env is None else env
	target = (env.get("FARDA_MOADIAN_TARGET") or "sandbox").strip().lower()
	if target == "live":
		base = env.get("FARDA_MOADIAN_LIVE_BASE_URL") or LIVE_BASE_URL
	else:
		base = env.get("FARDA_MOADIAN_SANDBOX_BASE_URL") or SANDBOX_BASE_URL
	return MoadianConfig(
		memory_id=(env.get("FARDA_MOADIAN_MEMORY_ID") or "").strip().upper(),
		private_key_path=(env.get("FARDA_MOADIAN_PRIVATE_KEY_PATH") or "").strip(),
		cert_path=(env.get("FARDA_MOADIAN_CERT_PATH") or "").strip(),
		key_password=env.get("FARDA_MOADIAN_PRIVATE_KEY_PASSWORD") or None,
		target=target,
		base_url=base.rstrip("/") + "/",
		allow_live=(env.get("FARDA_MOADIAN_ALLOW_LIVE") or "").strip() == "1",
	)
