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
