# FardaERP — Version Baseline & Architecture Plan
> تاریخ: ۲۰۲۶-۰۹-۱۵ | پیش‌نیاز Phase 1 (Stable Version Baseline) | همه داده‌ها با GitHub API در همین تاریخ verify شده‌اند.

---

## 1) وضعیت دقیق فعلی ریپازیتوری (_fact_)

| مورد | مقدار verify‌شده |
|---|---|
| شاخه کاری این session | `arena/01a0a51f-fardaerp` (از `main` @ `b9c7401`) |
| Commit ریشه | `b9c74011cf07ce0298433d61a88fd4b6f523e1a7` — «Initialize FardaERP based on ERPNext» — تاریخ: **2026-09-15 16:14 +0330** (امروز) |
| نسخه ERPNext در ریپو | `17.0.0-dev` (`erpnext/__init__.py`) |
| وابستگی Frappe | `>=17.0.0-dev,<18.0.0` (`pyproject.toml`) |
| **نوع نسخه** | **شاخه توسعه (`develop`) — RELEASE پایدار نیست** ⚠️ |

**اثبات «snapshot از develop»:** blob SHA دو فایل کلیدی محلی با HEAD فعلی شاخه `develop` upstream **بایت‌به‌بایت یکسان** است:

| فایل | SHA محلی | SHA @ develop | SHA @ version-16 |
|---|---|---|---|
| `erpnext/hooks.py` | `ddd82f29…` | `ddd82f29…` ✅ یکسان | `e3d03caf…` ✗ |
| `pyproject.toml` | `e89d4f86…` | `e89d4f86…` ✅ یکسان | `1a40c6e8…` ✗ |

نتیجه: ریپوی فعلی **duplicate دقیق develop امروز** است؛ یعنی دقیقاً همان چیزی که تصمیم شماره ۳ شما می‌گوید نباید باشد.

---

## 2) لنداسکیپ نسخه‌های پایدار (verify شده ۲۰۲۶-۰۹-۱۵)

| App | آخرین Release پایدار | تاریخ انتشار | شاخه | نیازمندی‌ها |
|---|---|---|---|---|
| **ERPNext v16** | **v16.34.2** | 2026-09-08 | `version-16` | Frappe `>=16.21.0,<17` · Python `>=3.14` |
| ERPNext v15 | v15.121.2 | 2026-09-09 | `version-15` | Frappe `>=15.111.0,<16` · Python `>=3.10` |
| **Frappe v16** | **v16.33.1** | 2026-09-08 | `version-16` | Python `>=3.14,<3.15` |
| Frappe v15 | v15.120.1 | 2026-09-08 | `version-15` | Python `>=3.10,<3.15` |
| **HRMS v16** | **v16.18.1** | 2026-09-09 | `version-16` | Frappe `>=16.0.0,<17` · **erpnext `>=16.0.0,<17`** ✅ |
| HRMS v15 | v15.64.0 | 2026-09-08 | `version-15` | سری v15 |

هر دو سری v15 و v16 فعالانه release می‌شوند (هر دو ۶–۷ روز پیش release داشته‌اند). **v17 هنوز release نشده** (فقط develop).

### ماتریس سازگاری HRMS (سؤال ۵ شما)
HRMS v16.18.1 رسماً اعلام می‌کند: `erpnext >=16.0.0,<17.0.0` و `frappe >=16.0.0,<17.0.0` → **با ERPNext 16.34.2 کاملاً سازگار است.** HRMS app جداگانه‌ای در bench است (داخل core ERPNext ادغام نمی‌شود) → دقیقاً مطابق ساختار تصمیم شماره ۵ شما:

```text
FardaERP (این ریپو = ERPNext + Iranian Localization)
├── frappe        v16.33.x   (وابستگی bench — خارج از این ریپو)
├── erpnext       v16.34.x   (پایه این ریپو)
├── hrms          v16.18.x   (app جانبی bench — فاز ۱۳)
└── farda_iran/   (ماژول بومی‌سازی — داخل همین ریپو، ایزوله)
```

### نکته مهم Python (رفع یکی از ریسک‌های Phase 0)
Python 3.14 در v16 **انتخاب ما نیست، الزام رسمی upstream است** (Frappe v16: `>=3.14,<3.15`). ریسک «اکوسیستم نابالغ 3.14» به ریسک رسمی upstream تبدیل می‌شود و frappe_docker رسمی آن را پشتیبانی می‌کند. اگر این محدودیت مسئله‌ساز شود، گزینه جایگزین v15 با Python 3.10–3.14 است.

---

## 3) توصیه Baseline (سؤال ۶ شما)

### ✅ توصیه نهایی: سری v16
```text
ERPNext  = v16.34.2   (tag، شاخه version-16)
Frappe   = v16.33.1   (pin، خارج از این ریپو)
HRMS     = v16.18.1   (pin، app جانبی — فاز ۱۳)
Python   = 3.14       (الزام رسمی v16)
```

**دلایل:**
1. جدیدترین سری **پایدار** با release فعال (۷ روز پیش) — «Stability > Continuous Upstream Changes»
2. HRMS v16 رسماً سازگار (بدون gap نسخه‌ای)
3. شروع محصول جدید در ۲۰۲۶ روی v15 = اجبار به major-upgrade زودتر؛ v16 مسیر طبیعی است
4. sync کنترل‌شده بعدی فقط از `version-16` (نه develop) انجام می‌شود

**گزینه جایگزین (fallback):** سری v15 (Python 3.10–3.14 انعطاف بیشتر) — فقط اگر محدودیت Python 3.14 برای زیرساخت شما مسئله ایجاد کند. **BUSINESS DECISION تاییدشده لازم نیست مگر v15 را بخواهید.**

### فاصله فعلی از baseline (مقیاس عملیات re-baseline)
`develop` نسبت به `version-16`: **۵,۲۲۵ commit جلو / ۳,۲۰۷ عقب** → re-baseline باید **جایگزینی کامل درخت (tree replacement)** باشد، نه merge (merge = طوفان conflict روی ۵هزار+ commit).

---

## 4) طرح عملیاتی Phase 1 — Re-baseline (منتظر تأیید شما)

**اصل:** تاریخ Git حفظ می‌شود؛ محتوا با درخت دقیق `v16.34.2` جایگزین می‌شود؛ همه در یک commit شفاف و قابل audit.

```text
گام ۱: git fetch https://github.com/frappe/erpnext tag v16.34.2   (فقط fetch، بدون switch)
گام ۲: ساخت commit «chore(baseline): re-baseline FardaERP onto ERPNext v16.34.2»
        که درخت آن == درخت tag v16.34.2 + حفظ فایل‌های FardaERP (docs/، بعداً branding)
گام ۳: verification:
        - git diff <tag>  → فقط فایل‌های FardaERP باید اختلاف داشته باشند (صفر اختلاف upstream)
        - python -m compileall / import-check روی پکیج
        - شمارش doctype/patch consistency (patches.txt vs فایل‌ها)
گام ۴: tag محلی: fardainerp-baseline-v16.34.2
گام ۵: ثبت پین‌ها در docs/VERSIONS.md:  frappe==16.33.1 · erpnext==16.34.2 · hrms==16.18.1
گام ۶: به‌روزرسانی docs/PHASE-0-AUDIT.md (بخش نسخه) + README موقت
```

**ریسک‌ها و کنترل:**
| ریسک | کنترل |
|---|---|
| گم شدن تغییرات انجام‌شده تا امروز | تا امروز فقط `docs/PHASE-0-AUDIT.md` اضافه شده — حفظ کامل آن در commit |
| تفاوت schema DB (v17-dev → v16) | هنوز هیچ site/DB ساخته نشده → ریسک صفر (اگر بعداً bench بسازیم، از baseline تمیز شروع می‌شود) |
| شکستن session/preview | تغییر فقط content commit است؛ شاخه کاری همان `arena/…` می‌ماند |

---

## 5) معماری Modular تک‌ریپو (تصمیم شماره ۴ شما —OPTION A)

### 5.1 هویت فنی vs برند
- **پکیج پایتون و `app_name` = `erpnext` باقی می‌ماند** (تغییرش = شکستن مسیرهای patches/doctype/module و sync آینده). برند از طریق `app_title`، لوگو، صفحه login، README و UI به «FardaERP» تبدیل می‌شود.
- Attribution: `license.txt` (GPL-3.0)، `TRADEMARK_POLICY.md`، `attributions.md` و هدرهای copyright دست نمی‌خورند (تصمیم شماره ۶ شما).

### 5.2 لایه‌بندی داخلی

```text
erpnext/                        # هسته upstream — تغییر فقط حداقلی و ثبت‌شده
├── farda_iran/                 # ★ ماژول FardaERP (ثبت در modules.txt به نام "Farda Localization")
│   ├── README.md               # قوانین ماژول: چه چیزی اینجاست، چه چیزی در core است
│   ├── jalali/                 # فاز ۴ — تبدیل Gregorian↔Jalali (py + js)
│   ├── currency/               # فاز ۵ — IRT/IRR layer (نرخ ۱۰ در «یک» نقطه: constants.py)
│   ├── persian/                # فاز ۳ — normalization (ي/ی، ك/ک، نیم‌فاصله، اعداد)
│   ├── banking/                # فاز ۹ — بانک‌ها، IBAN، چک
│   ├── sms/                    # فاز ۱۰ — provider abstraction
│   ├── payments/               # فاز ۱۱ — gateway abstraction
│   ├── tax/                    # فاز ۸ — VAT configurable + مودیان stub
│   ├── setup/                  # after_install / fixtures loader (زبان fa، استان‌ها، بانک‌ها، COA)
│   └── tests/                  # تست‌های localization/حسابداری ایران
├── fixtures/                   # Custom Fields، استان‌ها/شهرها، VAT Template، COA ایران، Print Formats
├── locale/fa.po                # تکمیل ترجمه
├── public/  (fonts/scss/js)    # Vazirmatn، RTL patches، fardaerp.bundle.js
└── docs/                       # PHASE-0-AUDIT، VERSIONS، CORE-CHANGES، IRAN-LOCALIZATION، ...
```

### 5.3 قواعد تغییر Core (enforcement)
- هر تغییر در فایل‌های upstream **باید** در `docs/CORE-CHANGES.md` ثبت شود: فایل، دلیل، حداقل diff، تست regression مرتبط.
- اولویت: hooks/regional_overrides/overrides/fixtures/custom fields — کد core آخرین گزینه.
- CI gate آینده: تست‌های upstream نباید fail شوند (Phase 17).

### 5.4 فرآیند Controlled Upstream Sync (تصمیم شماره ۳ شما)

```text
هر ماه (یا بنا به نیاز امنیتی):
1. git fetch upstream version-16            # فقط از version-16، هرگز develop
2. شاخه: upstream-sync/v16.<x>.<y>
3. merge/apply → حل تعارض در farda_iran/ (نه در core)
4. گیت‌های اجباری قبل از merge:
   ✅ Automated tests (upstream suite)
   ✅ Regression tests (FardaERP suite)
   ✅ Localization tests (Jalali/IRT/fa/RTL)
   ✅ Accounting tests (سناریوهای فروش/خرید/مالی ایران)
   ✅ Migration tests (bench migrate روی DB کپی)
5. merge به main فقط با همه گیت‌ها سبز + تگ جدید fardainerp-v16.<x>.<y>-farda.<n>
```

Pin policy: `pyproject.toml` فریمورک-range upstream می‌ماند؛ نسخه‌های دقیق در `docs/VERSIONS.md` + اسکریپت نصب/Docker (فاز ۱۶) pin می‌شوند.

---

## 6) نگاشت فازهای شما به اقدامات (۱۸ فاز)

| فاز | عنوان شما | وضعیت/اقدام |
|---|---|---|
| 0 | Repository Audit | ✅ انجام شد (`docs/PHASE-0-AUDIT.md`) |
| **1** | **Stable Version Baseline** | **طرح بالا — آماده اجرا پس از تأیید** |
| 2 | FardaERP Architecture | skeleton ماژول `farda_iran/` + CORE-CHANGES.md + VERSIONS.md |
| 3 | Persian / RTL | fa پیش‌فرض، تکمیل fa.po، فونت، RTL bundle |
| 4 | Jalali Calendar | لایه تبدیل + datepicker |
| 5 | IRR Accounting + IRT Display | currency layer (نرخ ۱۰ در یک نقطه) |
| 6 | Iranian Customer/Supplier/Company | custom fields + استان/شهر + آدرس ایرانی |
| 7 | Iranian Accounting | COA ایران، دفتر روزنامه، تراز ایرانی، تفصیلی |
| 8 | VAT / Tax Architecture | قالب configurable (نرخ ۱۰٪ پیش‌فرض، effective date، per-company) |
| 9 | Banking / Cheque | بانک‌ها، IBAN، چرخه چک |
| 10 | SMS / OTP | abstraction + Kavenegar adapter + OTP امن |
| 11 | Payment Gateway | abstraction + ZarinPal adapter نمونه |
| 12 | Invoice / PDF / Print | فاکتور رسمی فارسی + PDF تست‌شده |
| 13 | HRMS Integration | نصب/pin hrms v16.18.x + بومی‌سازی HR جدا از لایه localization |
| 14 | Dashboard / Reports | داشبورد KPI فارسی |
| 15 | Security Hardening | password policy، audit، secret management |
| 16 | Docker / Production | فرمت رسمی frappe_docker + backup + monitoring |
| 17 | Automated Testing | کامل‌سازی گیت‌های تست |
| 18 | Controlled Upstream Sync | اجرای اولیه فرآیند بخش ۵.۴ |

---

## 7) جمع‌بندی برای تأیید

1. **Baseline پیشنهادی: ERPNext `v16.34.2` + Frappe `v16.33.1` + HRMS `v16.18.1` (سری v16)** — سازگاری HRMS رسمی و verify‌شده.
2. عملیات: **tree replacement در یک commit** روی همین شاخه session (تاریخ Git حفظ می‌شود؛ فایل‌های docs حفظ می‌شوند).
3. ریپوی فعلی = develop v17-dev (اثبات با blob SHA در بخش ۱) → جایگزینی **لازم** است، نه اختیاری.
4. معماری: تک‌ریپو، ماژول ایزوله `farda_iran/`، پکیج `erpnext` حفظ می‌شود (برند ≠ نام فنی).
5. Sync فقط از `version-16` با ۵ گیت تست.

> ⏸ **منتظر تأیید شما: شروع Phase 1 (re-baseline روی v16.34.2) یا انتخاب v15؟**
