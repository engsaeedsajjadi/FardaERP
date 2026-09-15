# Copyright (c) 2025, FardaERP Team
# License: GNU General Public License v3. See license.txt

"""
FardaERP - Iranian SMS Provider Integration

Supports multiple Iranian SMS providers:
- Kavenegar
- Melipayamak
- FarazSMS
- SMS.ir
- Ghasedak

Architecture:
SMS Provider Interface
        ↓
Provider Adapter
        ↓
SMS Gateway
"""

import frappe
from frappe import _
from frappe.model.document import Document
from typing import Optional, Dict, Any, List
import requests


class SMSProvider(Document):
	"""
	SMS Provider for Iranian SMS Services
	
	This DocType allows configuration of multiple SMS providers
	and provides a unified interface for sending SMS messages.
	"""
	
	def validate(self):
		"""Validate provider configuration"""
		self.validate_credentials()
		self.validate_provider_type()
	
	def validate_credentials(self):
		"""Ensure required credentials are provided"""
		required_fields = {
			'Kavenegar': ['api_key'],
			'Melipayamak': ['username', 'password'],
			'FarazSMS': ['api_key'],
			'SMS.ir': ['api_key'],
			'Ghasedak': ['api_key']
		}
		
		provider_type = self.provider_type
		if provider_type in required_fields:
			for field in required_fields[provider_type]:
				if not self.get(field):
					frappe.throw(_(f"Field '{field}' is required for {provider_type} provider"))
	
	def validate_provider_type(self):
		"""Validate provider type selection"""
		allowed_types = ['Kavenegar', 'Melipayamak', 'FarazSMS', 'SMS.ir', 'Ghasedak']
		if self.provider_type not in allowed_types:
			frappe.throw(_("Invalid provider type. Allowed types: {0}").format(', '.join(allowed_types)))
	
	def on_update(self):
		"""Clear cache on update"""
		frappe.clear_cache()


def get_sms_provider(provider_name: str) -> Optional[Document]:
	"""
	Get SMS provider by name
	
	Args:
		provider_name: Name of the SMS provider
		
	Returns:
		Document or None
	"""
	return frappe.get_doc('SMS Provider', provider_name)


def send_sms(
	provider_name: str,
	recipients: List[str],
	message: str,
	sender_id: str = None,
	is_promotional: bool = False
) -> Dict[str, Any]:
	"""
	Send SMS through specified provider
	
	Args:
		provider_name: Name of the SMS provider
		recipients: List of phone numbers
		message: SMS message content
		sender_id: Sender ID/Line number
		is_promotional: Whether this is a promotional message
		
	Returns:
		Dictionary with sending status and details
	"""
	provider = get_sms_provider(provider_name)
	
	if not provider:
		frappe.throw(_("SMS provider '{0}' not found").format(provider_name))
	
	# Validate Iranian phone numbers
	validated_recipients = []
	for phone in recipients:
		if validate_iranian_mobile(phone):
			validated_recipients.append(phone)
		else:
			frappe.msgprint(_("Invalid phone number: {0}").format(phone))
	
	if not validated_recipients:
		frappe.throw(_("No valid phone numbers provided"))
	
	# Route to appropriate provider handler
	if provider.provider_type == 'Kavenegar':
		return _send_kavenegar(provider, validated_recipients, message, sender_id)
	elif provider.provider_type == 'Melipayamak':
		return _send_melipayamak(provider, validated_recipients, message, sender_id, is_promotional)
	elif provider.provider_type == 'FarazSMS':
		return _send_farazsms(provider, validated_recipients, message, sender_id)
	elif provider.provider_type == 'SMS.ir':
		return _send_smsir(provider, validated_recipients, message, sender_id)
	elif provider.provider_type == 'Ghasedak':
		return _send_ghasedak(provider, validated_recipients, message, sender_id)
	else:
		frappe.throw(_("Unsupported provider type: {0}").format(provider.provider_type))


def validate_iranian_mobile(phone: str) -> bool:
	"""
	Validate Iranian mobile phone number
	
	Args:
		phone: Phone number to validate
		
	Returns:
		True if valid, False otherwise
	"""
	import re
	
	# Remove spaces and dashes
	phone = re.sub(r'[\s-]', '', phone)
	
	# Check pattern: 09xxxxxxxxx or +989xxxxxxxxx
	pattern = r'^(?:\+98|0)?9[0-9]{9}$'
	
	if not re.match(pattern, phone):
		return False
	
	return True


def normalize_iranian_mobile(phone: str) -> str:
	"""
	Normalize Iranian mobile phone number to standard format
	
	Args:
		phone: Phone number to normalize
		
	Returns:
		Normalized phone number (09xxxxxxxxx format)
	"""
	import re
	
	# Remove spaces and dashes
	phone = re.sub(r'[\s-]', '', phone)
	
	# Convert +98 to 0
	if phone.startswith('+98'):
		phone = '0' + phone[3:]
	
	return phone


def _send_kavenegar(provider, recipients: List[str], message: str, sender_id: str = None) -> Dict[str, Any]:
	"""Send SMS through Kavenegar"""
	
	api_key = provider.api_key
	api_url = "https://api.kavenegar.com/v1/{0}/sms/send.json".format(api_key)
	
	# Kavenegar accepts multiple recipients
	data = {
		'message': message,
		'receptor': ','.join(recipients)
	}
	
	if sender_id:
		data['sender'] = sender_id
	
	try:
		response = requests.post(api_url, data=data, timeout=30)
		result = response.json()
		
		if result.get('return', {}).get('status') == 200:
			return {
				"success": True,
				"message_id": result['entries'][0].get('messageid'),
				"provider": "Kavenegar",
				"recipients_count": len(recipients)
			}
		else:
			return {
				"success": False,
				"message": result.get('return', {}).get('message', 'Unknown error'),
				"provider": "Kavenegar"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "Kavenegar"
		}


def _send_melipayamak(provider, recipients: List[str], message: str, sender_id: str = None, is_promotional: bool = False) -> Dict[str, Any]:
	"""Send SMS through Melipayamak"""
	
	username = provider.username
	password = provider.password
	
	# Use promotional or normal line based on message type
	if is_promotional:
		api_url = "https://api.payamak-panel.com/post/Send.asmx?wsdl"
	else:
		api_url = "https://api.payamak-panel.com/post/Send.asmx?wsdl"
	
	# For SOAP API, we need to use a different approach
	# This is a simplified REST version
	rest_url = "https://rest.payamak-panel.com/v1/SendSMS/SendSMS"
	
	data = {
		'username': username,
		'password': password,
		'to': recipients[0],  # Send individually
		'from': sender_id or provider.default_sender,
		'text': message,
		'isFlash': False
	}
	
	try:
		response = requests.post(rest_url, json=data, timeout=30)
		result = response.json()
		
		if result.get('Status') == 200:
			return {
				"success": True,
				"message_id": result.get('MessageId'),
				"provider": "Melipayamak",
				"recipients_count": len(recipients)
			}
		else:
			return {
				"success": False,
				"message": result.get('Description', 'Unknown error'),
				"provider": "Melipayamak"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "Melipayamak"
		}


def _send_farazsms(provider, recipients: List[str], message: str, sender_id: str = None) -> Dict[str, Any]:
	"""Send SMS through FarazSMS"""
	
	api_key = provider.api_key
	api_url = "https://api.farazsms.com/api/v1/send"
	
	headers = {
		'Authorization': f'Bearer {api_key}',
		'Content-Type': 'application/json'
	}
	
	data = {
		'senders': [sender_id or provider.default_sender],
		'recipients': recipients,
		'message': message
	}
	
	try:
		response = requests.post(api_url, json=data, headers=headers, timeout=30)
		result = response.json()
		
		if result.get('status') == 'success':
			return {
				"success": True,
				"message_id": result.get('message_id'),
				"provider": "FarazSMS",
				"recipients_count": len(recipients)
			}
		else:
			return {
				"success": False,
				"message": result.get('message', 'Unknown error'),
				"provider": "FarazSMS"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "FarazSMS"
		}


def _send_smsir(provider, recipients: List[str], message: str, sender_id: str = None) -> Dict[str, Any]:
	"""Send SMS through SMS.ir"""
	
	api_key = provider.api_key
	api_url = "https://api.sms.ir/v1/send/bulk"
	
	headers = {
		'X-API-KEY': api_key,
		'Content-Type': 'application/json',
		'Accept': 'application/json'
	}
	
	data = {
		'lineNumber': sender_id or provider.default_sender,
		'messageText': message,
		'mobiles': recipients
	}
	
	try:
		response = requests.post(api_url, json=data, headers=headers, timeout=30)
		result = response.json()
		
		if result.get('status') == 'Success':
			return {
				"success": True,
				"message_id": result.get('bulkId'),
				"provider": "SMS.ir",
				"recipients_count": len(recipients)
			}
		else:
			return {
				"success": False,
				"message": result.get('message', 'Unknown error'),
				"provider": "SMS.ir"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "SMS.ir"
		}


def _send_ghasedak(provider, recipients: List[str], message: str, sender_id: str = None) -> Dict[str, Any]:
	"""Send SMS through Ghasedak"""
	
	api_key = provider.api_key
	api_url = "https://api.ghasedak.me/v2/sms/send/simple"
	
	headers = {
		'apikey': api_key,
		'Content-Type': 'application/x-www-form-urlencoded'
	}
	
	data = {
		'message': message,
		'receptor': ','.join(recipients),
		'sender': sender_id or provider.default_sender
	}
	
	try:
		response = requests.post(api_url, data=data, headers=headers, timeout=30)
		result = response.json()
		
		if result.get('status') == 200:
			return {
				"success": True,
				"message_id": result.get('messageid'),
				"provider": "Ghasedak",
				"recipients_count": len(recipients)
			}
		else:
			return {
				"success": False,
				"message": result.get('message', 'Unknown error'),
				"provider": "Ghasedak"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "Ghasedak"
		}


def send_otp(provider_name: str, recipient: str, code: str, template: str = None) -> Dict[str, Any]:
	"""
	Send OTP (One-Time Password) SMS
	
	Args:
		provider_name: Name of the SMS provider
		recipient: Phone number
		code: OTP code
		template: Template name (if using template-based OTP)
		
	Returns:
		Dictionary with sending status
	"""
	provider = get_sms_provider(provider_name)
	
	if not provider:
		return {"success": False, "message": _("Provider not found")}
	
	# Normalize phone number
	recipient = normalize_iranian_mobile(recipient)
	
	# Default OTP message
	if not template:
		message = f"کد تأیید شما:\n{code}\n\nاین کد را به کسی ندهید."
	else:
		# Use template-based OTP (provider-specific)
		if provider.provider_type == 'Kavenegar':
			return _send_kavenegar_otp(provider, recipient, code, template)
		elif provider.provider_type == 'SMS.ir':
			return _send_smsir_otp(provider, recipient, code, template)
	
	return send_sms(provider_name, [recipient], message)


def _send_kavenegar_otp(provider, recipient: str, code: str, template: str) -> Dict[str, Any]:
	"""Send OTP through Kavenegar using template"""
	
	api_key = provider.api_key
	api_url = "https://api.kavenegar.com/v1/{0}/verify/lookup.json".format(api_key)
	
	data = {
		'receptor': recipient,
		'token': code,
		'template': template
	}
	
	try:
		response = requests.post(api_url, data=data, timeout=30)
		result = response.json()
		
		if result.get('return', {}).get('status') == 200:
			return {
				"success": True,
				"message_id": result['entries'][0].get('messageid'),
				"provider": "Kavenegar"
			}
		else:
			return {
				"success": False,
				"message": result.get('return', {}).get('message', 'Unknown error'),
				"provider": "Kavenegar"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "Kavenegar"
		}


def _send_smsir_otp(provider, recipient: str, code: str, template: str) -> Dict[str, Any]:
	"""Send OTP through SMS.ir using template"""
	
	api_key = provider.api_key
	api_url = "https://api.sms.ir/v1/send/verify"
	
	headers = {
		'X-API-KEY': api_key,
		'Content-Type': 'application/json',
		'Accept': 'application/json'
	}
	
	data = {
		'mobile': recipient,
		'templateId': template,
		'parameters': [
			{'name': 'Code', 'value': code}
		]
	}
	
	try:
		response = requests.post(api_url, json=data, headers=headers, timeout=30)
		result = response.json()
		
		if result.get('status') == 'Success':
			return {
				"success": True,
				"message_id": result.get('messageId'),
				"provider": "SMS.ir"
			}
		else:
			return {
				"success": False,
				"message": result.get('message', 'Unknown error'),
				"provider": "SMS.ir"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "SMS.ir"
		}


def get_balance(provider_name: str) -> Dict[str, Any]:
	"""
	Get SMS credit balance
	
	Args:
		provider_name: Name of the SMS provider
		
	Returns:
		Dictionary with balance information
	"""
	provider = get_sms_provider(provider_name)
	
	if not provider:
		return {"success": False, "message": _("Provider not found")}
	
	if provider.provider_type == 'Kavenegar':
		return _get_kavenegar_balance(provider)
	elif provider.provider_type == 'SMS.ir':
		return _get_smsir_balance(provider)
	# Add other providers as needed
	
	return {"success": False, "message": _("Balance check not implemented for this provider")}


def _get_kavenegar_balance(provider) -> Dict[str, Any]:
	"""Get Kavenegar account balance"""
	
	api_key = provider.api_key
	api_url = "https://api.kavenegar.com/v1/{0}/account/credit.json".format(api_key)
	
	try:
		response = requests.get(api_url, timeout=30)
		result = response.json()
		
		if result.get('return', {}).get('status') == 200:
			return {
				"success": True,
				"balance": result['entries'][0].get('credit'),
				"currency": "Rial",
				"provider": "Kavenegar"
			}
		else:
			return {
				"success": False,
				"message": result.get('return', {}).get('message', 'Unknown error'),
				"provider": "Kavenegar"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "Kavenegar"
		}


def _get_smsir_balance(provider) -> Dict[str, Any]:
	"""Get SMS.ir account balance"""
	
	api_key = provider.api_key
	api_url = "https://api.sms.ir/v1/credit"
	
	headers = {
		'X-API-KEY': api_key,
		'Accept': 'application/json'
	}
	
	try:
		response = requests.get(api_url, headers=headers, timeout=30)
		result = response.json()
		
		if result.get('status') == 'Success':
			return {
				"success": True,
				"balance": result.get('credit'),
				"currency": "Rial",
				"provider": "SMS.ir"
			}
		else:
			return {
				"success": False,
				"message": result.get('message', 'Unknown error'),
				"provider": "SMS.ir"
			}
	except Exception as e:
		return {
			"success": False,
			"message": str(e),
			"provider": "SMS.ir"
		}
