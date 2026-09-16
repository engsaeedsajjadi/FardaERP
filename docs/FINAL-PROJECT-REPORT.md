# FardaERP — گزارش پایانی تحویل پروژه (Final Delivery Report)

> تاریخ: **2026-09-16** · HEAD: `75e362b` · شاخهٔ `arena/01a0a51f-fardaerp` (همهٔ کارها push شده · worktree پاک)
> مبنا: ERPNext **v16.34.2** (adc8f88) / Frappe v16.33.1 / HRMS v16.18.1 · Python 3.14 · Node 24 · PostgreSQL 16.2 (runtime) / MariaDB 10.6 (production baseline)
> **FINAL_STATUS: NOT COMMERCIAL READY** — صرفاً به‌سبب **۵ بلاکر محیطی**؛ **هیچ بلاکرِ کدی باقی نیست.**
> طبق قواعد v2: هیچ ادعایی فراتر از شواهد اجراشده؛ وضعیت‌ها با واژگان استاندارد (IMPLEMENTED / IMPLEMENTED-BUT-UNVERIFIED / PARTIAL / MISSING / BLOCKED-ENV).

---

## ۱) خلاصهٔ مدیریتی

ERPNext v16 به یک سامانهٔ **تجاریِ ایرانی‌محور** تبدیل شد: **Jalali / RTL / IRR-تومان / VAT پیکربندی‌پذیر / شبا-چک-OTP-درگاه پرداخت**، به‌صورت **جداشده در ماژول `erpnext/farda_iran/`** (بدون شکستن سازگاری upstream) با لایهٔ سرویس مرکزی، تست اثبات‌رفتار (unit + زنده)، CI درون‌ریپو و قرارداد استقرار Docker.

- **دامنهٔ کد**: ۱۲۶ فایل Python در `farda_iran`، ۳۶ ماژول تست، ۵ گزارش ایرانی، ۳ فرمت چاپ فارسی، ۵ DocType اختصاصی + Cheque، ۷ فلگ سطح‌سیستم، ۴ dispatcher فضای‌نامی API.
- **شواهد**: unit **178/178** + JS parity ALL PASS · pipeline درون‌ریپو **7/7 GREEN** · **۲۱+ سوئیت زندهٔ E2E (۱۳۱+ assert)** روی سایت واقعی — همگی idempotent (×۳) · تمرین مهاجرت: **نصب از صفر + زنجیرهٔ کامل سفارش‌تاوصول 8/8 روی سایت بِکِر**.
- **ارزش اثبات‌شدهٔ E2E**: در همین فرایند **۷+ باگ نهانِ واقعی** (خارج از تست‌های ساختگی) کشف و بسته شد — از جمله دو نقص در سیم‌کشی چک↔PE و سه حفرهٔ نصب‌تازه.
- **تنها فاصله تا «COMMERCIAL READY»**: گشایش محیطی (Docker/MariaDB)، اعتبارنامهٔ زندهٔ درگاه/SMS (تصمیم شما)، فعال‌سازی GitHub CI.

## ۲) شناسهٔ فنی و قرارداد سازگاری

| محور | تصمیم |
|---|---|
| خط پایهٔ تغییرناپذیر | ERPNext v16.34.2 / Frappe v16.33.1 / HRMS v16.18.1 — **بدون مهاجرت v17** |
| جداسازی | تمام کد ایرانی در `erpnext/farda_iran/*`؛ بستهٔ `erpnext` تغییرنکرده؛ برنامهٔ ارتقای upstream = فقط version-16 + ۵ گیت |
| ادغام | hooks/fixtures/custom fields؛ **هر تغییر upstream با مدخل در `docs/CORE-CHANGES.md`** («no entry, no change» — CORE-001…CORE-007) |
| سرویس‌های مرکزی | Jalali (لایهٔ ارائه؛ DB همیشه میلادی) · IRR/تومان (تک‌منبع، HALF-UP، «٬») · نرمال‌سازی فارسی · اعتبارسنجی شناسه‌های رسمی |
| سازگاری PG | `tests/pg_compat.py` — ۱۳ شیم مستند (PG-1…PG-14) برای سخت‌گیری‌های PostgreSQL؛ **بدون دست‌زدن به فایل upstream**؛ روی MariaDB بلااستفاده‌اند |

## ۳) دامنهٔ تحویل‌شده (§41 — هر ۲۲ گام)

| فاز | وضعیت | سوییچ/سند |
|---|---|---|
| ماتریس شکاف Phase-0 | ✅ | docs/PHASE-0-AUDIT.md + REAL-CURRENT-GAP-MATRIX.md (مرجع وضعیت) |
| سرویس‌های مرکزی Jalali/تومان/نرمال‌سازی/اعتبارسنجی | ✅ | f63cf5f · 49 تست اول |
| VAT پیکربندی‌پذیر (نرخ/تاریخ اثر/معافیت شخص و قلم/قالب‌ها/گزارش) | ✅ | b520244→bdf923e · R8 8/8 |
| بانکداری (شبا→بانک، کارت، Bank Account) + جستجوی فارسی | ✅ | aa18534 · R9/R10 7/7+7/7 |
| چک (DocType، گذارهای قانونی، سیم‌کشی PE، یادآوری) | ✅ | f633704 + b3a8841 (۲ باگ بسته شد) · R19 |
| درگاه پرداخت (سیاست + ZarinPal/IDPay/NextPay سندباکس) | ✅ سندباکس / ⛔ زنده BLOCKED-ENV | 5cea10a/eb9a1f1 · R4 9/9 |
| OTP (هش+فلفل، سقف/کول‌داون) + پیامک (۴ سرویس‌دهنده) | ✅ / ⛔ زنده BLOCKED-ENV | 82e621b/6952eeb · R5 6/6 |
| فاکتور فارسی (A4 فروش/خرید، حرارتی ۸۰mm، PDF فارسی، به حروف) | ✅ | 7202757/6b162c5 · R6 9/9، R15 4/4 |
| RTL/Persian UX + ترجمه‌ها | ✅ (۱٬۶۰۱ msgid خالی باقی) | 7785cad/0746530/4eaca25 |
| گزارش‌های ایرانی (فروش/خرید/چک/تطادل/مالیات) | ✅ | db497a4/bdf923e · R7/R11 |
| داشبورد مدیریت (KPI واقعی، کارت‌ها/چارت) | ✅ | 6259af3 · R12 6/6 |
| پشتیبان/بازیابی (manifest+retention+AES، **restore-verified**) | ✅ | 408dcfe/073d6c9 · R13 5/5 |
| Docker production stack | ⚠️ IMPLEMENTED-BUT-UNVERIFIED | e1cc1d5 · گیت DOCKER.md §7 |
| CI/CD (۷ مرحله) | ✅ درون‌ریپو / ⛔ فعال‌سازی GitHub BLOCKED-ENV | a169007 |
| Audit log (فقط‌الحاق: پرداخت/چک/VAT/هویت) | ✅ | 58a10ec · R14 7/7 |
| امنیت (XSS/SQLi/PII/سطح guest/escalation) | ✅ | 1ba5435 · R16 5/5 |
| مانیتورینگ/سلامت (بدون افشای راز/PII) | ✅ | e7ee941 · R17 4/4 |
| کارایی (بودجه‌ها در کد + اصلاح N+1) | ✅ | bff16bb · R18 5/5 + docs/PERFORMANCE.md |
| E2E breadth (زنجیرهٔ سر‌تاسری) | ✅ | b3a8841 · R19 8/8 |
| Notifications (۶ تریگر، درون‌اپ+پیامک) | ✅ | 2557577 · R20 6/6 |
| API namespaces (`farda.tax/party/bank/reports`) | ✅ | bc057e2 · R21 7/7 + docs/API-NAMESPACES.md |
| Feature flags (۷ فلگ مرکزی) | ✅ | 3f5b71f · R22 6/6 |
| Migration rehearsal + گیت نهایی + docs freeze | ✅ PG / ⛔ MariaDB | 75e362b · docs/MIGRATION-REHEARSAL.md |

## ۴) شواهد پایانی (همگی 2026-09-15/16، سایت واقعی `smoke.farda.local`)

| مجموعه | نتیجه |
|---|---|
| unit (frappe-free) + JS parity | **178/178 + ALL PASS** (node، ۲۰۹ بردار) |
| pipeline درون‌ریپو (deps/lint/compile/unit/integration/security/build) | **7/7 GREEN** |
| R2 گیت-۵ (سازمان‌دهی پایهٔ ERP: فروش/خرید/موجودی/حسابداری/HRMS) | 13/13 |
| R3 ایران · R4 پرداخت · R5 OTP | 5/5 · 9/9 · 6/6 |
| R6 چاپ+PDF · R7 گزارش · R8 VAT · R9/R10 جستجو/بانک · R11 بستهٔ گزارش · R12 داشبورد | 9/9 · 5/5 · 8/8 · 7/7+7/7 · 4/4 · 6/6 |
| R13 پشتیبان/بازیابی · R14 audit · R16 امنیت · R17 مانیتورینگ · R18 کارایی | 5/5 · 7/7 · 5/5 · 4/4 · 5/5 |
| **R19 زنجیرهٔ سفارش‌تاوصول** · R20 نوتیفیکیشن · R21 namespaces · R22 فلگ‌ها | **8/8** · 6/6 · 7/7 · 6/6 — **×۳ idempotent** |
| Rehearsal نصب‌تازه (سایت بِکِر) | R3 5/5 · R4 9/9 · R5 6/6 · **R19 8/8** |

نمونه‌های اثبات رفتاری (نه صرفاً وجود کد): VAT ۱۰٪ روی GL واقعی (بدهکار/بستانکار دقیق) · replay/مبلغ دستکاری‌شدهٔ درگاه → FAIL (هرگز PE) · چک فقط با گذارهای قانونی وصول می‌شود (۲ سطر audit) · بازیابی با همان VAT settings/count بازگذشت · خاموشی فلگ sms ⇒ صفر فراخوانی سرویس‌دهنده.

## ۵) امنیت

سطح guest دقیقاً ۴ متد (OTP×2، verify_payment، health) — با R16 مجدداً راستی‌آزمایی شد · XSS روی هر ۴ فرمت چاپ بسته شد · SQLi مسدود · OTP فقط-هش · audit با پاک‌سازی رازها · مانیتورینگ/سلامت بدون راز/PII · bandit baseline 17×B608 (مستند) · اعتبارنامه‌ها فقط env؛ هیچ رازی در ریپو نیست.

## ۶) کارایی (R18 — بودجه‌ها در تست CI)

جستجو ×۲۵ میانگین 2ms (بدترین 51ms) · درج SI با VAT+audit حداکثر 295ms · KPIs 13ms · چاپ 24ms · ۴ گزارش ≤1.2s · audit.record 5ms · یادآوری‌ها dedupe دسته‌ای (اجرای دوم: صفر). تنها اصلاح hot-path واقعی: batch-read یادآوری‌ها.

## ۷) استقرار و بهره‌برداری

- **Bootstrap محیط**: `scripts/bootstrap_tools.sh` + `finish_env.sh` (کل stack از صفر) — اجرای همهٔ سوئیت‌ها گام [7/7] همان اسکریپت است.
- **CI**: `bash scripts/ci/pipeline.sh all` (هفت مرحله؛ gates قابل‌انتقال به GitHub با `scripts/ci/github-workflow.yml` — نیازمند فعال‌سازی).
- **پشتیبان**: `scripts/backup.sh` / `restore.sh` (+ knobeهای env: FARDA_BACKUP_DIR/RETENTION_DAYS/BACKUP_PASSPHRASE/…).
- **Docker**: `docker/` سه‌مرحله‌ای + compose (mariadb+redis+backend+frontend)؛ گیت پذیرش در docs/DOCKER.md §7 (نیازمند daemon).
- **گیت MariaDB**: قرارداد تکرار در docs/MIGRATION-REHEARSAL.md §5 آماده است.

## ۸) 🚦 گیت نهایی — بلاکرها و مسیر «COMMERCIAL READY»

| # | بلاکر | نوع | مسئول گشایش |
|---|---|---|---|
| 1 | MariaDB 10.6 validation | BLOCKED-ENV | Docker daemon در sandbox نیست (G-MDB) |
| 2 | Docker build/up | BLOCKED-ENV | همان daemon |
| 3 | اعتبارنامهٔ واقعی درگاه | BLOCKED-ENV | **تصمیم کاربر** (stop-and-ask؛ env-only) |
| 4 | اعتبارنامهٔ واقعی SMS | BLOCKED-ENV | **تصمیم کاربر** (stop-and-ask) |
| 5 | فعال‌سازی GitHub CI | BLOCKED-ENV | تنظیمات repo/runner |

**مسیر**: گشایش 1–2 ⇒ اجرای rehearsal روی MariaDB + گیت Docker §7 ⇒ 3–4 با اعتبارنامهٔ شما ⇒ 5 ⇒ به‌روزرسانی جدول بلاکرها در FINAL-COMMERCIAL-READINESS-REPORT.md و ثبت FINAL_STATUS جدید. **هیچ کار کدری در صف نیست.**

## ۹) انطباق

مجوز **GPL-3.0** (مطابق ERPNext) + اسب‌نامهٔ تجارت‌واتمپ محفوظ · این پروژه **محصول رسمی Frappe/ERPNext نیست** و هرگز چنین معرفی نمی‌شود · دادهٔ production واقعی/جعلی در ریپو وجود ندارد · تخطی PostgreSQL (runtime sandbox) مستند و هرگز «اعتبارسنجی MariaDB» نامیده نشده است.

## ۱۰) پیوست — نقشهٔ اسناد

`REAL-CURRENT-GAP-MATRIX.md` (مرجع وضعیت) · `FINAL-COMMERCIAL-READINESS-REPORT.md` (گیت زنده) · `MIGRATION-REHEARSAL.md` · `API-NAMESPACES.md` · `SECURITY-AUDIT.md` · `PERFORMANCE.md` · `BACKUP-RESTORE.md` · `CI-CD.md` · `DOCKER.md` · `VERSIONS.md` · `VERSION-BASELINE-AND-ARCHITECTURE.md` · `CORE-CHANGES.md` · `COMMERCIAL-GAP-ANALYSIS.md` · `PHASE-0-AUDIT.md` · `PHASE-1-REPORT.md` · `PHASE-G5-REPORT.md` · `MASTER-TASK-LIST.md`

نقشهٔ کامیت‌ها (انتخابی): f63cf5f خدمات مرکزی → b520244 VAT+party → f633704 بانک+چک → 5cea10a/eb9a1f1 پرداخت → 7202757 فاکتور فارسی → db497a4 گزارش‌ها → 6259af3 داشبورد → 073d6c9 پشتیبان → e1cc1d5 Docker → a169007 CI → 58a10ec audit → 6b162c5 چاپ → 1ba5435 امنیت → e7ee941 مانیتورینگ → bff16bb کارایی → b3a8841 E2E breadth → 2557577 نوتیفیکیشن → bc057e2 namespaces → 3f5b71f فلگ‌ها → **75e362b rehearsal + گیت نهایی (HEAD)**
