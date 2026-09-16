# FardaERP — Final Commercial Readiness Report (LIVING DOCUMENT)

> Created 2026-09-15 per the master completion prompt §69. This is an HONEST,
> continuously-updated report — it will say **NOT YET COMMERCIAL READY** until
> every gate has real evidence. Last update: 2026-09-15 (after Banking+Cheque phase).

## Verdict

# FardaERP NOT YET COMMERCIAL READY

## Architecture

- Single repo, package `erpnext` unchanged, isolated Iranian module `erpnext/farda_iran/`.
- Baseline: ERPNext v16.34.2 (tree byte-identical to upstream tag) · Frappe v16.33.1 · HRMS v16.18.1 (separate app).
- Backend currency **IRR** (integral Rials); Toman display via `farda_iran/currency` (1 Toman = 10 IRR, site-config overridable).
- Dates: DB Gregorian; Jalali via `farda_iran/jalali`.
- VAT: `Farda VAT Settings` (default 10%, configurable, effective-date, per-party exemption) applied on real invoices via hooks.
- Core changes: NONE to upstream code except: `modules.txt` (module registration, CORE-001) and **appended hooks** (CORE-003). Both recorded in docs/CORE-CHANGES.md.

## Implemented Features (with evidence)

| Feature | Evidence |
|---|---|
| Baseline & version integrity | Gates G1–G4 PASS (docs/VERSIONS.md §5) |
| Real runtime smoke (auth→docs→GL→reports) | **Gate 5 = 13/13 PASS**, tag `fardainerp-gate5-pass`, on Python 3.14 + PostgreSQL 16.2 + Redis 7.4.1 |
| Jalali central service | 24 unit tests incl. ~16k-day roundtrip + real anchors |
| IRR/Toman central service | 18 unit tests (ratio/rounding/negative/large/format) |
| Persian normalization/search fold | 7 unit tests |
| Iranian ID validators (کد ملی/شناسه ملی/شبا/کد پستی/کد اقتصادی) | 21 unit tests + live negative validation on site |
| Configurable VAT | 5 integration tests on live site: real SI, 10% tax row, totals, **GL entry**, exemption |
| Iranian banking utilities (IBAN→bank-code registry, Luhn card check) | unit tests (86/86 suite) |
| Cheque lifecycle DocType (دریافت/صدور، وصول، برگشت، deposoit، لغو + سررسید) | DocType + transition engine; integration test pending env rebuild |
| Upstream PostgreSQL defects | 12 documented runtime shims (PG-1..PG-12), queued for upstream report |

## Remaining Features (to Commercial v1)

1. Jalali/Toman **UI integration** (forms, date pickers, list/report columns, print)
2. Banking/IBAN + Cheque: **site integration tests** (blocked on env rebuild) + cheque↔Payment Entry wiring + reminders scheduler
3. SMS provider abstraction + OTP (hash/rate-limit/audit)
4. Payment gateway abstraction (ZarinPal/IDPay/NextPay) + security (idempotency/replay/amount-match)
5. Persian invoice print formats + Persian PDF pipeline (RTL fonts)
6. Full RTL/translation coverage (~2,488 empty fa msgids)
7. Iranian reports (VAT return, cheque status, aging) + dashboards (real data)
8. Security hardening audit + API surface + notifications
9. Backup/Restore scripts + tested restore proof
10. Docker production (pinned images, healthchecks) + **MariaDB validation** (currently NOT TESTED — PG-only evidence)
11. CI/CD pipelines (lint/compile/unit/integration/security/build)
12. E2E suite + performance pass + upgrade/migration rehearsal

## Test Results

| Suite | Result | Env |
|---|---|---|
| farda_iran unit suite | **86/86 PASS** | Python 3.11 sandbox (stdlib-only; 3.14 re-verify pending rebuild) |
| Gate-5 runtime smoke | **13/13 PASS** (twice, idempotent) | Python 3.14 + PG 16.2 + Redis 7.4.1 (before sandbox restart) |
| Iran integration (VAT+party) | **5/5 PASS** | live site `smoke.farda.local` (before sandbox restart) |
| Docker build/runtime | NOT RUN — **DOCKER VALIDATION PENDING** (no daemon) | — |
| MariaDB | NOT TESTED | needs Docker/runner |

## Security Results
- Negative permission tests PASS (Gate-5). OTP/payment/file-upload audit NOT YET PERFORMED (features pending). Secrets: none in repo (.env.example placeholders only).

## Docker / CI/CD / Performance / Backup-Restore / Migration Results
- NOT RUN / PENDING — see Remaining Features. No false claims.

## License & Trademark
- GPL-3.0 preserved; Frappe/ERPNext attribution intact; FardaERP not presented as an official Frappe/ERPNext product.

## Known Limitations
- PostgreSQL-only runtime evidence (MariaDB pending). 3.14 unit evidence pending env rebuild (tests are stdlib-only).
- 2026-09-15 sandbox restart wiped the local runtime (`/opt/fardabench`, venv314) and the local git clone; history recovered from GitHub (`b520244`). Runtime gates must be re-executed after the toolchain is rebuilt.

## Production Deployment Procedure
- PENDING — will be finalized with the Docker phase (pinned images, .env.example, healthchecks, backup/restore runbook).

## Area Status Table (§69)

| Area | Status | Evidence |
|---|---|---|
| ERPNext Core | ✅ PRESENT | G1 tree identity + Gate-5 |
| Frappe | ✅ PRESENT | v16.33.1 real runtime |
| HRMS | ✅ PRESENT | Gate-5 HRMS step |
| Iranian Localization | 🟡 PARTIAL | core services + VAT + IDs + banking utilities done; UI/report integration pending |
| Accounting | ✅ PRESENT | Gate-5 (COA/JE/GL/reports) |
| Toman | 🟡 PARTIAL | central service tested; UI layer pending |
| VAT | 🟡 PARTIAL | live invoice integration PASS; category/return-report pending |
| Jalali | 🟡 PARTIAL | core service tested; UI/pickers/reports pending |
| Banking | 🟡 PARTIAL | IBAN/bank-registry/card utilities + validators; Bank Account UI fields pending |
| Cheque | 🟡 PARTIAL | DocType + transitions; site test + PE wiring + reminders pending |
| Payment | ❌ MISSING | adapter architecture pending (LIVE CREDENTIAL VALIDATION PENDING) |
| SMS | ❌ MISSING | provider abstraction pending (LIVE SMS VALIDATION PENDING) |
| OTP | ❌ MISSING | hash/rate-limit/audit pending |
| Invoice | 🟡 PARTIAL | real invoices PASS in tests; Persian print format pending |
| PDF | ❌ MISSING | Persian RTL PDF pipeline pending |
| RTL | 🟡 PARTIAL | ~2,488 empty fa msgids; CSS/UX work pending |
| Reports | 🟡 PARTIAL | upstream reports PASS; Iranian (VAT/cheque/Jalali) pending |
| Security | 🟡 PARTIAL | framework security + negative tests; Farda audit pending |
| Backup | 🟡 PARTIAL | bench native; scripts+restore proof pending |
| Docker | ❌ MISSING | DOCKER VALIDATION PENDING |
| CI/CD | ❌ MISSING | pipelines pending |
| Tests | 🟡 PARTIAL | 86 unit + 18 smoke/integration PASS; E2E pending |
| Monitoring | ❌ MISSING | health endpoints/logs aggregation pending |
| Documentation | 🟡 PARTIAL | gap analysis, versions, phase reports; §49 set incomplete |
| Upgrade | ✅ PRESENT | sync policy documented (version-16 only, 5 gates) |

## 2026-09-15 — H7 Persian Invoice/PDF
- Farda Persian Invoice print format (Jinja, RTL): seller/buyer با شناسه‌ها، Toman+Jalali+Persian digits, VAT row, مبلغ به حروف — synced as standard Print Format on Sales Invoice.
- Jinja method exposure via hooks jinja.methods (CORE-CHANGES recorded).
- words.py: Persian number-to-words (0..10^15, official «یکصد» style) — 9 new unit tests (133 total).
- invoice/pdf.py: pure-Python Persian PDF (reportlab + arabic_reshaper + python-bidi + Vazirmatn OFL bundled) sharing the invoice façade with HTML.
- E2E live-site 9/9 PASS incl. PDF text-layer verification (pdfminer).
- ENV note: frappe's own weasyprint PDF needs system pango — absent in this sandbox; Docker image (DKR phase) must install pango for that path. Our renderer is independent of it.

## 2026-09-15 (نوبت دوم) — H8 RTL + گزارش فارسی + دستهٔ ۲ ترجمه
- RTL stylesheet (fa-scoped `html[lang="fa"]`) via app_include_css — live-tested (asset + scoping).
- Farda Sales Register (Script Report): Jalali dates, Toman+Persian digits+٬, جمع self-consistency, date filters — E2E 5/5 live.
- fa.po batch2: 121 curated translations (1,722→1,601 empty).
- FULL REGRESSION on live site (py3.14 + PG16.2 UTF8): unit 133/133 + JS parity + Gate-5 13/13 + Iran 5/5 + Payments 9/9 + OTP 6/6 + Print/PDF 9/9 + Reports 5/5.
- ENV rebuilt from scratch this turn via bootstrap_tools.sh + finish_env.sh (both rerun-safe, codeload/pypi-only); facts recorded in script headers.

## 2026-09-16 — Phase-0 REAL matrix + VAT completion (§5)
- docs/REAL-CURRENT-GAP-MATRIX.md: canonical audit-based status (30 features × 12 fields, exact statuses).
- VAT completion: pure HALF-UP planner (none/all_exempt/single/per_row), farda_vat_exempt on Item,
  per-row Actual VAT rows for mixed invoices (exempt lines carry zero), stale-row cleanup,
  standard Item Tax Templates (rate-synced from settings on every migrate),
  Farda VAT Report (sales+purchase, Jalali/Toman/Persian, totals, kind/company/date filters).
- R8 VAT live E2E 8/8 (custom rate 15%, 0%+cleanup, exempt item, mixed GL reconcile, purchase GL,
  effective date, report assertions incl. kind filter).
- Full regression on live site: unit 146/146 + JS parity + Gate-5 13/13 + Iran 5/5 + Payments 9/9
  + OTP 6/6 + Print 9/9 + Reports 5/5 + VAT 8/8 — ALL PASS.
- Fix recorded: Purchase tax rows require category=Total and add_deduct_tax='Add' (string);
  a falsy int made Purchase VAT post on the CREDIT side (GL imbalance) — caught by GL reconciliation test.

## 2026-09-16 — §10 search integration + §11 Bank Account integration
- Fold-at-rest: farda_search_key (fold_for_search) on Customer/Supplier/Item via validate hooks;
  canonical Persian letters in titles; idempotent backfill in setup (§29).
- search_party/search_item whitelisted APIs: fold-at-query + raw-LIKE legacy fallback;
  frappe.get_list (permissions), no PII, guest denied, 120/min per user.
- Bank Account: IBAN normalize+validate, registry bank get-or-create+auto-link,
  bank↔IBAN mismatch enforcement (Persian error), farda_card_number Luhn, resolve_iban API.
- Root-cause fixes recorded: banking/service.py relative import depth (.validators → ..utilities.validators);
  frappe v16 runs autoname BEFORE validate → IBAN hook also bound to before_insert;
  search endpoint fields include "name"; hooks cache needs clear-cache after hooks.py edits.
- R9 search 7/7 + R10 bank 7/7 live. Full regression: unit 157/157 + JS parity + Gate-5 13/13
  + Iran 5 + Payments 9 + OTP 6 + Print 9 + Reports 5 + VAT 8 — ALL PASS.
