# FardaERP - Change Log

## Version 1.0.0 (2025)

### Added

#### Iranian Localization
- ✅ Complete RTL support for Persian interface
- ✅ Jalali (Persian) date picker with automatic conversion
- ✅ Toman/Rial currency formatting
- ✅ Persian number display
- ✅ Iranian invoice print format
- ✅ Validation for Iranian National Code, Mobile, IBAN, Economic Code

#### Payment Gateways
- ✅ ZarinPal integration
- ✅ IDPay integration
- ✅ NextPay integration
- ✅ Pay.ir integration
- ✅ Direct bank gateway framework

#### SMS Providers
- ✅ Kavenegar integration
- ✅ Melipayamak integration
- ✅ FarazSMS integration
- ✅ SMS.ir integration
- ✅ Ghasedak integration
- ✅ OTP support

#### Docker Deployment
- ✅ Complete Docker Compose configuration
- ✅ Multi-container setup (DB, Redis, Backend, Frontend, Workers)
- ✅ Nginx reverse proxy configuration
- ✅ Environment variables management
- ✅ Health checks and auto-restart

#### Documentation
- ✅ Persian installation guide (INSTALLATION.fa.md)
- ✅ English README
- ✅ Iran localization documentation
- ✅ API documentation for payment and SMS

### Technical Details

#### Files Created
- `/erpnext/public/scss/farda-rtl.scss` - RTL styling
- `/erpnext/public/js/iran/jalali_date_picker.js` - Date conversion
- `/erpnext/regional/print_format/iranian_invoice/` - Invoice template
- `/erpnext/accounts/doctype/payment_gateway_provider/` - Payment module
- `/erpnext/telephony/doctype/sms_provider/` - SMS module
- `/docker-compose.yml` - Container orchestration
- `/nginx/nginx.conf` - Web server config
- `/.env.example` - Environment template
- `/INSTALLATION.fa.md` - Persian docs

#### Modified Files
- `/erpnext/hooks.py` - Added Iranian hooks
- `/erpnext/regional/iran/utils.py` - Enhanced utilities

### Browser Support
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### System Requirements
- Docker 20.10+
- Docker Compose 2.0+
- 4GB RAM minimum
- 20GB storage

---

## License
GNU General Public License v3
