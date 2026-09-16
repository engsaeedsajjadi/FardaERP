"""FardaERP Iranian banking utilities — the single IBAN/bank/card fold point.

- Iranian IBAN (شبا): "IR" + 2 check + 24 BBAN; the FIRST 3 BBAN digits are the
  published bank/clearing code (Satna). Registry below holds those published
  codes (extensible; banks merged into others are kept for history).
- Card numbers (16-digit) follow ISO Luhn — validated here.
Pure Python; no frappe import.
"""

from __future__ import annotations

try:
	from ..utilities.validators import is_valid_iriban, normalize_national_id
except ImportError:  # pragma: no cover - path-loaded tests (farda_iran as top-level)
	from farda_iran.utilities.validators import is_valid_iriban, normalize_national_id

__all__ = [
	"IRANIAN_BANK_CODES",
	"bank_code_from_iban",
	"bank_name_from_iban",
	"iban_bank_info",
	"is_valid_card_number",
]

# Published Iranian bank/clearing codes (Satna/شتاب). Extensible registry.
IRANIAN_BANK_CODES = {
	"011": "بانک سپه",
	"012": "بانک ملت",
	"013": "بانک کشاورزی",
	"014": "بانک مسکن",
	"015": "بانک صادرات ایران",
	"016": "بانک توسعه صادرات",
	"017": "بانک ملی ایران",
	"018": "بانک تجارت",
	"019": "بانک رفاه کارگران",
	"020": "پست بانک ایران",
	"021": "بانک توسعه تعاون",
	"051": "مؤسسه اعتباری توسعه",
	"052": "بانک قوامین",
	"053": "بانک کارآفرین",
	"054": "بانک پارسیان",
	"055": "بانک اقتصاد نوین",
	"056": "بانک سامان",
	"057": "بانک پاسارگاد",
	"058": "بانک سرمایه",
	"059": "بانک سینا",
	"060": "بانک مهر ایران",
	"061": "بانک شهر",
	"062": "بانک آینده",
	"063": "بانک انصار",
	"064": "بانک گردشگری",
	"065": "بانک حکمت ایرانیان",
	"066": "بانک ایران و ونزوئلا",
	"069": "بانک کوثر",
	"070": "بانک نور",
	"075": "بانک خاورمیانه",
	"078": "بانک ایران زمین",
}


def bank_code_from_iban(iban: str) -> str | None:
	"""3-digit published bank code from a VALID Iranian IBAN (None otherwise)."""
	iban = normalize_national_id(iban).upper()
	if not is_valid_iriban(iban):
		return None
	return iban[4:7]


def bank_name_from_iban(iban: str) -> str | None:
	code = bank_code_from_iban(iban)
	return IRANIAN_BANK_CODES.get(code) if code else None


def iban_bank_info(iban: str) -> dict:
	"""{'bank_code': '017', 'bank_name': 'بانک ملی ایران'} (name omitted when the
	code is not in the registry) — {} when the IBAN itself is invalid."""
	code = bank_code_from_iban(iban)
	if not code:
		return {}
	info = {"bank_code": code}
	name = IRANIAN_BANK_CODES.get(code)
	if name:
		info["bank_name"] = name
	return info


def _luhn_ok(digits: str) -> bool:
	total = 0
	for i, ch in enumerate(reversed(digits)):
		d = int(ch)
		if i % 2 == 1:
			d *= 2
			if d > 9:
				d -= 9
		total += d
	return total % 10 == 0


def is_valid_card_number(card: str) -> bool:
	"""16-digit payment card number, ISO Luhn checksum (Persian digits folded)."""
	card = normalize_national_id(card)
	if len(card) != 16 or not card.isdigit():
		return False
	return _luhn_ok(card)
