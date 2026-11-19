"""FardaERP — return page for Iranian payment gateways (ZarinPal / IDPay / NextPay).

The gateway redirects the customer here after payment. We read the gateway's
transaction id from the request, run the policy-guarded verification
(erpnext.farda_iran.payments.api.verify_payment) and show the result in Persian.
"""

import frappe
from frappe import _

no_cache = 1

# where each gateway puts its transaction id / status in the return request
_AUTHORITY_PARAM = {"zarinpal": "Authority", "idpay": "id", "nextpay": "trans_id"}


def get_context(context):
	form = frappe.form_dict
	gateway = (form.get("gateway") or "").lower()
	authority = form.get(_AUTHORITY_PARAM.get(gateway, "")) if gateway in _AUTHORITY_PARAM else None

	context.no_breadcrumbs = True
	context.title = _("نتیجهٔ پرداخت")
	context.ok = False
	context.message = _("اطلاعات بازگشت از درگاه ناقص است.")
	context.authority = authority
	context.reference = None

	if not authority:
		return context

	# ZarinPal reports a cancelled/failed payment with Status=NOK — nothing to verify
	if gateway == "zarinpal" and (form.get("Status") or "").upper() != "OK":
		context.message = _("پرداخت لغو شد یا ناموفق بود. مبلغی از حساب شما کسر نشده است.")
		_mark_failed(authority, "cancelled at gateway (Status=NOK)")
		return context

	from erpnext.farda_iran.payments.api import verify_payment

	try:
		result = verify_payment(gateway=gateway, authority=authority)
	except Exception:
		frappe.db.rollback()
		frappe.log_error("farda_iran: payment callback verification failed")
		context.message = _(
			"تأیید پرداخت با خطا مواجه شد. اگر مبلغی کسر شده، ظرف ۷۲ ساعت به حساب شما بازمی‌گردد "
			"یا با پشتیبانی تماس بگیرید."
		)
		return context

	# GET requests are not auto-committed by Frappe; the verification must persist
	frappe.db.commit()

	decision = result.get("decision")
	context.ok = decision in ("accept", "already_settled") or bool(result.get("already"))
	context.message = (
		_("پرداخت با موفقیت انجام و ثبت شد.")
		if context.ok
		else _("پرداخت تأیید نشد. اگر مبلغی کسر شده، ظرف ۷۲ ساعت به حساب شما بازمی‌گردد.")
	)
	row = frappe.db.get_value(
		"Farda Payment Log", {"authority": authority}, ["reference_doctype", "reference_name"], as_dict=True
	)
	if row and row.reference_name:
		context.reference = row.reference_name
	return context


def _mark_failed(authority: str, reason: str) -> None:
	from erpnext.farda_iran.payments.persistence import FrappePaymentStore

	store = FrappePaymentStore()
	row = store.get_by_authority(authority)
	if row and row.get("status") == "Initialized":
		store.mark_failed(authority, reason)
		frappe.db.commit()
