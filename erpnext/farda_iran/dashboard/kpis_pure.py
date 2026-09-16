"""FardaERP real-data dashboards (§18).

Pure payload builder here; frappe queries + whitelisted endpoint live in
`kpis.py`. The builder only converts raw IRR figures through the CENTRAL
currency service — never its own arithmetic on the ratio.
"""

from __future__ import annotations

from typing import Any

KPI_LABELS_FA = {
	"sales": "فروش",
	"purchases": "خرید",
	"profit": "سود دوره",
	"receivables": "دریافتنی",
	"payables": "پرداختنی",
	"net_ar_ap": "خالص دریافتنی",
	"vat_sales": "مالیات فروش",
	"vat_purchases": "مالیات خرید",
	"vat_net": "مالیات قابل پرداخت",
	"cash_balance": "مانده نقد و بانک",
	"inventory_value": "ارزش موجودی",
	"orders": "سفارش‌های باز",
}


def build_kpi_payload(raw: dict[str, Any]) -> dict[str, Any]:
	"""Raw IRR figures → structured KPI payload with Persian Toman strings.

	`raw` values are floats/ints in IRR (or None). Derived KPIs (net_ar_ap,
	vat_net, profit) are computed here by plain addition/subtraction — ratio
	conversions happen ONLY inside the central currency service.
	"""
	try:
		from ..invoice.persian import toman_str
	except ImportError:  # pragma: no cover - path-loaded tests (farda_iran top-level)
		from farda_iran.invoice.persian import toman_str

	def num(value) -> float:
		try:
			return float(value or 0)
		except (TypeError, ValueError):
			return 0.0

	sales = num(raw.get("sales"))
	purchases = num(raw.get("purchases"))
	receivables = num(raw.get("receivables"))
	payables = num(raw.get("payables"))
	vat_sales = num(raw.get("vat_sales"))
	vat_purchases = num(raw.get("vat_purchases"))
	cash_balance = num(raw.get("cash_balance"))
	inventory_value = num(raw.get("inventory_value"))
	orders = num(raw.get("orders"))

	derived = {
		"sales": sales,
		"purchases": purchases,
		"profit": sales - purchases,
		"receivables": receivables,
		"payables": payables,
		"net_ar_ap": receivables - payables,
		"vat_sales": vat_sales,
		"vat_purchases": vat_purchases,
		"vat_net": vat_sales - vat_purchases,
		"cash_balance": cash_balance,
		"inventory_value": inventory_value,
		"orders": orders,
	}

	out: dict[str, Any] = {"currency": "Toman", "base_currency": "IRR"}
	for key, irr in derived.items():
		out[key] = {
			"label_fa": KPI_LABELS_FA[key],
			"irr": round(irr, 2),
			"toman_fa": toman_str(irr, persian_digits=True, with_unit=True),
		}
	return out
