# FardaERP — گزارش کامل AUDIT فاز ۰ (Phase 0 — Full Repository Audit)

> تاریخ: ۲۰۲۶-۰۹-۱۵ | شاخه: `arena/01a0a51f-fardaerp` (از `main` @ `b9c7401`)
> وضعیت ریپازیتوری: یک commit واحد با پیام «Initialize FardaERP based on ERPNext» — یعنی **محصول فعلی عملاً یک ERPNext خام (develop/v17-dev) بدون هیچ تغییر برندینگ یا بومی‌سازی است.**

---

## 1) Executive Summary

این ریپازیتوری، **کپی کامل و دست‌نخورده‌ی app رسمی `erpnext`** از شاخه develop (نسخه 17.0.0-dev) است:

- هیچ برندینگ FardaERP انجام نشده (`app_name = "erpnext"`, `app_title = "ERPNext"`, لوگوها و README همچنان ERPNext).
- هیچ بومی‌سازی ایران انجام نشده: **NOT FOUND** برای تقویم شمسی (جستجوی `jalali|shamsi|hijri` = صفر نتیجه)، درگاه پرداخت ایرانی، SMS ایرانی، فیلدهای شناسه ملی/کد اقتصادی، چک ایرانی، و ساختار حسابداری کل/معین/تفصیلی.
- تنها ردپای ایران: نرخ مالیات «Iran Tax = VAT 7%» در `country_wise_tax.json` (**قدیمی و نادرست** — نرخ فعلی ارزش افزوده ایران ۱۰٪ است؛ نیاز به تأیید BUSINESS) و تاریخ سال مالی اشتباه `06-23 → 06-22` در setup wizard (سال مالی واقعی ایران ≈ ۰۱-۰۱ تا ۱۲-۲۹ شمسی ≈ `03-21 → 03-20` میلادی).
- ترجمه فارسی `fa.po` موجود است: **۱۰,۶۸۲ رشته، ۲,۴۸۸ رشته خالی (≈۷۷٪ ترجمه‌شده)، ۰ fuzzy** — پایه خوبی است ولی «کامل» نیست.
- معماری هسته سالم و استاندارد است؛ توسعه باید از **extension pointهای رسمی** (hooks, regional_overrides, fixtures, custom fields) استفاده کند و هسته را حداقلی تغییر دهد.

---

## 2) Current Architecture

| لایه | وضعیت فعلی |
|---|---|
| Backend | Python / Frappe Framework (وابستگی خارجی، در این ریپو نیست) |
| App | `erpnext` (single-app repo، بدون bench/framesite) |
| DB | MariaDB (CI اصلی) + PostgreSQL (CI دوم) — Frappe هر دو را پشتیبانی می‌کند |
| Cache/Queue | Redis (توسط Frappe؛ در این ریپو config ندارد) |
| Frontend (Desk) | JS bundleهای esbuild داخل Frappe (Vue/JSX در فریمورک) + bundleهای خود app |
| Frontend (SPA) | `banking/` — اپ Vue/Vite مخصوص ماژول Banking (ساخته با yarn) |
| PDF | موتور PDF فریمورک (wkhtmltopdf در bench) — در این ریپو تنظیمی ندارد |
| Build System | `flit_core` (PEP 517) + `pyproject.toml` + esbuild bundles + pre-commit |
| CI | GitHub Actions — ۲۶ workflow (تست سرور MariaDB/Postgres، linters، release، docker-trigger) |

### نسخه‌ها (Version Matrix)

| مؤلفه | مقدار | منبع |
|---|---|---|
| ERPNext | `17.0.0-dev` | `erpnext/__init__.py` |
| Frappe | `>=17.0.0-dev,<18.0.0` | `pyproject.toml` [tool.bench.frappe-dependencies] |
| Python | `>=3.14` | `pyproject.toml` (requires-python) |
| Node | 24 | CI image `ghcr.io/frappe/erpnext-ci-mariadb:py3.14-node24` |
| Database | MariaDB 10.6+ / PostgreSQL | `.github/workflows/server-tests-*.yml` |
| Redis | REQUIRED توسط Frappe — نسخه: UNKNOWN — needs verification | وابستگی bench |
| Frontend build | esbuild (داخل Frappe) + Vite برای `banking/` SPA | `banking/`, `package.json` |

> ⚠️ **ریسک معماری مهم:** محصول روی **شاخه dev (v17)** و **Python 3.14** ساخته شده است. v17 هنوز release پایدار نیست و Python 3.14 بسیار جدید است. تصمیم استراتژیک لازم است (بخش ۱۹).

---

## 3) Repository Structure

```text
FardaERP/                        # ← کل ریپو = خودِ app (نه bench، نه multi-app)
├── erpnext/                     # پکیج اصلی پایتون (~412K LOC پایتون)
│   ├── accounts/    192 doctype, 40+ report     ← هسته حسابداری
│   ├── stock/        81 doctype                 ← انبار
│   ├── manufacturing/50 doctype                 ← تولید
│   ├── setup/        41 doctype                 ← Company, Currency, UOM, ...
│   ├── selling/      21 doctype (شامل Customer, POS)
│   ├── buying/       20 doctype (شامل Supplier)
│   ├── crm, projects, assets, support, quality_management, maintenance,
│   │   subcontracting, edi, telephony, communication, portal, shopping_cart
│   ├── regional/    ← australia, italy, south_africa, turkey, uae, united_states
│   │                  (ایران: NOT FOUND)
│   ├── locale/      40 زبان؛ fa.po = 3.0 MB
│   ├── public/      تصاویر (لوگوی erpnext)، scss، js bundles
│   ├── www/         صفحات وب (banking, lms, all-products, ...)
│   ├── templates/   emails, print_formats, pages
│   ├── hooks.py     774 خط — نقطه اتصال اصلی
│   ├── patches.txt  مهاجرت‌ها (تا v16_0 + current)
│   └── modules.txt  21 ماژول
├── banking/                     # SPA ویولت بانکداری (yarn workspace)
├── .github/workflows/           # 26 workflow CI/CD
├── pyproject.toml, package.json, license.txt (GPL-3.0)
├── README.md                    # هنوز README خام ERPNext
├── TRADEMARK_POLICY.md, attributions.md, SECURITY.md
└── (هیچ Dockerfile / docker-compose)   ← NOT FOUND
```

**حجم و مقیاس:** ۵,۶۰۳ فایل | ~۱۵۸ MB | ~۴۱۲K خط Python (۲,۹۶۸ فایل) | ~۸۵K خط JS (۶۴۲ فایل) | ۱,۲۲۳ فایل JSON (schema doctypeها) | ۱۸۷ report | ۵۲۴ فایل test

---

## 4) Modules (از `erpnext/modules.txt`)

Accounts, CRM, Buying, Projects, Selling, Setup, Manufacturing, Stock, Support, Utilities, Assets, Portal, Maintenance, Regional, ERPNext Integrations, Quality Management, Communication, Telephony, Bulk Transaction, Subcontracting, EDI

> Human Resources (HRMS) و Payroll در این ریپو **نیستند** (در ERPNext v14+ به app جداگانه `hrms` منتقل شده‌اند). نیازهای HR در پرامپت (بخش HR) نیازمند app جانبی است — تصمیم BUSINESS.

---

## 5) Current Features (چرخه‌های موجود و سالم در هسته)

- **فروش:** Lead → Opportunity → Quotation → Sales Order → Delivery Note → Sales Invoice → Payment Entry → Return (Credit Note) ✔
- **خرید:** Supplier → RFQ → Supplier Quotation → Purchase Order → Purchase Receipt → Purchase Invoice → Payment → Return ✔
- **انبار:** multi-warehouse، Batch، Serial/Serial-Batch Bundle، Stock Entry (Transfer/Receipt/Issue)، Reconciliation، Reorder، Stock Reservation، POS ✔
- **تولید:** BOM، Work Order، Job Card، Material Request، Production Plan، Subcontracting ✔
- **مالی:** Double-entry کامل (GL Entry + Payment Ledger)، Journal Entry، COA + importer + 66 قالب کشور، Tax Template/Rule، Budget، Accounting Dimension (شامل Branch ✔)، Period Closing، Deferred Revenue، Asset Accounting، Multi-currency ✔
- **گزارش‌ها:** General Ledger، Trial Balance، P&L، Balance Sheet، Cash Flow، AR/AP، profitability و ده‌ها گزارش دیگر ✔
- **CRM:** Lead, Opportunity, Campaign, Email Campaign, Prospect, Contract ✔ (قابل استفاده، pipeline قابل تنظیم)
- **Banking:** Bank, Bank Account, Bank Transaction, Bank Reconciliation Tool, Bank Statement Import, Cheque Print Template ✔
- **امنیت هسته:** Role-based permissions، User Permission (سطر-سطح)، Workflow، 2FA/OTP در Frappe، API Key/OAuth2، Rate limit، CSRF، Access Log و Audit Trail (doctypes در فریمورک) ✔

---

## 6) Localization Gap Analysis (فارسی/RTL/تاریخ/واحد پول)

| موضوع | وضعیت فعلی | Gap |
|---|---|---|
| ترجمه فارسی | `erpnext/locale/fa.po` — ۱۰,۶۸۲ msgid، **۲,۴۸۸ خالی**، ۰ fuzzy | ترجمه ~۲۳٪ ناقص + ترجمه‌های Frappe core جداگانه در ریپوی frappe است. کیفیت терминولوژی حسابداری باید بازبینی شود (نمونه: «Chart of Accounts → نمودار حساب» — معادل استاندارد ایرانی «فهرست/سرفصل حساب‌ها» است) |
| زبان پیش‌فرض fa | System Settings در فریمورک است؛ در این ریپو defaultLanguage ندارد | باید در setup wizard / after_install ست شود |
| RTL | موتور Desk فریمورک RTL را از جهت زبان می‌گیرد؛ bundleهای این app (POS، banking SPA، print formats) عموماً LTR hardcode شده‌اند | بازبینی UI-specific: POS، گزارش‌های HTML، print format، banking SPA |
| تقویم شمسی | **NOT FOUND** — صفر نتیجه برای jalali/shamsi/hijri در کل ریپو و در درخت frappe develop | نیاز به Jalali Layer کامل (بخش ۱۵) |
| واحد پول IRR/IRT | داده ارز از این ریپو منتقل شده به frappe core (`frappe/geo`) — در این ریپو NOT FOUND. IRT (تومان) به‌عنوان currency مستقل: NOT FOUND در frappe | Currency Layer ایران (فاز ۳) |
| اعشار پول | `currency_precision` از System Settings فریمورک | تومان بدون اعشار / ریال بدون اعشار باید enforce شود |
| اعداد فارسی | **NOT FOUND** | نمایشی (UI) با تبدیل امن؛ DB/API عدد واقعی |
| نرمال‌سازی جستجوی فارسی (ي/ی، ك/ک، نیم‌فاصله) | **NOT FOUND** | نیاز به Normalization Layer در لایه جستجو |
| Address Template ایران | `erpnext/regional/address_template` فقط برای چند کشور | قالب آدرس ایرانی لازم است (استان/شهر/کدپستی ۱۰ رقمی) |
| دسترسی داده‌های geo | country/currency در frappe core — محتوای دقیق Iran: UNKNOWN — needs verification | fix پس از راه‌اندازی bench |

**نکته داده‌ای غلط (باید fix شود):**
- `erpnext/setup/setup_wizard/data/country_wise_tax.json` → `"Iran Tax": VAT 7%` — نرخ ۷٪ منسوخ است (نرخ قانونی فعلی ۱۰٪؛ **BUSINESS DECISION REQUIRED** برای نرخ مصوب سال جاری).
- `erpnext/public/js/setup_wizard.js` خط ~۳۷۲ → `Iran: ["06-23", "06-22"]` به‌عنوان بازه سال مالی — با سال مالی ایران (فروردین تا اسفند ≈ 03-21 → 03-20) نمی‌خواند؛ داده غلط است.

---

## 7) Iranian Accounting Gap Analysis

موجود (هسته سالم): حسابداری دوطرفه، Payment Ledger، Journal Entry، COA importer، Tax Template + Tax Rule، Budget، Accounting Dimension (شامل Branch)، Period Closing، همه گزارش‌های اصلی مالی، Multi-company/currency.

| نیاز ایران | وضعیت | توضیح |
|---|---|---|
| سرفصل کل/معین/تفصیلی (ساختار ۳ سطحی استاندارد ایران) | NOT FOUND | COA فریمورک درختی است ولی تفصیلی معین مستقل ندارد؛ باید با COA Template ایرانی + (در صورت نیاز) accounting dimension «تفصیلی» پیاده شود |
| قالب Chart of Accounts ایران | **NOT FOUND** — از بین 66 قالب verified، هیچ Iran وجود ندارد | ساخت `ir_standard_coa.json` لازم است |
| دفتر روزنامه / دفتر کل ایرانی | گزارش General Ledger هست؛ «دفتر روزنامه» به شکل ایرانی NOT FOUND | report سفارشی |
| تراز آزمایشی ۴ ستونی / ۶ ستونی | Trial Balance استاندارد هست؛ فرمت ایرانی NOT FOUND | report سفارشی یا Print Format |
| گردش حساب تفصیلی | NOT FOUND | report سفارشی |
| تنخواه | NOT FOUND (می‌توان با Employee Advance/Imprest شبیه‌سازی کرد) | docType/فرآیند |
| کد اقتصادی / شناسه ملی / شماره ثبت | فیلد generic `tax_id` و `registration_details` هست؛ فیلدهای ساختاریافته ایرانی NOT FOUND | Custom Fields (فاز ۴) |
| مالیات ارزش افزوده + صورتحساب الکترونیکی (سامانه مودیان) | NOT FOUND. EDI module موجود فقط برای اروپا (Code List اروپایی) | Tax Template + فیلدهای شناسه کالا/خدمت + معماری اتصال آینده |
| مالیات تکلیفی | NOT FOUND | withholding template |
| چک ایرانی (دریافتی/پرداختی با وضعیت وصول/برگشتی) | Payment Entry فقط `reference_no`/`reference_date` دارد؛ Cheque Print Template هست؛ چرخه کامل چک NOT FOUND | docType سفارشی چک (فاز ۷) |
| IBAN ایران (IR...) validation | NOT FOUND | validator + Bank Master ایرانی (فاز ۷) |
| فاکتور رسمی چاپی ایران | Print Format ایرانی NOT FOUND (فرمت‌های فعلی: استاندارد بین‌المللی + regional اروپا/امارات) | Print Format فارسی RTL (فاز ۱۱) |
| شماره‌گذاری اسناد فارسی | Naming Series استاندارد هست (قابل تنظیم per doctype ✔) | پیشوند/فرمت ایرانی فقط config لازم دارد |

---

## 8) Iranian Payment Gap Analysis

- در v15+ درگاه‌های پرداخت (Stripe/PayPal/Razorpay) به **app جداگانه `payments`** منتقل شده‌اند؛ در این ریپو فقط `plaid_settings` باقی است.
- DocType عمومی **`Payment Gateway Account`** موجود است → نقطه اتصال مناسب برای Gatewayهای ایرانی.
- **ZarinPal / IDPay / NextPay / Pay.ir / درگاه مستقیم بانکی: NOT FOUND** — باید Payment Gateway Abstraction ایرانی ساخته شود (Interface → Adapter → Provider مطابق طراحی پرامپت؛ با doc_typeهای `Farda Payment Gateway` + `Payment Gateway Settings`).
- سامانه تسویه/پرداخت داخلی (شبا/پایا/ساتنا): NOT FOUND — فاز ۷.

## 9) Iranian SMS Gap Analysis

- هسته: `SMS Center` (ارسال دسته‌ای) + `sms_manager.js` + SMS Settings (در فریمورک؛ patch آن در این ریپو موجود است).
- فرمت SMS Settings فریمورک «gateway URL با پارامترها» است — Kavenegar/Melipayamak قابل اتصال از این مسیر هستند ولی بدون abstraction تمیز و بدون الگوی Provider/Adapter.
- Kavenegar / Melipayamak / FarazSMS / SMS.ir: **NOT FOUND**.
- OTP مبتنی بر موبایل (Login با کد یکبارمصرف): 2FA/OTPlogin در فریمورک هست؛ **OTP موبایلی ایرانی با rate-limit/audit اختصاصی: NOT FOUND** (فاز ۸).

---

## 10) Security Gap Analysis

**موجود (خوب):**
- RBAC + Role Profile + User Permission (سطر-سطح) + Workflow permissions ✔
- Audit: `Access Log` و `Audit Trail` (doctypes فریمورک)، Versioning اسناد ✔
- Login security: password policy، 2FA، login attempts limit (فریمورک) ✔
- API: API Key/Secret، OAuth2 (فریمورک)، CSRF token، rate limiting (فریمورک) ✔
- این ریپو: **هیچ secret/credential در کد پیدا نشد** (اسکن اولیه تمیز؛ `.env` ها gitignore هستند) ✔
- `SECURITY.md` + `semgrep` + `.pre-commit-config.yaml` (check-ast, no-commit-to-branch, ...) ✔

**Gapها:**
- Password policy و session timeout مصوب سازمانی: نیاز به تنظیم after_install (پیش‌فرض‌های سخت‌گیرانه FardaERP).
- Audit برای عملیات حساس ایرانی (چک، پرداخت gateway، تغییر permission): تقویت با doc_events.
- File upload security: از فریمورک ارث می‌رسد؛ policy مستندسازی شود.
- Secret management برای درگاه/SMS: docType `Farda Gateway Settings` با password-type fields (بدون ذخیره در Git) + `.env.example` مستند.

## 11) Deployment Gap Analysis

- **Dockerfile / docker-compose: NOT FOUND** در این ریپو. ERPNext رسمی با ریپوی `frappe_docker` دیپلوی می‌شود؛ `docker-release.yml` فقط به فریمورک رسمی dispatch می‌زند.
- ساختار پیشنهادی پرامپت (app/db/redis/workers/scheduler/nginx) باید با `frappe_docker` (پترن رسمی: backend, frontend/nginx, websocket, scheduler, workers, redis) هم‌راستا شود — نه ساختار دلخواه.
- Backup/Restore: دستورات bench موجود؛ مستندسازی و اسکریپت لازم است.
- Monitoring/Health: در فریمورک endpointهای پایه هست؛ stack پیشنهادی (Prometheus/Sentry) مستندسازی شود.
- Multi-tenant/SaaS: Frappe ذاتاً multi-site است (هر site = یک tenant) → معماری SaaS محدود نمی‌شود؛ فقط مستند و طراحی شود.

## 12) Testing Gap Analysis

- **موجود:** ۵۲۴ فایل test پایتون، bootstrap تست (`erpnext/tests/bootstrap_test_data.py`، `_Test Company`)، CI با MariaDB و Postgres، linters (ruff/flake8/eslint/prettier/pre-commit)، cypress در فریمورک.
- **Gap:** هیچ تست localization (شمسی/تومان/RTL/PDF فارسی)، هیچ تست سناریوی ایران (چک، VAT)، هیچ تست UI فارسی. linters روی فارسی: `RUF001` (ambiguous unicode) در ignore است که برای کد حاوی فارسی درست است ولی باید policy شود.

## 13) Technical Debt

1. روی شاخه **develop** (v17-dev) هستیم — APIها تا release نهایی ممکن است تغییر کنند (ریسک #1).
2. Python `>=3.14` — محدودیت اکوسیستم (بعضی پکیج‌های پرداخت/تاریخ شاید wheel نداشته باشند).
3. `banking/` SPA وابستگی yarn جدا دارد؛ build دو-مرحله‌ای.
4. داده‌های غلط ایران در setup wizard (بند ۶).
5. ترجمه fa ناقص + بخشی از ترجمه‌ها در frappe core است (دو ریپو باید هماهنگ ترجمه شوند).
6. `deprecation_dumpster` — کد deprecated جمع‌شده؛ در آینده پاک‌سازی.

## 14) Risk Assessment

| # | ریسک | شدت | راهکار |
|---|---|---|---|
| 1 | وابستگی به dev-branch (frappe/erpnext v17) | 🔴 بالا | Pin به commit/برچسب مشخص + بازه sync منظم + تست regression قبل از sync |
| 2 | تغییر گسترده core برای برندینگ → شکستن upgrade path | 🔴 بالا | برندینگ فقط از hooks/overrides/fixtures؛ تغییرات core حداقلی + مستند در `CORE-CHANGES.md` |
| 3 | تقویم شمسی اگر اشتباه پیاده شود، حسابداری خراب می‌شود | 🔴 بالا | DB همیشه میلادی؛ فقط UI شمسی؛ تست ماترسی کامل |
| 4 | ابهام تومان/ریال → خطای مالی ۱۰ برابری | 🔴 بالا | Currency واحد حسابداری + نمایش جدا + برچسب صریح فرم‌ها + تست |
| 5 | Python 3.14 و سازگاری پکیج‌ها | 🟡 متوسط | تست زودهنگام وابستگی‌ها؛ در صورت نیاز runtime رسمی‌تر با تأیید کارفرما |
| 6 | wkhtmltopdf و فونت فارسی/RTL در PDF | 🟡 متوسط | فونت Vazirmatn embed شده؛ تست PDF فارسی از فاز ۱۱ |
| 7 | ترجمه در دو ریپو (frappe + erpnext) | 🟡 متوسط | fa.po این ریپو کامل شود؛ ترجمه‌های فریمورکی جداگانه ارزیابی شود |
| 8 | قوانین مالیاتی ایران متغیر (نرخ VAT، سامانه مودیان) | 🟡 متوسط | نرخ‌ها به‌صورت data/config نه hardcode |

## 15) Recommended FardaERP Architecture

**اصل طلایی:** تاریخ در DB میلادی می‌ماند (استاندارد Frappe)، پول در DB با واحد حسابداری شرکت ذخیره می‌شود؛ **همه چیز در UI شمسی/فارسی/تومان‌محور نمایش داده می‌شود.**

```text
┌────────────────────────── FardaERP Product Layer ──────────────────────────┐
│  (داخل همین ریپو — از extension pointهای رسمی Frappe/ERPNext)              │
│                                                                            │
│  farda_iran/ (ماژول جدید در modules.txt)                                   │
│  ├── jalali/            ← Jalali Date Layer (py: jdatetime-free impl + js) │
│  ├── currency/          ← IRT/IRR display + validation (1 Toman = 10 Rial) │
│  ├── persian/           ← normalization (ي/ی ك/ک نیم‌فاصله اعداد)           │
│  ├── iran_banking/      ← Bank Master، IBAN validator، Cheque doctypes     │
│  ├── sms/               ← SMS Provider abstraction (Kavenegar, ...)        │
│  ├── payments/          ← Payment Gateway abstraction (ZarinPal, IDPay,..) │
│  ├── tax/               ← VAT 10%، تکلیفی، مودیان adapter stub             │
│  └── setup/             ← after_install: زبان fa، استان‌ها، بانک‌ها، COA     │
│                                                                            │
│  hooks.py (این ریپو): boot_session/extend_bootinfo، regional_overrides     │
│  fixtures/: استان‌ها، بانک‌ها، VAT template، COA ایران، UOMهای فارسی       │
│  locale/fa.po: ترجمه کامل‌شده                                              │
│  public/fonts + scss: Vazirmatn + RTL patches                              │
│  Print Formats (fixtures/custom): فاکتور رسمی فارسی                        │
│  Workspaces/Sidebar: بازنام‌گذاری FardaERP                                  │
└────────────────────────────────────────────────────────────────────────────┘
              │ (بدون تغییر یا با تغییر حداقلیِ ثبت‌شده)
┌─────────────▼──────────────────────────────────────────────────────────────┐
│  erpnext core (تغییرناپذیر تا حد امکان) │ frappe framework │ MariaDB/Redis │
└────────────────────────────────────────────────────────────────────────────┘
```

**دو گزینه معماری (تصمیم ساختاری):**

| | گزینه A: تک‌ریپو (توصیه‌شده) | گزینه B: app جانبی `fardaerp` |
|---|---|---|
| توضیح | همین ریپو = محصول؛ تغییرات از hooks/regional/فیکسچر داخل همان app | app دوم کنار erpnext در bench |
| مزیت | ساده، بدون وابستگی نسخه دو app، برندینگ عمیق‌تر ممکن | جدایی تمیز از upstream؛ upgrade آسان‌تر |
| عیب | sync با upstream سخت‌تر | دو app باید هم‌نسخه نگه داشته شوند؛ branding محدودتر |
| سازگار با پرامپت؟ | ✔ (اصل ۵: hooks/overrides/regional) | ✔ |

> پیشنهاد: **گزینه A** چون این ریپو از قبل یک fork کامل است و دو-app نگه‌داشتن، هزینه release/CI را دو برابر می‌کند. تغییرات core حداقلی و در `CORE-CHANGES.md` مستند می‌شود.

**Jalali Layer (طراحی):**
- سمت سرور: توابع تبدیل گregorian↔Jalali (الگوریتم استاندارد، بدون وابستگی خارجی یا با `jdatetime` اگر wheel برای py3.14 موجود باشد) + فرمت `dd/mm/yyyy` شمسی فقط در لحظه render.
- سمت کلاینت: override امن روی datepicker/datetime فریمورک از طریق bundle اختصاصی `fardaerp.bundle.js` (app_include_js) — بدون دستکاری هسته UI فریمورک؛ fallback به Gregorian برای زبان en.
- API/DB: هیچ تغییری — همیشه ISO Gregorian.

**Currency Layer:**
- Company currency = IRR یا IRT (تنظیم کارفرما)؛ `Currency`های IRR و IRT به‌عنوان دو مستند با symbol ﷼/تومان؛ فیلد نمایشی «مبلغ به تومان/ریال» روی فرم‌های مالی؛ conversion ثابت ۱۰ در قالب validator (خطای صریح در صورت تخلف).

## 16) Exact Files That Must Be Changed (نقشه اولیه فازهای ۱–۴)

**فاز ۱ (برندینگ + فارسی + RTL):**
- `erpnext/hooks.py` — app_title/description، app_include_js/css، after_install، extend_bootinfo
- `erpnext/public/images/*` — لوگو/favicon FardaERP (فایل‌های جدید، حفظ فایل‌های upstream برای attribution)
- `README.md` — معرفی FardaERP (بخش License/Attribution ERPNext حفظ شود)
- `erpnext/locale/fa.po` — تکمیل ترجمه‌های خالی + اصلاح اصطلاحات
- `erpnext/public/scss/*.scss` — فونت Vazirmatn + پچ‌های RTL محدود
- `erpnext/setup/setup_wizard/*` — اصلاح داده‌های غلط ایران (VAT، سال مالی)

**فاز ۲ (شمسی):**
- جدید: `erpnext/farda_iran/jalali/*.py|js` + bundle + تست‌های تبدیل
- `erpnext/hooks.py` — app_include_js + bootinfo (date format)

**فاز ۳ (تومان/ریال):**
- جدید: `erpnext/farda_iran/currency/*.py|js` + fixtures `Currency` (IRR/IRT)
- `erpnext/hooks.py` — doc_events validate مبلغ

**فاز ۴ (فیلدهای ایرانی):**
- جدید: fixtures Custom Field (Customer/Supplier/Company/Address: شناسه ملی، کد اقتصادی، کد ملی، استان/شهر، کدپستی ۱۰ رقمی) + validators

## 17) Phase-by-Phase Roadmap (نقشه اجرا مطابق پرامپت)

| فاز | محتوا | خروجی کلیدی |
|---|---|---|
| 0 | این Audit ✔ | همین سند |
| 1 | برندینگ FardaERP + fa پیش‌فرض + RTL + اصلاح داده‌های غلط ایران | محصول با هویت FardaERP |
| 2 | Jalali Date Layer + datepicker + تست ماترسی | تاریخ شمسی در UI، DB میلادی |
| 3 | IRT/IRR + برچسب «مبلغ به تومان» + جلوگیری از خطای ۱۰× | Currency Layer ایران |
| 4 | Custom Fields مشتری/تأمین‌کننده/شرکت + آدرس ایرانی + استان‌ها/شهرها (fixtures) | فاکتورسازی ایرانی آماده |
| 5 | COA ایران + دفتر روزنامه/کل + تراز ایرانی + گردش تفصیلی | حسابداری ایرانی |
| 6 | VAT 10% + مالیات تکلیفی + فیلدهای مودیان + adapter stub | مالیات ایران |
| 7 | Bank Master ایران + IBAN validator + چک دریافتی/پرداختی با چرخه وضعیت | بانکداری/چک |
| 8 | SMS abstraction (Kavenegar/…) + OTP موبایل با rate-limit/audit | اطلاع‌رسانی + ورود موبایلی |
| 9 | Payment Gateway abstraction + ZarinPal adapter نمونه | پرداخت آنلاین |
| 10 | Executive Dashboard فارسی + KPIها + گزارش‌های فارسی با export | داشبورد مدیریتی |
| 11 | Print Format فاکتور رسمی فارسی + تست PDF/فونت/RTL | چاپ فاکتور ایرانی |
| 12 | سخت‌سازی امنیت (password policy، audit حساس، secret mgmt) | SECURITY.md عملیاتی |
| 13 | Docker (فرمت frappe_docker) + مستندات production/backup | DEPLOYMENT.md |
| 14 | QA نهایی: سناریوهای فروش/خرید/انبار/مالی ایرانی + regression | گزارش تست |
| 15 | معماری SaaS (multi-site، نقشه subscription — بدون billing) | ARCHITECTURE.md |
| 16 | AI/OCR Layer (stub معماری، بدون پیاده‌سازی غیرضروری) | نقشه توسعه آینده |

## 18) Business Decisions Required ⚠️

1. **واحد حسابداری پیش‌فرض: ریال یا تومان؟** (پیشنهاد: حسابداری ریال، نمایش UI تومان — استاندارد رایج بازار ایران)
2. **نرخ VAT مصوب جاری؟** (repo می‌گوید ۷٪ — منسوخ؛ پیش‌فرض ۱۰٪ پیشنهاد می‌شود، نیازمند تأیید)
3. **استراتژی نسخه:** ماندن روی v17-dev و sync منظم، یا freeze روی tag مشخص؟
4. **گزینه معماری A یا B؟** (پیشنهاد: A)
5. **HR/Payroll:** آیا app جداگانه `hrms` به استک اضافه شود؟ (خارج از scope این ریپو)
6. **Trademarks:** نام ERPNext در Attribution/ترجمه‌ها طبق GPL-3 و TRADEMARK_POLICY حفظ شود — تأیید؟

## 19) NOT FOUND List (طبق قانون ۷۹ — صادقانه)

- تقویم شمسی/Jalali — NOT FOUND
- درگاه‌های پرداخت ایرانی (ZarinPal و…) — NOT FOUND
- SMS Providerهای ایرانی — NOT FOUND
- فیلدهای شناسه ملی/کد اقتصادی/کد ملی — NOT FOUND (فقط tax_id generic)
- Chart of Accounts ایران — NOT FOUND (66 قالب دیگر موجود)
- چک ایرانی با چرخه وضعیت — NOT FOUND
- Dockerfile/compose — NOT FOUND (در این ریپو)
- ایران در regional/ — NOT FOUND
- IBAN validator — NOT FOUND
- Multi-tenant setup — NOT FOUND (هرچند Frappe multi-site ذاتاً ممکن می‌کند)

**UNKNOWN — needs verification:** محتوای دقیق `frappe/geo/country_info.json` برای ایران (symbols/تلفظ)، وضعیت RTL runtime فریمورک v17، wheel سازگاری `jdatetime` با Python 3.14، نسخه MariaDB/Redis موردنیاز v17 — همه پس از راه‌اندازی bench اولیه verify می‌شوند.

---

## ✅ نتیجه

ریپازیتوری سالم، کامل و استاندارد است اما **صفر درصد بومی‌سازی شده**. پایه‌های لازم (ترجمه ۷۷٪، regional_overrides، payment_gateway_account، accounting dimension، naming series) همگی موجودند و مسیر توسعه بدون شکستن core باز است.

**منتظر تأیید شما برای شروع Phase 1 هستم.**
