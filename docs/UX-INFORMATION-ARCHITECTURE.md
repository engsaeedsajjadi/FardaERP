# FardaERP — Information Architecture (Phase 2)

Date: 2026-09-21 · Maps §5 (menu) onto EXISTING ERPNext DocTypes/reports — no
duplication, no new business objects. The workspace is created idempotently by
`farda_iran.setup.install.ensure_workspace()` (same pattern as Number Cards).

## 1. Primary surface

```text
Workspace «FardaERP» (public, module: Farda Iran) — landing surface
├── Header: فردا ERP
├── Number Cards (real data): فروش کل · خرید کل · دریافتنی · پرداختنی · ارزش موجودی
├── Chart: فروش ماهانه
└── Shortcut groups (Persian labels → existing DocType/Report):
```

## 2. Shortcut map (Persian label → target)

| گروه | برچسب | هدف (type) |
|---|---|---|
| فروش | مشتریان | DocType: Customer |
| فروش | سفارش‌های فروش | DocType: Sales Order |
| فروش | فاکتورهای فروش | DocType: Sales Invoice |
| فروش | دریافت‌ها | DocType: Payment Entry |
| خرید | تأمین‌کنندگان | DocType: Supplier |
| خرید | سفارش‌های خرید | DocType: Purchase Order |
| خرید | فاکتورهای خرید | DocType: Purchase Invoice |
| انبار | کالاها | DocType: Item |
| انبار | اسناد انبار (ورود/خروج/انتقال) | DocType: Stock Entry |
| انبار | موجودی کالا | Report: Farda Stock Balance |
| حسابداری | دفتر کل | Report: Farda General Ledger |
| حسابداری | تراز آزمایشی | Report: Farda Trial Balance |
| حسابداری | سود و زیان | Report: Farda Profit and Loss |
| حسابداری | ترازنامه | Report: Farda Balance Sheet |
| حسابداری | جریان وجوه نقد | Report: Farda Cash Flow |
| بانک | حساب‌های بانکی | DocType: Bank Account |
| بانک | گزارش بانک | Report: Farda Bank Report |
| چک‌ها | چک‌ها | DocType: Cheque |
| چک‌ها | گزارش چک | Report: Farda Cheque Report |
| فروش/خرید | فروش | Report: Farda Sales Register |
| فروش/خرید | خرید | Report: Farda Purchase Register |
| مالیات | گزارش مالیات بر ارزش افزوده | Report: Farda VAT Report |
| طرف‌حساب | مانده طرف‌حساب‌ها | Report: Farda Party Balance |

(All 13 Iranian reports + core doctypes reachable in one click.)

## 3. Role views (§8) — permission-driven visibility

The workspace shows only what the user may open (frappe enforces per-shortcut
permission on navigation). Role emphasis:

| نقش | ستون‌های پرکاربرد همان workspace |
|---|---|
| مدیر (System Manager / Accounts Manager) | همهٔ کارت‌ها + همهٔ گزارش‌ها |
| حسابدار (Accounts User) | دریافت/پرداخت، چک، دفتر کل/تراز/سود و زیان/ترازنامه، گزارش مالیات |
| فروشنده (Sales User) | مشتریان، سفارش فروش، فاکتور فروش، دریافت‌ها، گزارش فروش، مانده مشتری |
| انباردار (Stock User) | کالاها، اسناد انبار، موجودی کالا، کاردکس |
| مسئول خرید (Purchase User) | تأمین‌کنندگان، سفارش خرید، فاکتور خرید، گزارش خرید |

A separate workspace per role would duplicate targets; one public workspace +
permission-filtered shortcuts is the frappe-native IA. Re-evaluated after real user
feedback.

## 4. Quick Actions (§7)

Phase 4 scope: shortcuts open list views; frappe list headers provide the «+» create
affordance per permission. Dedicated quick-create dialogs (one-screen invoice/payment
forms) = Phase 6, built on standard REST + validators only (no bypass).

## 5. Non-goals

No new DocTypes, no dashboard fake data, no core navigation patches. Everything ships
inside `farda_iran` (setup ensure + css/js), upgrade-safe.
