# FardaERP - مستندات نصب و راه‌اندازی

## فهرست مطالب

1. [معرفی](#معرفی)
2. [پیش‌نیازها](#پیش‌نیازها)
3. [نصب با Docker](#نصب-با-docker)
4. [نصب دستی](#نصب-دستی)
5. [پیکربندی](#پیکربندی)
6. [درگاه‌های پرداخت](#درگاههای-پرداخت)
7. [سرویس‌دهنده‌های پیامک](#سرویسدهندههای-پیامک)
8. [پشتیبان‌گیری](#پشتیبانگیری)
9. [عیب‌یابی](#عیبیابی)

---

## معرفی

FardaERP یک سیستم برنامه‌ریزی منابع سازمانی (ERP) مبتنی بر ERPNext است که برای بازار ایران بومی‌سازی شده است.

### ویژگی‌های اصلی

- ✅ **زبان فارسی** - رابط کاربری کاملاً فارسی
- ✅ **RTL** - پشتیبانی کامل از راست‌چین
- ✅ **تقویم شمسی** - نمایش و ورود تاریخ به صورت شمسی
- ✅ **واحد پول** - تومان و ریال
- ✅ **فاکتور ایرانی** - فرمت فاکتور مطابق استانداردهای ایران
- ✅ **درگاه‌های پرداخت** - زرین‌پال، آی‌دی‌پی، نکست‌پی، Pay.ir
- ✅ **پیامک** - کاوه‌نگار، ملی‌پیامک، فرازاس‌ام‌اس، SMS.ir، قاصدک
- ✅ **حسابداری ایران** - کد اقتصادی، شناسه ملی، کد پستی

---

## پیش‌نیازها

### حداقل سخت‌افزار

- CPU: 2 هسته
- RAM: 4 گیگابایت
- Disk: 20 گیگابایت

### نرم‌افزار

- Docker 20.10+
- Docker Compose 2.0+
- Git

---

## نصب با Docker

### مرحله ۱: کلون کردن Repository

```bash
git clone https://github.com/engsaeedsajjadi/FardaERP.git
cd FardaERP
```

### مرحله ۲: کپی فایل محیطی

```bash
cp .env.example .env
```

### مرحله ۳: ویرایش فایل .env

مقادیر زیر را در فایل `.env` تغییر دهید:

```bash
DB_PASSWORD=رمز_امن_انتخاب_کنید
ADMIN_PASSWORD=رمز_مدیر
```

### مرحله ۴: اجرای Docker Compose

```bash
docker-compose up -d
```

### مرحله ۵: مشاهده لاگ‌ها

```bash
docker-compose logs -f fardaerp-backend
```

### مرحله ۶: دسترسی به برنامه

مرورگر را باز کنید و به آدرس زیر بروید:

```
http://localhost:8080
```

اطلاعات ورود پیش‌فرض:

- نام کاربری: `Administrator`
- رمز عبور: مقدار `ADMIN_PASSWORD` در فایل `.env`

---

## نصب دستی

### مرحله ۱: نصب Frappe Bench

```bash
# نصب پیش‌نیازها
sudo apt update
sudo apt install -y git python3-dev python3-pip redis-server mariadb-client

# نصب Bench
pip3 install frappe-bench
```

### مرحله ۲: ایجاد Bench جدید

```bash
bench init --frappe-branch version-15 fardaerp-bench
cd fardaerp-bench
```

### مرحله ۳: نصب FardaERP

```bash
bench get-app erpnext --branch develop
bench get-app https://github.com/engsaeedsajjadi/FardaERP
```

### مرحله ۴: ایجاد Site جدید

```bash
bench new-site fardaerp.local \
  --mariadb-root-password root_password \
  --admin-password admin_password \
  --db-name fardaerp
```

### مرحله ۵: نصب اپلیکیشن

```bash
bench use fardaerp.local
bench install-app erpnext
bench install-app fardaerp
```

### مرحله ۶: تنظیم زبان فارسی

```bash
bench set-config language fa
```

### مرحله ۷: شروع سرور

```bash
bench start
```

---

## پیکربندی

### تنظیمات اولیه

پس از ورود به سیستم:

1. به **Settings > System Settings** بروید
2. زبان پیش‌فرض را **Persian** انتخاب کنید
3. منطقه زمانی را **Asia/Tehran** تنظیم کنید
4. واحد پول پیش‌فرض را **Toman (IRT)** انتخاب کنید

### افزودن شرکت

1. به **Accounting > Company** بروید
2. شرکت جدید ایجاد کنید
3. اطلاعات زیر را تکمیل کنید:
   - نام شرکت
   - شناسه ملی
   - کد اقتصادی
   - شماره ثبت
   - آدرس کامل
   - کد پستی

---

## درگاه‌های پرداخت

### پیکربندی زرین‌پال

1. به **Accounts > Payment Gateway Provider** بروید
2. جدید ایجاد کنید:
   - Gateway Type: `ZarinPal`
   - Merchant ID: کد Merchant از پنل زرین‌پال
   - Sandbox: `1` برای تست، `0` برای تولید

### پیکربندی آی‌دی‌پی

1. به **Accounts > Payment Gateway Provider** بروید
2. جدید ایجاد کنید:
   - Gateway Type: `IDPay`
   - API Key: کلید API از پنل IDPay
   - Sandbox: `1` برای تست

### سایر درگاه‌ها

- NextPay
- Pay.ir
- درگاه مستقیم بانکی

---

## سرویس‌دهنده‌های پیامک

### پیکربندی کاوه‌نگار

1. به **Telephony > SMS Provider** بروید
2. جدید ایجاد کنید:
   - Provider Type: `Kavenegar`
   - API Key: کلید API از پنل کاوه‌نگار
   - Default Sender: خط ارسال پیش‌فرض

### پیکربندی ملی‌پیامک

1. به **Telephony > SMS Provider** بروید
2. جدید ایجاد کنید:
   - Provider Type: `Melipayamak`
   - Username: نام کاربری
   - Password: رمز عبور
   - Default Sender: خط ارسال پیش‌فرض

### سایر سرویس‌دهنده‌ها

- FarazSMS
- SMS.ir
- Ghasedak

---

## پشتیبان‌گیری

### پشتیبان‌گیری از دیتابیس

```bash
# با Docker
docker-compose exec fardaerp-db mysqldump -u root -p fardaerp > backup.sql

# بدون Docker
bench --site fardaerp.local backup --with-files
```

### بازیابی

```bash
# با Docker
cat backup.sql | docker-compose exec -T fardaerp-db mysql -u root -p fardaerp

# بدون Docker
bench --site fardaerp.local restore /path/to/backup.sql
```

---

## عیب‌یابی

### مشکل: اتصال به دیتابیس

```bash
# بررسی سلامت دیتابیس
docker-compose ps fardaerp-db

# مشاهده لاگ‌ها
docker-compose logs fardaerp-db
```

### مشکل: لود نشدن CSS فارسی

```bash
# پاک کردن کش
docker-compose exec fardaerp-backend bench clear-cache
docker-compose exec fardaerp-backend bench clear-website-cache
```

### مشکل: عدم نمایش تاریخ شمسی

1. مطمئن شوید زبان سیستم فارسی است
2. کش مرورگر را پاک کنید
3. لاگ‌ها را بررسی کنید

### مشاهده لاگ‌ها

```bash
# لاگ‌های Backend
docker-compose logs -f fardaerp-backend

# لاگ‌های Nginx
docker-compose logs -f fardaerp-frontend

# لاگ‌های Scheduler
docker-compose logs -f fardaerp-scheduler
```

---

## تماس و پشتیبانی

- وب‌سایت: https://fardaerp.ir
- ایمیل: info@fardaerp.ir
- GitHub: https://github.com/engsaeedsajjadi/FardaERP

---

## مجوز

این پروژه تحت مجوز GNU General Public License v3 منتشر شده است.
