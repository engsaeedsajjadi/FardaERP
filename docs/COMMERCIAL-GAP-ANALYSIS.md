# FardaERP — Commercial Gap Analysis

> Created 2026-09-15 (master completion prompt §4). Living document — update per phase.
> Scope: full repository audit vs. the **Commercial Definition of Done** (§5 of the master brief).
>
> **Statuses:** `PRESENT` (implemented + real test evidence) · `PARTIAL` (exists, incomplete/untested) ·
> `MISSING` (not started) · `BLOCKED-ENV` (cannot validate in current sandbox — no Docker daemon /
> no MariaDB / no external credentials) · `N/A`
>
> **Priorities:** `CRITICAL` = blocks commercial use · `HIGH` = blocks v1 launch · `MEDIUM` = v1.x · `LOW` = later

## 0) Executive summary

| Area | Status | Priority | Evidence / Note |
|---|---|---|---|
| ERPNext v16.34.2 baseline | **PRESENT** | — | tree byte-identical to upstream tag `v16.34.2`; G1 gate PASS (docs/VERSIONS.md §5) |
| Frappe v16.33.1 compatibility | **PRESENT** | — | G2 PASS; real bench runtime PASS (G5) |
| HRMS v16.18.1 | **PRESENT** | — | G5 HRMS step PASS (Employee/Dept/Leave/Attendance real insert+submit) |
| Runtime proof (auth→company→docs→GL→reports) | **PRESENT** | — | **G5 = 13/13 PASS** on Python 3.14 + PostgreSQL 16.2 + Redis 7.4.1, tag `fardainerp-gate5-pass` |
| farda_iran module | **PARTIAL** | CRITICAL | only `tests/` exists (smoke harness + PG compat). No business subpackages yet |
| Jalali central service | **PRESENT (core)** | CRITICAL | `farda_iran/jalali` service + 24 unit tests PASS (49/49 suite) — UI/report hooks still MISSING |
| IRR/Toman central service | **PRESENT (core)** | CRITICAL | `farda_iran/currency` service + 18 unit tests PASS; UI display layer on invoices/reports still MISSING |
| VAT configurable architecture | **PRESENT (core)** | CRITICAL | `Farda VAT Settings` + service wired to real invoices; 5 integration tests PASS on live site (net 1,000,000 → total 1,100,000 + GL). Missing: templates UI, tax category matrix, reports |
| Iranian Party fields | **PRESENT (core)** | HIGH | custom fields + official-algorithm validators on Customer/Supplier/Company; integration PASS. Missing: UI sections polish, Address province/city |
| Persian text normalization + search | **PRESENT (core)** | HIGH | `farda_iran/utilities/normalization` + 7 unit tests PASS; search-index integration still MISSING |
| Banking / IBAN | **PARTIAL (core)** | HIGH | IBAN→bank-code registry (Satna codes), Luhn card check, IR IBAN validator; site fields/UX pending |
| Cheque management | **PARTIAL (core)** | HIGH | `Cheque` DocType (دریافت/صدور + ۶ وضعیت + گذارهای قانونی + سررسید query); site test + Payment wiring pending |
| Payment gateway abstraction | **PARTIAL** | HIGH | policy engine + 3 adapters + Farda Payment Log + whitelisted start/verify/status + PE builder; E2E 9/9 on live site (idempotency/replay/amount-tamper); 124 unit tests; **LIVE CREDENTIAL VALIDATION PENDING** |
| SMS provider abstraction + OTP | **PARTIAL** | HIGH | OTP engine + Farda OTP Log + guest endpoints (E2E 6/6 live: cooldown/replay/exhaust); SMS providers (env-only creds); **LIVE SMS VALIDATION PENDING** |
| Persian invoice print / PDF | **PARTIAL (runtime-tested)** | HIGH | Farda Persian Invoice (Jinja, RTL, Toman, Jalali, کد ملی, VAT row, مبلغ به حروف) + pure-Python Persian PDF renderer (Vazirmatn OFL, reshaper+bidi) — E2E 9/9 live incl. PDF text layer; frappe weasyprint path needs system pango (Docker image will provide) |
| RTL / Persian UX | **PARTIAL** | HIGH | Jalali/Toman Desk display layer (JS parity-tested); RTL stylesheet via app_include_css (fa-scoped) live-tested; fa audit tooling + 122 translations; more batches pending |
| Reports (Jalali/Toman/Persian) | **PARTIAL** | HIGH | Farda Sales Register (Script Report: Jalali dates, Toman amounts, Persian digits, جمع row, date filters) E2E 5/5 live; remaining upstream reports still Gregorian/IRR |
| Dashboards (real data) | **MISSING** | MEDIUM | no Iranian KPI dashboards |
| CRM / Stock / Manufacturing localization | **PARTIAL** | MEDIUM | upstream features PRESENT (core v16); Persian/Jalali/Toman layer MISSING |
| API surface (farda services) | **MISSING** | HIGH | none of currency/jalali/tax/bank/cheque/otp APIs exist |
| Notifications (cheque due, low stock …) | **MISSING** | MEDIUM | upstream notification infra PRESENT; Iranian triggers absent |
| Security hardening | **PARTIAL** | HIGH | Frappe framework security PRESENT; Farda-specific audit (§31) NOT RUN |
| Audit log | **PARTIAL** | MEDIUM | Frappe Activity/Version logs PRESENT; payment/cheque/tax audit trail MISSING |
| Backup / Restore | **PARTIAL** | HIGH | bench backup/restore exists (framework); Farda scripts + tested restore MISSING |
| Docker production | **MISSING** | CRITICAL | no Dockerfile/compose in repo. **DOCKER VALIDATION PENDING** (sandbox has no daemon) |
| CI/CD | **MISSING** | HIGH | upstream workflows intentionally dropped (commit `d418e3d`); FardaERP pipelines NOT yet created |
| Test architecture (unit/integration/E2E) | **PARTIAL** | HIGH | G5 smoke (13 steps) PRESENT; unit suites for services MISSING until this phase |
| Monitoring / health checks | **MISSING** | MEDIUM | nothing Farda-specific |
| Docs set (§49) | **PARTIAL** | HIGH | VERSIONS.md, CORE-CHANGES.md, PHASE-0/1 docs PRESENT; the rest MISSING |
| Upgrade / sync strategy | **PRESENT** | — | docs/VERSIONS.md §3 policy (version-16 only, 5 gates) |
| License / trademark compliance | **PRESENT** | — | GPL-3.0 preserved; attribution intact; not presented as official Frappe product |

## 1) Detailed gaps (CRITICAL / HIGH first)

### CRITICAL

| # | Feature | Current | Missing | Required implementation | Files | DB | API | UI | Tests | Security | Migration | Readiness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Jalali central service | **PRESENT (core service + tests)** | UI/date-picker/report hooks, REST endpoint | `farda_iran/jalali/` pure-Python service (to/from/format/parse/leap/fiscal) + doc-type hooks for display | `erpnext/farda_iran/jalali/*` | none (DB Gregorian) | REST `farda.jalali.*` | date pickers/format v2 | roundtrip+leap+boundary unit suite | none | none | 0% |
| C2 | IRR/Toman monetary service | **PRESENT (core service + tests)** | display integration in docs/reports/UI, REST endpoint | `farda_iran/currency/` single-source ratio + conversion + rounding + formatting | `erpnext/farda_iran/currency/*` | none | REST `farda.currency.*` | Toman display layer | financial integrity suite (1T=10R, rounding, neg, large) | none | none | 0% |
| C3 | VAT configurable | **PRESENT (core service + live invoice test)** | Tax Category/Template matrix, exemption certificates, VAT return report | Tax architecture on upstream Item Tax/Tax Category + Iran defaults (10%) — configurable, never hardcoded | `erpnext/farda_iran/tax/*` | custom fields/templates via fixtures | none new | tax rows on invoices | invoice tax math suite | rate-change audit | fixtures install | 0% |
| C4 | Production Docker | MISSING | Dockerfile, compose, healthchecks, pinned images | frappe-docker based pinned build + compose (mariadb/redis/backend/workers/scheduler/socketio/nginx) + healthchecks | `docker/`, `docker-compose.yml` | none | none | none | build+smoke | secrets via env only | none | 0% — **DOCKER VALIDATION PENDING** |
| C5 | farda_iran foundation subpackages | PARTIAL | currency/jalali/tax/banking/… all absent | create on-demand per feature (no empty dirs — repo rule) | per feature | — | — | — | — | — | — | 10% (tests only) |

### HIGH

| # | Feature | Current | Missing | Required implementation | Files | DB | API | UI | Tests | Security | Migration | Readiness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| H1 | Iranian party fields + validation | **PRESENT (core + hooks + tests)** | UI grouping, Address province/city, duplicate-national-ID policy | custom fields + validators on Company/Customer/Supplier (+ Address state/city) | `farda_iran/customer/`, `supplier/`, `company/` | custom fields (fixtures, additive) | validation via doc API | form sections (fa labels) | validator unit tests | PII handling rules | additive only | 0% |
| H2 | Persian normalization/search | **PRESENT (core service + tests)** | search-index integration | `farda_iran/utilities/normalization.py` + search hooks | utilities | none | fold API | live-search behavior | normalization suite | none | none | 0% |
| H3 | Banking + IBAN | **PRESENT (core utilities + tests)** | Bank Account custom fields, bank registry DocType, reconciliation | `farda_iran/banking/` validators + Bank Account extensions | banking | additive fields | validate API | bank forms | IBAN vector tests | bank data sensitivity | additive | 0% |
| H4 | Cheque lifecycle | **PRESENT (DocType + transitions)** | site integration test (env rebuild), PE wiring, cheque book, reminders scheduler | `farda_iran/cheque/` DocTypes (Cheque, Cheque Book) + workflow + reminders | cheque | new doctypes (isolated) | REST + hooks | list/form/workflow | lifecycle integration tests | status-transition perms | new tables | 0% |
| H5 | Payment gateway abstraction | MISSING | interface + adapters (ZarinPal/IDPay/NextPay) + sandbox + verify/refund + idempotency | `farda_iran/payments/` provider pattern, secrets from env only | payments | payment log doctype | callback endpoints (CSRF-safe, signature) | redirect/callback pages | sandbox adapter tests (recorded), replay/mismatch tests | §17 requirements (idempotent, auditable, replay-safe) | none | 0% — **LIVE CREDENTIAL VALIDATION PENDING** |
| H6 | SMS abstraction + OTP | MISSING | providers (Kavenegar/Melipayamak/FarazSMS), OTP hash+expiry+rate-limit+audit | `farda_iran/sms/`, `farda_iran/otp/` | sms/otp | OTP log doctype (hashed codes) | send/verify endpoints (rate-limited) | login/verify UI | unit + rate-limit tests | hash storage, cooldown, max attempts | new table | 0% — **LIVE SMS VALIDATION PENDING** |
| H7 | Persian invoice/PDF/print | **PARTIAL** | A4 sales-invoice done (RTL/Toman/Jalali/words/VAT); thermal 80mm variant + purchase variant + more doctypes pending | `farda_iran/invoice/` + `print_format/farda_persian_invoice/` + fonts + `invoice/pdf.py` | printing | none | PDF endpoint (existing) + reportlab renderer | print formats | E2E 9/9 (HTML assertions + PDF text layer via pdfminer) | none | none | ~60% |
| H8 | RTL/Persian UX | **PARTIAL** | RTL css shipped (fa-scoped); Farda Sales Register Persian report done; fa.po batches + more doctype translations pending | translation audit+fill, RTL stylesheet, Persian report | `farda_iran/` + translation files + report | none | none | everything | E2E 5/5 live (report+RTL asset) + msgid audit | none | none | ~35% |
| H9 | FardaERP API surface | MISSING | versioned REST for currency/jalali/tax/bank/cheque/otp | whitelisted methods under `farda_iran/api/` | api | none | all listed | none | API integration tests | authz + rate limit | none | 0% |
| H10 | CI/CD | MISSING | ci.yml (lint→compile→tests→security→build), docker.yml | GitHub Actions compatible with this repo (workflows permission already resolved by dropping upstream ones) | `.github/workflows/` | none | none | none | pipeline green run | secret scanning | none | 0% |
| H11 | Backup/Restore scripts | PARTIAL | tested scripts + retention + restore proof | `scripts/backup.sh`, `scripts/restore.sh` + docs + a real restore test | scripts/ | n/a | n/a | n/a | restore test on smoke site | backup encryption option | none | 30% (bench native) |

### MEDIUM / LOW (summary)

- M1 Reports layer (Jalali/Toman wrappers for TB/GL/SOA/Stock/VAT report) — 0%
- M2 Dashboards (manager/sales/warehouse/finance, real data only) — 0%
- M3 Notifications triggers (cheque due, low stock, approval) — 0%
- M4 HRMS Iran extensions (شماره ملی/شبا/بیمه/مالیات حقوق — configurable rules) — 0% (core HRMS works)
- M5 CRM/Stock/Manufacturing Persian/Jalali/Toman alignment — depends on C1/C2
- M6 Monitoring (health endpoint, Sentry/Prometheus optional providers) — 0%
- M7 Performance audit (indexes, N+1, slow reports) + regression tests — NOT RUN
- M8 SaaS/feature-flag layer (enable/disable jalali/toman/sms/otp/payment) — 0%
- L1 AI/provider abstraction, PWA/offline, accessibility pass — 0%

## 2) Dependency graph (§65)

```text
Jalali(C1) ─┬─> Reports(M1) ─> Dashboards(M2)
            ├─> Invoice/PDF(H7)
            └─> HRMS-IR(M4)
Currency(C2)─┬─> VAT(C3) ─> Invoice/PDF(H7) ─> Financial reconciliation tests
             ├─> Reports(M1)
             └─> Banking(H3) ─> Cheque(H4) ─> Payment(H5) ─> Reconciliation
Normalization(H2) ─> Search/UX(H8)
SMS(H6) ─> OTP(H6) ─> Notifications(M3)
Docker(C4) ─> CI/CD(H10) ─> E2E gates
Party fields(H1) ─> Invoice/PDF(H7)
```

Build order used by phases: C1+C2 (pure services, no deps) → H2 → C3 → H1 → H3 → H4 → H6 → H5 → H7 → H8 → M1/M2 → C4/H10 → hardening/tests/docs.

## 3) Environment constraints recorded honestly

- **Docker daemon: NOT AVAILABLE** in this sandbox → all Docker gates = `DOCKER VALIDATION PENDING` until a runner exists.
- **MariaDB: NOT AVAILABLE** (only PostgreSQL 16.2) → G5 evidence is PG-based; MariaDB gate deferred to Docker phase.
- **Outbound network: allowlisted** (pypi/npm/github only) → payment/SMS live credentials cannot be validated here; adapters ship sandbox-validated.
- Upstream strict-PostgreSQL defects **PG-1..PG-12** are documented and shimmed at runtime only (`erpnext/farda_iran/tests/pg_compat.py`, postgres-only, auto-applied); MariaDB unaffected; upstream reports queued (P18).
