"""FardaERP SMS provider architecture (see provider.py)."""

from .provider import (
	ConsoleProvider,
	GhasedakProvider,
	KavenegarProvider,
	MelipayamakProvider,
	SendResult,
	SMSProvider,
	available,
	normalize_ir_mobile,
	register,
	resolve,
)

__all__ = [
	"ConsoleProvider",
	"GhasedakProvider",
	"KavenegarProvider",
	"MelipayamakProvider",
	"SendResult",
	"SMSProvider",
	"available",
	"normalize_ir_mobile",
	"register",
	"resolve",
]
