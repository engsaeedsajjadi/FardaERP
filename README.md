<div align="center">

# فارداERP · FardaERP

**ERP متن‌باز فارسی‌اول — RTL بومی · تقویم جلالی · ریال/تومان**

*FardaERP — a Persian-first, RTL-native commercial ERP built on the ERPNext v16 core*

`ERPNext v16.34.2` · `Frappe v16.33.1` · `HRMS v16.18.1` · `GPL-3.0`

</div>

> **انتساب و سلب رابطه (Attribution & non-affiliation):** فارداERP یک محصول **مستقل** است که روی
> هستهٔ ERPNext/Frappe (نسخهٔ ۱۶) ساخته شده است. این پروژه محصول رسمی **Frappe Technologies**،
> **ERPNext** یا **Frappe** نیست و توسط هیچ‌کدام تأیید یا حمایت نمی‌شود. نام‌ها و نشان‌های
> ERPNext/Frappe متعلق به صاحبان آن‌هاست — ببینید `TRADEMARK_POLICY.md`، `attributions.md` و
> `license.txt` (GPL-3.0). کد پایه بدون تغییر معنایی از ERPNext v16.34.2 (کامیت `adc8f88`) است و
> هر تغییر ثبت‌شده در [`docs/CORE-CHANGES.md`](docs/CORE-CHANGES.md) («no entry, no change»).

---

## فارداERP چیست؟

یک ERP تجاری برای ایران که همان هستهٔ قدرتمند حسابداری/موجودی ERPNext را حفظ کرده و **لایهٔ
ایرانی کامل** را در یک ماژول ایزوله — `erpnext/farda_iran/` — اضافه می‌کند:

| لایه | شرح |
|---|---|
| 🗓 **جلالی و ارقام فارسی** | سرویس مرکزی تبدیل تاریخ (DB همیشه میلادی؛ جلالی فقط لایهٔ نمایش) |
| 💰 **ریال/تومان** | سرویس مرکزی ارز: نمایش، رقم به حروف فارسی، تبدیل کنترل‌شده |
| 🧾 **VAT قابل‌پیکربندی** | نرخ/تاریخ اثر/معافیت/دستهٔ کالا — بدون هاردکد در منطق کسب‌وکار؛ ثبت واقعی در فاکتور و GL |
| 🏦 **بانک و چک** | اعتبارسنجی IBAN (MOD-97)/کارت/کد ملی/شناسه حقوقی؛ چرخهٔ کامل چک + یادآورها + اتصال Payment Entry |
| 💳 **درگاه پرداخت** | انتزاع ZarinPal / IDPay / NextPay / Sandbox — امضای دیجیتال ورودی، ضد-replay/تамper؛ اعتبارنامه فقط env |
| 🔐 **OTP/SMS** | ذخیرهٔ **فقط-hash**، انقضا، rate-limit؛ انتزاع ارائه‌دهندهٔ SMS (Kavenegar/Melipayamak/Ghasedak/Console) |
| 🖨 **فاکتور فارسی و PDF** | Print Formatهای RTL (فروش A4 + خرید A4 + حرارتی 80mm)، PDF فارسی pure-Python با فونت وزیرمتن، مبلغ به حروف |
| 📊 **گزارش‌های ایرانی** | فروش/خرید Register، وضعیت چک، ماندهٔ طرف حساب، گزارش VAT، **دفتر کل و تراز آزمایشی** (§48) + داشبورد دادهٔ واقعی |
| 🛡 **امنیت و پایش** | سطح guest دقیقاً 4 endpoint، audit-trail، سلامت بدون secret/PII، ماسک‌کردن PII |
| 🔔 **اعلان‌ها** | ۶ تریگر دوکاناله (in-app + SMS) با dedupe دائمی |
| 🧯 **کلیدهای قطع (kill-switch)** | ۷ فلگ `farda_enable_*` در System Settings: `sms` · `otp` · `payment` · `vat` · `banking` · `cheque` · `reports` |

## وضعیت فعلی — صادقانه (Verification status)

**FINAL_STATUS فعلی: `NOT COMMERCIAL READY` — ۵ بلاکر صرفاً محیطی، ۰ باگ بازِ شناخته‌شده.**
گزارش کامل: [`docs/PRODUCTION-VERIFICATION-REPORT.md`](docs/PRODUCTION-VERIFICATION-REPORT.md).

> **Snapshot مرجع** (Documentation Reconciliation 2026-09-16T21:00:48Z): code snapshot تأییدشده `4016290` (آخرین کامیتِ code-affecting؛ کامیت‌های بعدی فقط-مستندات) · HEAD معتبر همیشه `git rev-parse origin/arena/01a0a51f-fardaerp` · تعداد unit مرجع **178/178** (سوئیت کامل 2026-09-16) — اعداد 160/166 در گزارش‌های قدیمی فقط checkpoint تاریخی رشد سوئیت‌اند، نه زیرمجموعه.

اثبات‌شده با اجرا (نه ادعا): unit **178/178** + JS parity · pipeline داخلی **7/7** ·
**21 سوئیت E2E زنده** (شامل زنجیرهٔ کامل Order-to-Cash: Company→Customer→Item→SO→VAT→SI→PE→تسویه→PDF فارسی→گزارش‌ها→audit) ·
idempotency ×3 روی سوئیت‌های حساس · rehearsal نصب‌تازه (migrate) · `bench migrate` با 0 خطا.

| گیت Production | وضعیت |
|---|---|
| 1 · Docker (build/up/health/persistence) | **BLOCKED-ENV** — compose-spec schema معتبر (8 سرویس)؛ daemon در محیط تأیید نبود |
| 2 · MariaDB 10.6 (نصب‌تازه/migrate/E2E) | **BLOCKED-ENV** — همهٔ شواهد فعلی PostgreSQL 16.2 است (انحراف مستندشده) |
| 3 · درگاه پرداخت Live | **BLOCKED-ENV** — credential واقعی موجود نیست؛ sandbox تأیید شده (`Sandbox success ≠ Live verified`) |
| 4 · SMS Live | **BLOCKED-ENV** — همان سیاست بالا؛ `flags.sms=OFF` ⇒ صفر پیام |
| 5 · GitHub Actions | **BLOCKED-ENV** — `.github/workflows` روی این شاخه وجود ندارد (API → 404) و push آن با توکن بدون مجوز `workflows` توسط GitHub رد شد؛ pipeline آمادهٔ فعال‌سازی: `scripts/ci/github-workflow.yml` |

دو مورد که **۱۰۰٪ تلقی نمی‌شوند** (طبق ماتریس گپ):

- **RTL/ترجمه — `PARTIAL`:** ۱٬۶۰۱ msgid خالی از ۱۰٬۱۵۷ (`erpnext/farda_iran/translations/audit.py`)؛ QA آنتروپورت/لاگین/دیالوگ‌ها مانده است.
- **گزارش‌ها — `IMPLEMENTED` (لایهٔ ایرانی ۱۲/۱۲):** فروش/خرید/چک/طرف حساب/مالیات بر ارزش افزوده/دفتر کل/تراز آزمایشی/موجودی کالا/کاردکس/بانک/جریان وجوه نقد/سود و زیان/ترازنامه — همه با سوئیت ران‌تایم سبز روی سایت تازه (2026-09-20). جزئیات: [`docs/REAL-CURRENT-GAP-MATRIX.md`](docs/REAL-CURRENT-GAP-MATRIX.md).

## راه‌اندازی سریع

### Docker (Production)

```bash
git clone https://github.com/engsaeedsajjadi/FardaERP.git
cd FardaERP
cp .env.example .env      # مقادیر secret را فقط همین‌جا پر کنید (env-only؛ هرگز commit نشود)
docker compose up -d      # mariadb:10.6 + redis×2 + backend/workers/scheduler/websocket/nginx
```

> ⚠️ این استک هنوز در محیط تأیید build/up نشده است (BLOCKED-ENV — بدون Docker daemon).
> فایل compose در برابر schema رسمی compose-spec معتبر است؛ runbook کامل:
> [`docs/DOCKER.md`](docs/DOCKER.md). پس از بالا آمدن: `RUN_MIGRATIONS=1` برای migrate یک‌باره.

### Bench (توسعه)

```bash
bench get-app erpnext https://github.com/engsaeedsajjadi/FardaERP --branch main
bench new-site mysite.local --install-app erpnext
bench --site mysite.local install-app hrms     # اختیاری — v16.18.1
bench start
```

پس از نصب، `erpnext.farda_iran.setup.install.execute()` فیلدهای سفارشی، VAT پیش‌فرض و
assetهای UI را اعمال می‌کند (نصب‌تازه به‌صورت خودکار seed می‌شود).

> **نکتهٔ دیتابیس:** هدف production، **MariaDB 10.6+** است؛ اما تا اجرای گیت ۲، تنها شواهد
> اجراشده روی PostgreSQL است (انحراف مستندشده — ادعای تأیید MariaDB نمی‌کنیم).

## تست‌ها و CI

```bash
bash scripts/ci/pipeline.sh all        # deps/lint/compile/unit/integration/security/build
```

سوئیت‌های runtime (`erpnext/farda_iran/tests/test_*_runtime.py`) روی یک سایت واقعی اجرا
می‌شوند؛ شبه‌PG (`tests/pg_compat.py`) **فقط-تست** است و هرگز وارد کد production/MariaDB نمی‌شود.
CI گیت‌هاب با کپی `scripts/ci/github-workflow.yml` به `.github/workflows/` (با توکن دارای مجوز
`workflows`) فعال می‌شود.

## مستندات

| سند | محتوا |
|---|---|
| [`docs/PRODUCTION-VERIFICATION-REPORT.md`](docs/PRODUCTION-VERIFICATION-REPORT.md) | گزارش ۱۷-بخشی تأیید production + شواهد ۵ گیت |
| [`docs/REAL-CURRENT-GAP-MATRIX.md`](docs/REAL-CURRENT-GAP-MATRIX.md) | ماتریس ویژگی‌ها با واژگان ۵وضعیتی (IMPLEMENTED … BLOCKED-ENV) |
| [`docs/FINAL-COMMERCIAL-READINESS-REPORT.md`](docs/FINAL-COMMERCIAL-READINESS-REPORT.md) | گزارش آمادگی تجاری + تاریخچه |
| [`docs/CORE-CHANGES.md`](docs/CORE-CHANGES.md) | دفتر کل تغییرات فایل‌های upstream |
| [`docs/DOCKER.md`](docs/DOCKER.md) | runbook production |
| [`docs/CI-CD.md`](docs/CI-CD.md) | pipeline و فعال‌سازی Actions |
| [`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md) | ممیزی سطح امنیتی |
| [`docs/VERSION-BASELINE-AND-ARCHITECTURE.md`](docs/VERSION-BASELINE-AND-ARCHITECTURE.md) | سیاست همگام‌سازی upstream (version-16 + ۵ گیت) |

## مجوز و نشان تجاری

- کد تحت **GPL-3.0** است (`license.txt`) — به‌ارث‌رسیده از ERPNext.
- فارداERP محصول رسمی Frappe/ERPNext **نیست**؛ استفاده از نام‌ها تابع
  [`TRADEMARK_POLICY.md`](TRADEMARK_POLICY.md) و [`attributions.md`](attributions.md) است.
- سیاست همگام‌سازی upstream: فقط `version-16`، با ۵ گیت و بدون بازنویسی تاریخچه.
