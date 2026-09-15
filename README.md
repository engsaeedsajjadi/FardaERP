<div align="center">
    <a href="https://fardaerp.ir">
        <img src="./erpnext/public/images/fardaerp-logo.svg" alt="FardaERP Logo" height="80px"/>
    </a>
    <h2>FardaERP | فردا ERP</h2>
    <div align="center">
        <p>سامانه جامع مدیریت کسب‌وکار ایرانی | Iranian Business Management ERP System</p>
        <p>ERP ایرانی برای فروش، خرید، انبار، تولید و مالی</p>
    </div>

[![Version](https://img.shields.io/badge/version-1.0-blue.svg)](https://github.com/engsaeedsajjadi/FardaERP)
[![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)](./license.txt)

</div>

<div align="center">
        <img src="./erpnext/public/images/v16/hero_image.png" alt="FardaERP Hero Image"/>
</div>

<div align="center">
        <a href="#ویژگی‌ها">ویژگی‌ها</a>
        -
        <a href="#نصب">نصب</a>
        -
        <a href="#مستندات">مستندات</a>
        -
        <a href="#مشارکت">مشارکت</a>
</div>

---

## درباره FardaERP

**FardaERP** یک سامانه جامع مدیریت کسب‌وکار (ERP) بومی‌شده برای بازار ایران است که بر پایه ERPNext ساخته شده است.

این سیستم به‌طور خاص برای نیازهای شرکت‌ها، فروشگاه‌ها، کارخانه‌ها، شرکت‌های بازرگانی و کسب‌وکارهای ایرانی طراحی شده است.

### ویژگی‌های کلیدی

#### 🇮🇷 بومی‌سازی کامل برای ایران

- **زبان فارسی**: رابط کاربری کاملاً فارسی با پشتیبانی از راست‌چین (RTL)
- **تقویم شمسی**: پشتیبانی کامل از تاریخ جلالی در تمام بخش‌ها
- **واحد پول**: مدیریت تومان و ریال با تبدیل خودکار
- **اعداد فارسی**: نمایش اعداد به فرمت فارسی

#### 💰 حسابداری ایرانی

- حساب‌های کل، معین و تفصیلی
- دفتر روزنامه و دفتر کل
- تراز آزمایشی، سود و زیان، ترازنامه
- مدیریت چک‌های دریافتی و پرداختی
- مراکز هزینه و پروژه
- مالیات بر ارزش افزوده

#### 📦 فروش و خرید

- فاکتور فروش با فرمت ایرانی
- فاکتور خرید
- پیش‌فاکتور
- سفارش فروش و خرید
- رسید انبار و حواله انبار
- برگشت از فروش و خرید

#### 🏭 انبارداری و تولید

- مدیریت چند انبار و چند شعبه
- موجودی لحظه‌ای
- حداقل و حداکثر موجودی
- شماره سریال و Batch
- دستور تولید
- لیست مواد (BOM)

#### 🏦 بانک و خزانه‌داری

- مدیریت حساب‌های بانکی
- مغایرت‌گیری بانکی
- دریافت و پرداخت
- تنخواه گردان
- چک و اسناد مدت‌دار

#### 👥 CRM و فروش

- مدیریت مشتریان
- سرنخ و فرصت‌های فروش
- پایپ‌لاین فروش
- فعالیت‌ها و پیگیری‌ها

#### 📊 گزارش‌گیری و داشبورد

- داشبورد مدیریتی با KPIهای کلیدی
- گزارش‌های متنوع فروش، خرید، انبار و مالی
- خروجی Excel و PDF
- نمودارهای تحلیلی

### زیرساخت فنی

- **Frappe Framework**: فریم‌ورک full-stack قدرتمند
- **Python & JavaScript**: تکنولوژی‌های مدرن و محبوب
- **MariaDB/PostgreSQL**: پایگاه داده رابطه‌ای
- **Redis**: کشینگ و صف وظایف
- **Docker**: استقرار آسان

---

## نصب

### پیش‌نیازها

- Python 3.14+
- Node.js 18+
- MariaDB 10.6+ یا PostgreSQL 14+
- Redis 6+

### نصب با Docker (توصیه شده)

```bash
# کلون کردن Repository
git clone https://github.com/engsaeedsajjadi/FardaERP.git
cd FardaERP

# اجرای Docker Compose
docker-compose up -d

# مشاهده لاگ‌ها
docker-compose logs -f
```

### نصب دستی

برای راهنمای نصب کامل، به [INSTALLATION.md](./INSTALLATION.md) مراجعه کنید.

---

## مستندات

- [راهنمای نصب](./INSTALLATION.md)
- [راهنمای توسعه](./DEVELOPMENT.md)
- [راهنمای استقرار](./DEPLOYMENT.md)
- [بومی‌سازی ایرانی](./IRAN-LOCALIZATION.md)
- [حسابداری](./ACCOUNTING.md)
- [درگاه‌های پرداخت](./PAYMENT-GATEWAYS.md)
- [پیامک](./SMS.md)
- [امنیت](./SECURITY.md)

---

## مشارکت

ما از مشارکت جامعه استقبال می‌کنیم! برای اطلاعات بیشتر به [CONTRIBUTING.md](./.github/CONTRIBUTING.md) مراجعه کنید.

---

## مجوز

این پروژه تحت مجوز **GNU General Public License v3** منتشر شده است. برای اطلاعات بیشتر به [license.txt](./license.txt) مراجعه کنید.

---

## قدردانی

این پروژه بر پایه [ERPNext](https://github.com/frappe/erpnext) و [Frappe Framework](https://github.com/frappe/frappe) ساخته شده است. ما از جامعه متن‌باز این پروژه‌ها سپاسگزاریم.

---

## تماس و پشتیبانی

- وب‌سایت: [https://fardaerp.ir](https://fardaerp.ir)
- ایمیل: info@fardaerp.ir
- GitHub: [github.com/engsaeedsajjadi/FardaERP](https://github.com/engsaeedsajjadi/FardaERP)

---

<div align="center">
    <p>ساخته شده با ❤️ برای کسب‌وکارهای ایرانی</p>
</div>
