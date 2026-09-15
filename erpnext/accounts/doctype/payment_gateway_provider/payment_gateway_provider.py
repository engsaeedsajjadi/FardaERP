# Copyright (c) 2025, FardaERP Team
# License: GNU General Public License v3. See license.txt

"""
FardaERP - Iranian Payment Gateway Integration

Supports multiple Iranian payment gateways:
- ZarinPal
- IDPay
- NextPay
- Pay.ir
- Direct Bank Gateway

Architecture:
Payment Gateway Interface
        ↓
Gateway Adapter
        ↓
Provider
"""

import frappe
from frappe import _
from frappe.model.document import Document
from typing import Optional, Dict, Any


class PaymentGatewayProvider(Document):
	"""
	Payment Gateway Provider for Iranian Gateways
	
	This DocType allows configuration of multiple payment gateways
	and provides a unified interface for payment processing.
	"""
	
	def validate(self):
		"""Validate gateway configuration"""
		self.validate_credentials()
		self.validate_gateway_type()
	
	def validate_credentials(self):
		"""Ensure required credentials are provided"""
		required_fields = {
			'ZarinPal': ['merchant_id'],
			'IDPay': ['api_key', 'sandbox'],
			'NextPay': ['api_key'],
			'Pay.ir': ['api_key'],
			'Bank': ['terminal_id', 'username', 'password']
		}
		
		gateway_type = self.gateway_type
		if gateway_type in required_fields:
			for field in required_fields[gateway_type]:
				if not self.get(field):
					frappe.throw(_(f"Field '{field}' is required for {gateway_type} gateway"))
	
	def validate_gateway_type(self):
		"""Validate gateway type selection"""
		allowed_types = ['ZarinPal', 'IDPay', 'NextPay', 'Pay.ir', 'Bank']
		if self.gateway_type not in allowed_types:
			frappe.throw(_("Invalid gateway type. Allowed types: {0}").format(', '.join(allowed_types)))
	
	def on_update(self):
		"""Clear cache on update"""
		frappe.clear_cache()


def get_gateway_provider(gateway_name: str) -> Optional[Document]:
	"""
	Get payment gateway provider by name
	
	Args:
		gateway_name: Name of the gateway provider
		
	Returns:
		Document or None
	"""
	return frappe.get_doc('Payment Gateway Provider', gateway_name)


def process_payment(
	gateway_name: str,
	amount: float,
	currency: str = 'IRT',
	order_id: str = None,
	description: str = '',
	callback_url: str = None,
	customer_data: Dict[str, Any] = None
) -> Dict[str, Any]:
	"""
	Process payment through specified gateway
	
	Args:
		gateway_name: Name of the gateway provider
		amount: Payment amount
		currency: Currency code (default: IRT for Toman)
		order_id: Order/invoice reference ID
		description: Payment description
		callback_url: URL to redirect after payment
		customer_data: Customer information (mobile, email, etc.)
		
	Returns:
		Dictionary with payment URL and transaction ID
	"""
	provider = get_gateway_provider(gateway_name)
	
	if not provider:
		frappe.throw(_("Payment gateway '{0}' not found").format(gateway_name))
	
	# Convert currency if needed
	if currency == 'IRT':
		# Amount is already in Toman
		pass
	elif currency == 'IRR':
		# Convert Rial to Toman
		amount = amount / 10
	else:
		frappe.throw(_("Unsupported currency: {0}").format(currency))
	
	# Route to appropriate gateway handler
	if provider.gateway_type == 'ZarinPal':
		return _process_zarinpal(provider, amount, order_id, description, callback_url, customer_data)
	elif provider.gateway_type == 'IDPay':
		return _process_idpay(provider, amount, order_id, description, callback_url, customer_data)
	elif provider.gateway_type == 'NextPay':
		return _process_nextpay(provider, amount, order_id, description, callback_url, customer_data)
	elif provider.gateway_type == 'Pay.ir':
		return _process_payir(provider, amount, order_id, description, callback_url, customer_data)
	elif provider.gateway_type == 'Bank':
		return _process_bank_gateway(provider, amount, order_id, description, callback_url, customer_data)
	else:
		frappe.throw(_("Unsupported gateway type: {0}").format(provider.gateway_type))


def _process_zarinpal(provider, amount, order_id, description, callback_url, customer_data):
	"""Process payment through ZarinPal"""
	import requests
	
	merchant_id = provider.merchant_id
	sandbox = provider.sandbox or 0
	
	api_url = "https://sandbox.zarinpal.com/pg/v4/payment/request.json" if sandbox else "https://api.zarinpal.com/pg/v4/payment/request.json"
	
	payload = {
		"merchant_id": merchant_id,
		"amount": int(amount),
		"currency": "IRT",
		"callback_url": callback_url or frappe.utils.get_url("/api/method/fardaerp.payment.verify"),
		"description": description,
		"metadata": {
			"mobile": customer_data.get("mobile") if customer_data else "",
			"email": customer_data.get("email") if customer_data else ""
		}
	}
	
	response = requests.post(api_url, json=payload, timeout=30)
	result = response.json()
	
	if result.get('status') == 100:
		authority = result['data']['authority']
		payment_url = f"https://sandbox.zarinpal.com/pg/StartPay/{authority}" if sandbox else f"https://www.zarinpal.com/pg/StartPay/{authority}"
		
		return {
			"success": True,
			"transaction_id": authority,
			"payment_url": payment_url,
			"gateway": "ZarinPal"
		}
	else:
		frappe.throw(_("ZarinPal Error: {0}").format(result.get('errors', {}).get('message', 'Unknown error')))


def _process_idpay(provider, amount, order_id, description, callback_url, customer_data):
	"""Process payment through IDPay"""
	import requests
	
	api_key = provider.api_key
	sandbox = provider.sandbox or 0
	
	api_url = "https://api.idpay.ir/v1.1/payment"
	
	headers = {
		'X-API-Key': api_key,
		'X-Sandbox': str(sandbox),
		'Content-Type': 'application/json'
	}
	
	payload = {
		"order_id": order_id,
		"amount": int(amount),
		"callback": callback_url or frappe.utils.get_url("/api/method/fardaerp.payment.verify"),
		"desc": description,
		"payer": {
			"name": customer_data.get("name") if customer_data else "",
			"phone": customer_data.get("mobile") if customer_data else "",
			"mail": customer_data.get("email") if customer_data else ""
		}
	}
	
	response = requests.post(api_url, json=payload, headers=headers, timeout=30)
	result = response.json()
	
	if 'id' in result:
		return {
			"success": True,
			"transaction_id": result['id'],
			"payment_url": result['link'],
			"gateway": "IDPay"
		}
	else:
		frappe.throw(_("IDPay Error: {0}").format(result.get('error_message', 'Unknown error')))


def _process_nextpay(provider, amount, order_id, description, callback_url, customer_data):
	"""Process payment through NextPay"""
	import requests
	
	api_key = provider.api_key
	
	api_url = "https://api.nextpay.org/gateway/token"
	
	payload = {
		"api_key": api_key,
		"amount": int(amount),
		"callback_uri": callback_url or frappe.utils.get_url("/api/method/fardaerp.payment.verify"),
		"order_id": order_id,
		"payer_phone": customer_data.get("mobile") if customer_data else ""
	}
	
	response = requests.post(api_url, data=payload, timeout=30)
	result = response.json()
	
	if result.get('code') == -1:
		trans_id = result['trans_id']
		payment_url = f"https://api.nextpay.org/gateway/pay/{trans_id}"
		
		return {
			"success": True,
			"transaction_id": trans_id,
			"payment_url": payment_url,
			"gateway": "NextPay"
		}
	else:
		frappe.throw(_("NextPay Error: {0}").format(result.get('message', 'Unknown error')))


def _process_payir(provider, amount, order_id, description, callback_url, customer_data):
	"""Process payment through Pay.ir"""
	import requests
	
	api_key = provider.api_key
	
	api_url = "https://pay.ir/pg/send"
	
	payload = {
		"api": api_key,
		"amount": int(amount),
		"redirect": callback_url or frappe.utils.get_url("/api/method/fardaerp.payment.verify"),
		"factorNumber": order_id,
		"mobile": customer_data.get("mobile") if customer_data else "",
		"email": customer_data.get("email") if customer_data else ""
	}
	
	response = requests.post(api_url, data=payload, timeout=30)
	result = response.json()
	
	if result.get('status') == 1:
		token = result['token']
		payment_url = f"https://pay.ir/pg/{token}"
		
		return {
			"success": True,
			"transaction_id": token,
			"payment_url": payment_url,
			"gateway": "Pay.ir"
		}
	else:
		frappe.throw(_("Pay.ir Error: {0}").format(result.get('errorMessage', 'Unknown error')))


def _process_bank_gateway(provider, amount, order_id, description, callback_url, customer_data):
	"""Process payment through direct bank gateway"""
	# Implementation depends on specific bank API
	# This is a placeholder for bank-specific implementation
	frappe.throw(_("Direct bank gateway not implemented yet. Please configure a third-party gateway."))


def verify_payment(gateway_name: str, transaction_id: str, reference_id: str = None) -> Dict[str, Any]:
	"""
	Verify payment completion
	
	Args:
		gateway_name: Name of the gateway provider
		transaction_id: Transaction ID from gateway
		reference_id: Optional reference ID
		
	Returns:
		Dictionary with verification status and details
	"""
	provider = get_gateway_provider(gateway_name)
	
	if not provider:
		return {"success": False, "message": _("Gateway not found")}
	
	# Route to appropriate verification handler
	if provider.gateway_type == 'ZarinPal':
		return _verify_zarinpal(provider, transaction_id)
	elif provider.gateway_type == 'IDPay':
		return _verify_idpay(provider, transaction_id)
	# Add other gateways as needed
	
	return {"success": False, "message": _("Verification not implemented for this gateway")}


def _verify_zarinpal(provider, authority: str) -> Dict[str, Any]:
	"""Verify ZarinPal payment"""
	import requests
	
	merchant_id = provider.merchant_id
	sandbox = provider.sandbox or 0
	
	api_url = "https://sandbox.zarinpal.com/pg/v4/payment/verify.json" if sandbox else "https://api.zarinpal.com/pg/v4/payment/verify.json"
	
	payload = {
		"merchant_id": merchant_id,
		"authority": authority
	}
	
	response = requests.post(api_url, json=payload, timeout=30)
	result = response.json()
	
	if result.get('status') == 100:
		return {
			"success": True,
			"amount": result['data']['amount'],
			"reference_id": result['data'].get('ref_id'),
			"gateway": "ZarinPal"
		}
	else:
		return {
			"success": False,
			"message": result.get('errors', {}).get('message', 'Verification failed')
		}


def _verify_idpay(provider, transaction_id: str) -> Dict[str, Any]:
	"""Verify IDPay payment"""
	import requests
	
	api_key = provider.api_key
	sandbox = provider.sandbox or 0
	
	api_url = f"https://api.idpay.ir/v1.1/payment/verify"
	
	headers = {
		'X-API-Key': api_key,
		'X-Sandbox': str(sandbox),
		'Content-Type': 'application/json'
	}
	
	payload = {
		"id": transaction_id
	}
	
	response = requests.post(api_url, json=payload, headers=headers, timeout=30)
	result = response.json()
	
	if 'status' in result and result['status'] in [100, 101]:
		return {
			"success": True,
			"amount": result['amount'],
			"reference_id": result.get('track_id'),
			"gateway": "IDPay"
		}
	else:
		return {
			"success": False,
			"message": result.get('error_message', 'Verification failed')
		}
