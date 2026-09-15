# FardaERP — Iranian Localization Module ("Farda Iran")

This module is the **single, isolated home for all FardaERP-specific Iranian
localization code**, kept separate from upstream ERPNext core per the approved
Single-Repository architecture (docs/VERSION-BASELINE-AND-ARCHITECTURE.md).

## What belongs here

| Subpackage | Purpose | Phase |
|---|---|---|
| `jalali/` | Gregorian↔Jalali conversion layer (DB stays Gregorian; UI shows Jalali) | Phase 4 |
| `currency/` | IRR accounting + Toman display layer (1 Toman = 10 Rial, single source of truth) | Phase 5 |
| `persian/` | Persian text normalization (ي/ی, ك/ک, ZWNJ, Persian digits) + Persian-first search | Phase 3 |
| `banking/` | Iranian bank master data, IBAN (IR…) validation, cheque lifecycle | Phase 9 |
| `sms/` | SMS provider abstraction (Kavenegar, Melipayamak, …) + OTP | Phase 10 |
| `payments/` | Payment gateway abstraction (ZarinPal, IDPay, NextPay, Pay.ir, …) | Phase 11 |
| `tax/` | Iranian VAT (default 10%, configurable), withholding, Moadian (e-invoice) stubs | Phase 8 |
| `setup/` | after_install / bootstrap: fa language, provinces, banks, Iranian COA, fixtures loader | Phase 2+ |
| `tests/` | Localization, accounting and regression tests for everything above | all phases |

## Hard rules

1. **No upstream edits from here.** Any change to an upstream `erpnext`/`frappe`
   file must be minimal, justified, and logged in `docs/CORE-CHANGES.md`.
2. **Prefer hooks/fixtures/overrides** (`regional_overrides`, `doc_events`,
   custom fields, fixtures) over core patches — always.
3. **Database stays standard**: dates Gregorian (ISO), amounts in the company
   accounting currency (IRR). Jalali/Toman are **presentation-layer only**.
4. **No secrets** in this module — provider credentials live in password-type
   DocType fields / environment variables.
5. Every feature ships with tests under `farda_iran/tests/` before merge.

## Module identity

- `modules.txt` entry: `Farda Iran` → Frappe module path `erpnext/farda_iran`
  (Frappe scrubs the module name to the folder name).
- The technical package remains `erpnext` (upstream sync compatibility).
  Product branding is applied via `app_title`, UI, logo and docs only.

## Packages (implemented)

| Package | Purpose | Tests |
|---|---|---|
| `farda_iran/jalali/` | THE single Gregorian↔Jalali service (conversion/format/parse/leap). DB stays Gregorian. | `tests/test_jalali_service.py` (24 tests incl. ~16k-day roundtrip) |
| `farda_iran/currency/` | THE single IRR↔Toman monetary service (1 Toman = 10 IRR, site-config overridable). Storage = integral Rials. | `tests/test_currency_service.py` (18 tests) |
| `farda_iran/utilities/` | Persian text normalization / search fold (ي↔ی, ك↔ک, digits, ZWNJ). | `tests/test_normalization.py` (7 tests) |
| `farda_iran/tests/` | Gate-5 runtime smoke harness + PG compat shims + unit suites + runner | `tests/run_unit_tests.py` |

Run unit suites (no bench needed):
`python erpnext/farda_iran/tests/run_unit_tests.py`
or inside bench: `bench --site <site> execute erpnext.farda_iran.tests.run_unit_tests.run`
| `farda_iran/tax/` | Configurable VAT (default 10%) — `Farda VAT Settings` single + service; applies to real invoices via hooks; per-party exemption | `tests/test_integration_iran.py` (bench) |
| `farda_iran/party.py` | Iranian ID validators wired to Customer/Supplier/Company (کد ملی، شناسه ملی، کد اقتصادی، کد پستی، شبا) | `tests/test_validators.py` + integration |
| `farda_iran/utilities/validators.py` | Pure-Python official algorithms: national ID, legal ID, IR IBAN (MOD-97), postal code, economic code | 21 unit tests |
| `farda_iran/setup/install.py` | Idempotent custom fields + VAT defaults (runs on before_migrate) | integration test |
| `farda_iran/banking/` | IBAN→بانک (registry کدهای ساتنا)، اعتبارسنجی کارت (Luhn) | `tests/test_banking.py` |
| `farda_iran/doctype/cheque/` | چک ایرانی: دریافت/صدور، ۶ وضعیت با گذارهای قانونی، سررسید، اتصال PE | integration (pending env) |
| `farda_iran/ui/` + `public/js/` | Desk display layer: Jalali dates + Toman currency via bootinfo flags (formatters, feature-flag gated) | JS parity tests (node, 209 vectors) |
| `farda_iran/api/` | Whitelisted Jalali/currency conversion endpoints + sliding-window rate limiter | 4 unit tests (limiter) |
| `farda_iran/otp/` | OTP engine: salt+pepper SHA-256, TTL, max attempts, one-time, cooldown/hourly caps + Farda OTP Log + guest endpoints | 12 unit tests |
| `farda_iran/sms/` | SMS provider registry: Kavenegar/Melipayamak/Ghasedak/Console, env-only credentials | 11 unit tests |
| `farda_iran/payments/` | Payment policy engine (amount-mismatch/replay/duplicate) + ZarinPal/IDPay/NextPay adapters (sandbox) | 18 unit tests |
| `farda_iran/translations/` | fa.po audit + curated batches (empty-only fills) | audit script |
