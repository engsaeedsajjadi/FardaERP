# FardaERP — Migration Rehearsal (§36)

> Date: 2026-09-16 · Site: PG 16.2 UTF8 / Python 3.14 / Frappe v16.33.1 / ERPNext v16.34.2 (FardaERP tree)
> Verdict: **تمام مسیرهای قابل‌اجرای این محیط با موفقیت تمرین شد**؛ مسیر MariaDB/production-backup
> همچنان **BLOCKED-ENV** است (G-MDB: هیچ docker daemon یا mariadbd در sandbox موجود نیست —
> `docker: command not found` مجدداً در همین تاریخ راستی‌آزمایی شد).

## 1) Re-migrate (مسیر ارتقا، سایت دارای داده)

`bench --site smoke.farda.local migrate` → **PASS** (31s، خروجی تمیز). شامل:
before_migrate فردا (`install.execute`: custom fields + VAT defaults + search keys +
audit index + flags + dashboards + UI assets) بعد از دهها فازِ داده‌ساز —
**idempotent**؛ بدون patch جدید (patches.txt بدون مدخل farda).

## 2) Fresh install (مسیر نصب از صفر — سایت دوم بکِر)

| گام | نتیجه |
|---|---|
| `bench new-site farda-fresh.local --db-type postgres` | PASS (~32s) |
| `bench --site farda-fresh.local install-app erpnext` | PASS (75s) — DocTypes/RTL assets/print formats (3 فرمت فارسی)/Cheque/Farda Audit Log نصب شد |
| `bench --site farda-fresh.local migrate` | PASS — **ensure_flags: هر ۷ فیلد Check ساخته شد** |
| **Setup wizard fixtures** (upstream `install_fixtures.install(country='Iran')`) | PASS — نکتهٔ واقعی نصب تازه: `install-app` به‌تنهایی اجرایش نمی‌کند |
| ایجاد Company (IRR/ایران) + `install.execute()` مجدد | PASS — Item Tax Template «Iran Tax - FFC» خودکار ساخته شد |

### سوئیت‌های زنده روی سایت بِکِر (بدون هیچ فیکسچر قبلی)

| سوئیت | نتیجه |
|---|---|
| R3 ایران integration | **5/5** |
| R4 پرداخت‌ها (sandbox→PE) | **9/9** |
| R5 OTP | **6/6** |
| **R19 زنجیرهٔ سر‌تا‌سر سفارش‌تاوصول** | **8/8** — مشتری کدملی→بانک→SO→DN→SI+VAT→چاپ فارسی→درگاه→چک→گزارش‌ها |

نکتهٔ تثبیت‌شده در R19: سایت بِکِر Supplier ندارد — تست اکنون get-or-create می‌کند
(بهبود پایداری، بدون تغییر محصول).

## 3) حفره‌های کشف‌شده و بسته‌شده توسط همین rehearsal

1. **Warehouse Type «Transit» و سایر presetها فقط مسیر setup wizard دارند** (upstream
   `install_fixtures.py`؛ نه install-app). هر نصب تازه باید wizard را کامل کند — در
   Docker entrypoint صفحهٔ setup انجام می‌شود؛ برای نصب API-محور، اجرای
   `install_fixtures.install(country=...)` قبل از ساخت Company لازم است. (رفتار
   upstream است، نه باگ فردا.)
2. **Custom Field defaults روی Singleها seed نمی‌شوند** — ensure_flags اکنون فیلدهای
   تازه‌ساخت را صریحاً روشن می‌کند (۰ صریح ادمین بازنویسی نمی‌شود).
3. R13 assert عددی unit (۱۶۰/۱۶۰) → «passed, 0 failed» بی‌وابسته به شمارش.

## 4) BLOCKED-ENV (فقط خارج از sandbox)

- **MariaDB production-like validation**: نیازمند docker daemon یا باینری mariadb —
  apt/raw در sandbox بسته است (G-MDB). پس از ساخت تصویر Docker (docs/DOCKER.md §7)،
  همین سند باید روی MariaDB 10.6 تکرار شود.
- **upgrade rehearsal از backup واقعی production**: نیازمند وجود backup واقعی مشتری.

## 5) قرارداد تکرار (گیت MariaDB)

```
docker compose up mariadb → bench new-site (db-type mariadb) → install-app erpnext
→ migrate → install_fixtures.install(country='Iran') → Company → install.execute()
→ همان ۴ سوئیت R3/R4/R5/R19 + gate5 → نتایج را همین‌جا ثبت کن
```
