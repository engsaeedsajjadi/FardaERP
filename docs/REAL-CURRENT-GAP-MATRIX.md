# FardaERP — REAL CURRENT GAP MATRIX (Phase 0, audit-based)

> Generated: 2026-09-16 · HEAD at audit: `5be7e40` · branch `arena/01a0a51f-fardaerp`
> Method: **source code + tests + runtime execution are the authority** (not older gap docs).
> Every row was verified by reading the actual files under `erpnext/farda_iran/`, `erpnext/hooks.py`,
> the test inventory, and by running the suites on a live Frappe v16 site (PostgreSQL 16.2 UTF8, Python 3.14).
>
> Status vocabulary (exact): `IMPLEMENTED` · `IMPLEMENTED-BUT-UNVERIFIED` · `PARTIAL` · `MISSING` · `BLOCKED-ENV`
>
> Runtime evidence legend:
> **R1** = unit suite 133/133 + JS parity ALL PASS (py3.14) · **R2** = Gate-5 smoke 13/13 on live site
> · **R3** = Iran integration 5/5 live · **R4** = Payments E2E 9/9 live · **R5** = OTP E2E 6/6 live
> · **R6** = Persian invoice/PDF E2E 9/9 live · **R7** = Reports E2E 5/5 live
> (all recorded 2026-09-15 on `smoke.farda.local`; the sandbox is ephemeral and the stack is
> rebuilt from `bootstrap_tools.sh` + `finish_env.sh`, which re-run every suite as step [7/7].)

---

## A) CORE ENGINES (pure, frappe-free)

| Feature | Status | Implementation files | Tests | Runtime evidence | API | UI | Database | Security | Migration | Production readiness | Remaining work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Jalali calendar service (g2j/j2g, leap, boundaries, parse, format, Persian digits) | **IMPLEMENTED** | `farda_iran/jalali/service.py` | `test_jalali_service.py` (18) — anchors 2025-03-21=1404/1/1, 2026-09-15=1405/6/24 | R1; live via print format + Sales Register (R6, R7) | `api/conversions.py::to_jalali, to_gregorian` (rate-limited) | Desk display layer `public/js/farda_ui.js` (bootinfo-gated) | n/a (DB stays Gregorian per policy) | read-only conversions | none needed (no schema) | READY | HRMS/payroll date display; Desk Jalali *input* picker; notifications formatting |
| IRR/Toman currency service (single source, HALF-UP, Persian separator «٬») | **IMPLEMENTED** | `farda_iran/currency/service.py` | `test_currency_service.py` (16) | R1; live print (R6) + report (R7) | `api/conversions.py::toman_to_irr, irr_to_toman, format_money` | Desk Toman display via bootinfo | site_config override key `farda_iran_irr_per_toman` | read-only | none needed | READY | dashboards/report coverage widening (tracked in rows 12–13) |
| Persian normalization (ی/ي، ک/ك، digits, whitespace, zero-width) | **PARTIAL** | `farda_iran/utilities/normalization.py` | `test_normalization.py` (15) | R1 | none | n/a | n/a | n/a | none | Utility ready | **REAL SEARCH INTEGRATION MISSING** (§10: normalize-before-store for Customer/Supplier/Item names, normalizing search endpoint). Utility alone is not integration |
| Iranian official-ID validators (کد ملی، شناسه ملی، شبا، کد پستی، کد اقتصادی) | **IMPLEMENTED** | `farda_iran/utilities/validators.py` | `test_validators.py` (27) | R1; live via party validate hooks (R3: invalid کد ملی/شبا rejected by real validate) | via party docs on save | party custom fields UI | custom fields on Customer/Supplier/Company | validate-time rejection | custom fields created idempotently in `setup/install.py` (before_migrate) | READY | mobile normalization field; province/city; duplicate National-ID policy |
| Iranian banking utilities (31-bank registry, IBAN→bank, card Luhn, Satna) | **IMPLEMENTED (utilities)** / **PARTIAL (integration)** | `farda_iran/banking/service.py` | `test_banking.py` (10) | R1 | none yet | none | **Bank Account doctype integration MISSING** | registry is static public data | none | Utility ready | Bank Account custom fields + validation + Payment Entry integration; reconciliation hook-in |
| VAT engine + item-level exemption + templates + report | **IMPLEMENTED** | `farda_iran/tax/service.py` + `tax/planner.py` (pure HALF-UP) + `report/farda_vat_report/` + Item Tax Templates (Farda VAT / Farda Exempt 0%, rate-synced on migrate) + `farda_vat_exempt` on Item/Customer/Supplier | `test_vat_planner.py` (13) + **R8 VAT live E2E 8/8** (custom 15% · 0%/off+stale-cleanup · exempt item · mixed per-row GL · purchase VAT GL · future effective date · report) | R3 + R8 | jinja invoice_totals | settings singleton + report UI | Farda VAT Settings + templates + Item field | account-company check; party/item exemption server-side | before_migrate ensure (idempotent) | READY | per-item-group tax categories (beyond per-item flag) — optional |
| Payment policy engine (amount-mismatch/replay/duplicate; logged-authority check) | **IMPLEMENTED** | `farda_iran/payments/core.py` (+ `persistence.py` Frappe store) | `test_payments_policy.py` (14) + live E2E R4 | R4 | `payments/api.py::start_payment, verify_payment, payment_status` | — | Farda Payment Log (authority unique = idempotency key) | guest-only verify; vague errors; transport-injection for tests | doctype synced on migrate | READY (engine) | refund capability; explicit timeout/expiry policy states |
| Payment gateway adapters (ZarinPal/IDPay/NextPay, sandbox, injected transport) | **IMPLEMENTED (sandbox)** / **BLOCKED-ENV (live)** | `farda_iran/payments/gateways.py` | R4 (request shapes via RecordingHTTP) | R4 | same as above | redirect URL returned by start_payment | — | env-only creds (ZARINPAL_MERCHANT_ID/IDPAY_API_KEY/NEXTPAY_API_KEY); constructing without creds raises | none | sandbox READY | **LIVE CREDENTIAL VALIDATION — BLOCKED-ENV** (no real credentials in sandbox; stop-and-ask rule) |
| OTP engine (hash+pepper, TTL, max attempts, one-time, cooldown/hourly caps) | **IMPLEMENTED** | `farda_iran/otp/core.py`, `otp/store.py` (FrappeStore → Farda OTP Log) | `test_otp_core.py` (11) | R5 (cooldown/replay/exhaust live) | `otp/api.py::request_otp, verify_otp` (guest, POST-only) | — | Farda OTP Log (hash-only; as_dict strips hash for non-writers) | pepper from env FARDA_OTP_PEPPER only; vague errors | doctype synced on migrate | READY (engine) | account-lock protection; per-IP limiting; audit trail beyond the log doctype |
| SMS provider abstraction (Kavenegar/Melipayamak/Ghasedak/Console) | **IMPLEMENTED (abstraction)** / **BLOCKED-ENV (live)** | `farda_iran/sms/provider.py` (+ normalize_ir_mobile) | `test_sms_providers.py` (9) | R5 (console provider live) | consumed by otp/api | — | — | creds env-only; console masks (*****+last4) | none | console READY | **LIVE SMS — BLOCKED-ENV**; FarazSMS provider; delivery-status callbacks |
| Persian number-to-words (0…10¹⁵, official «یکصد» style) | **IMPLEMENTED** | `farda_iran/invoice/words.py` | `test_invoice_words.py` (9) | R6 (words row on invoice+PDF) | jinja `money_words_irr`, `money_words_toman` | print formats | n/a | n/a | none | READY | — |
| Invoice formatting façade (fa digits, Toman, Jalali, words — single composition point) | **IMPLEMENTED** | `farda_iran/invoice/persian.py` | via R6 | R6 | jinja methods (hooks `jinja.methods`) | print formats | n/a | n/a | none | READY | — |
| Persian PDF renderer (reportlab+arabic_reshaper+python-bidi+Vazirmatn OFL) | **IMPLEMENTED (A4 Sales)** | `farda_iran/invoice/pdf.py`, `public/fonts/` (OFL included) | R6 (PDF magic + Vazirmatn embedded + pdfminer text layer) | R6 | function-level (called from server code) | — | n/a | n/a | fonts bundled in repo | READY (no workstation-only deps) | more doctypes/formats (row 10) |
| Sliding-window rate limiter (Redis) | **IMPLEMENTED** | `farda_iran/api/limiter.py` | `test_rate_limiter.py` (4) | R1 | used by conversions API | n/a | Redis counters | abuse guard | none | READY | apply to remaining public endpoints (otp/payments already have frappe/farda guards) |

## B) DOMAIN MODULES (Frappe-integrated)

| Feature | Status | Implementation files | Tests | Runtime evidence | API | UI | Database | Security | Migration | Production readiness | Remaining work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Iranian Party fields (Customer/Supplier/Company: نوع شخصیت، کد ملی، شناسه ملی، کد اقتصادی، کد پستی، شبا، معافیت VAT) | **PARTIAL** | `farda_iran/setup/install.py` (PARTY/COMPANY_FIELDS), `party.py` (validate hooks) | R3 (invalid IDs rejected live) | R3 | party docs standard API | custom fields in form | custom fields idempotent | validators centralized | before_migrate ensures | READY for current scope | Employee/Address/Contact fields; duplicate National-ID policy; mobile/tel fields; UI field-grouping |
| Cheque (DocType, lifecycle transitions, PE wiring, reminders) | **PARTIAL** | `farda_iran/doctype/cheque/`, `cheque/payment_link.py`, `cheque/reminders.py` | unit-tested transitions (in early suites) | **live E2E MISSING** (only PE submit/cancel hooks exercised indirectly via R2 chains) | `create_payment_entry` whitelisted (role-gated) | Desk doctype UI | Cheque doctype + PE link field | transitions+role gates on whitelisted builder | doctype synced on migrate | nearly READY | **live lifecycle E2E**; cheque report (row 12); permission matrix per transition; returned/holder flows |
| Payments runtime (start/verify/status, log, PE builder) | **IMPLEMENTED** | `farda_iran/payments/api.py` + persistence + Farda Payment Log | R4 | R4 | 3 whitelisted endpoints | log doctype read UI | Farda Payment Log | idempotent authority; policy rejects tamper/replay/unknown; guest only for verify | synced on migrate | READY (sandbox) | refund; expiry state machine; live gateways BLOCKED-ENV |
| Persian invoice print (A4 Sales: RTL/Toman/Jalali/IDs/VAT/به حروف) | **IMPLEMENTED** | `farda_iran/print_format/farda_persian_invoice/` + jinja methods | R6 | R6 | frappe print API | Print Format on Sales Invoice | none (render-time) | n/a | synced on migrate | READY | Purchase/Thermal/Quotation/PO/DN/Receipt formats |
| RTL/Persian UX (fa-scoped stylesheet; Desk display layer; translations) | **PARTIAL** | `public/css/farda_rtl.css` (hooks app_include_css), `public/js/farda_ui.js`, `translations/` audit+batch1+batch2 (1,601 empties remain) | R7 (asset+scoping live); JS parity harness | R7 | n/a | Desk CSS+JS | none | scoped `html[lang="fa"]` only | asset copy in setup | partial | Portal/login/dialogs RTL QA; remaining translation batches; digits in list views |
| Iranian Reports (Farda Sales Register: Jalali/Toman/Persian/جمع/filters) | **PARTIAL** | `farda_iran/report/farda_sales_register/` | R7 | R7 | Script Report API | Report in Desk | read-only query | report roles (SM/AM/AU) | synced on migrate | pattern READY | **13+ reports MISSING**: Purchase Register, GL, TB, AR/AP, Stock Balance/Movement, VAT Report, Cheque Report, Bank Report, Cash Flow, P&L, Balance Sheet (Iranian layer) |
| Notifications (cheque due reminders) | **PARTIAL** | `farda_iran/cheque/reminders.py` (daily scheduler) | none dedicated | none dedicated | Notification Log | notification centre | Notification Log rows | n/a | none | minimal | §22 triggers: low stock, invoice overdue, payment received/failed, approvals + SMS channel via provider abstraction |
| Farda API surface (conversions, OTP, payments, cheque-link; limiter; bootinfo flags) | **PARTIAL** | `api/conversions.py` (5 endpoints, throttled), `otp/api.py` (2, guest POST), `payments/api.py` (3), `cheque/payment_link.py` (1) | R1 limiter; R4/R5 endpoint-level | R4, R5 | see files | n/a | n/a | throttling + guest policy + role gates per endpoint | none | READY for current scope | §21 namespaces: `farda.tax.*`, `farda.party.*`, `farda.bank.*`, `farda.reports.*`; error-format convention; audit behavior docs |
| Feature flags (bootinfo: jalali_dates, toman_display) | **PARTIAL** | `farda_iran/ui/boot.py` | none dedicated | live via R6/R7 display toggles | bootinfo | JS reads flags | System Settings keys via `_flag` | n/a | none | partial | §32 central module-level flags (SMS/OTP/Payment/VAT/Banking/Cheque/Reports) |

## C) PLATFORM / PRODUCTION (all MISSING or BLOCKED — none exist in repo)

| Feature | Status | Implementation files | Tests | Runtime evidence | API | UI | Database | Security | Migration | Production readiness | Remaining work |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Dashboards (management/sales/warehouse/finance, real data) | **MISSING** | — | — | — | — | — | — | — | — | — | §18 KPI dashboards querying real ERP data |
| Security audit (dedicated, Farda-specific surfaces) | **PARTIAL** | negative tests embedded in R3/R4/R5 (replay, tamper, permission denial, guest policy) | embedded | R3/R4/R5 | — | — | — | — | — | — | dedicated audit pass + report: CSRF/XSS/SQLi/PII/escalation matrix; §23 checklist as executable tests |
| Audit log (payment/cheque/VAT-change/identity-data trail) | **MISSING** | (Farda Payment Log & Farda OTP Log are domain logs, not audit) | — | — | — | — | — | — | — | — | §24 auditable records incl. old/new values, user, ts, IP; no secrets/OTP plaintext |
| Backup / Restore | **MISSING** | — | — | — | — | — | — | — | — | — | `scripts/backup.sh`, `scripts/restore.sh`, retention, **restore verification** |
| Monitoring / health | **MISSING** | — | — | — | — | — | — | must not expose secrets/PII | — | — | health endpoint + db/redis/worker/scheduler checks; optional Prometheus/Sentry |
| Performance | **MISSING** | — | — | — | — | — | — | — | — | — | N+1/slow-report audit; perf regression tests on critical paths |
| Docker production stack | **MISSING** | — | — | — | — | — | MariaDB required for prod gate | secrets via env only | migration command in stack | — | §26 stack: backend/frontend/worker/scheduler/socketio/redis/mariadb, healthchecks, pinned versions |
| MariaDB production validation | **BLOCKED-ENV** | — | — | all runtime evidence is PostgreSQL 16.2 (documented deviation) | — | — | — | — | — | — | needs MariaDB binaries — apt mirrors blocked in sandbox; run inside Docker once built |
| CI/CD | **MISSING** | (upstream workflows deliberately removed; only to be replaced by FardaERP-compatible pipelines) | — | — | — | — | — | gate deploys on tests | — | — | §27 stages: compile/lint/unit/integration/security/build/docker/migration-gate |
| Migration strategy (idempotent, fresh+upgrade) | **PARTIAL** | `setup/install.py` (before_migrate ensure steps); `modules.txt` has Farda Iran; `patches.txt` has no farda entries (nothing needs one yet) | fresh install proven repeatedly (R2 after each rebuild) | R2 ×4 rebuilds | — | — | custom fields/doctypes idempotent | n/a | idempotent ensures | fresh READY | upgrade rehearsal from populated older state; patch harness; rollback notes |
| E2E breadth | **PARTIAL** | 5 live suites (payments/otp/print/reports/iran) + Gate-5 13 checks | R2–R7 | recorded 2026-09-15 | — | — | — | — | — | — | cheque lifecycle E2E; HRMS payroll E2E; notification E2E; portal/E2E browser layer |

## D) SEVERITY SUMMARY (honest, §36/§37 view)

| Severity | Items |
|---|---|
| **CRITICAL MISSING** | Docker stack · Backup/Restore · CI/CD · (MariaDB validation = CRITICAL **BLOCKED-ENV**) |
| **HIGH MISSING** | Dashboards · Audit log · Monitoring · VAT Report · Iranian report pack · Persian invoice formats (Purchase/Thermal) · normalization→search integration · item-level VAT |
| **HIGH PARTIAL** | Iranian Party completion · Banking→Bank Account integration · Cheque live E2E · API namespaces · HRMS Iran localization |
| **BLOCKED-ENV** | live payment gateway credentials · live SMS credentials · MariaDB binaries · frappe-weasyprint (system pango) — none of these are code gaps; each has a documented deterministic fallback already running |
| **STALENESS FIXES APPLIED** | older docs claiming invoice/print/reports MISSING were superseded (COMMERCIAL-GAP-ANALYSIS rows updated 2026-09-15); this matrix is now the canonical status source |

## E) EXECUTION ORDER FROM THIS MATRIX (§41)

1. ~~VAT completion~~ — **DONE 2026-09-16** (item-level + templates + report + R8 8/8; commit series after bdf923e)
2. Normalization→search integration (§10 directive)
3. Banking→Bank Account/Payment Entry integration
4. Iranian report pack (Purchase Register, GL, TB, AR/AP, Stock, VAT, Cheque, Bank)
5. Persian invoice formats (Purchase A4, Thermal 80mm)
6. Audit log → Notifications → API namespaces → Feature flags
7. Security audit pass → Performance → Backup/Restore → Monitoring
8. Docker (MariaDB) → CI/CD → migration rehearsal → E2E breadth → **final gate**
