"""FardaERP VAT service (see service.py)."""

from .service import get_applicable_vat_rate, get_settings, on_invoice_validate

__all__ = ["get_applicable_vat_rate", "get_settings", "on_invoice_validate"]
