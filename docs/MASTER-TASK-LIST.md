# FardaERP — Master Task List (Zero-Gap Enforcement)

> §45.5 of the master brief. Living document: statuses move only with real evidence.
> Legend: `DONE` (implemented+tested+documented) · `WIP` · `TODO` · `BLOCKED-ENV`
> **CODE > TEST > DOCUMENTATION** — statuses below reflect verified code state as of `f633704` + this phase.

## Verified baseline (2026-09-15)

- Repo `f633704` on `arena/01a0a51f-fardaerp`, clean worktree, pushed to GitHub.
- ERPNext v16.34.2 tree identity (G1 at `adc8f88`); later app-only deltas: `farda_iran/**`, `modules.txt` (CORE-001), `hooks.py` append (CORE-003), `.github/workflows` removal (CORE-002).
- 2026-09-15 sandbox restart wiped runtime (venv314/bench/PG/Redis). **Rebuild in progress this phase** — runtime re-verification queued before any runtime claim is renewed.

## Task register

| ID | Capability | Current Status | Files | Dependencies | Implementation Required | Tests Required | Security Required | DoD |
|---|---|---|---|---|---|---|---|---|
| ENV-1 | Toolchain restore | WIP | (env) | — | CPython3.14/OpenSSL/zlib/Redis/PG rebuild | n/a | n/a | unit suite green on 3.14 |
| ENV-2 | Bench+site restore (PG) | TODO | (env) | ENV-1 | frappe v16.33.1 + hrms v16.18.1 bench, site, migrate | Gate-5 13/13 rerun; Iran integration rerun; Cheque site test | n/a | all smoke green |
| C1-core | Jalali service | DONE | `farda_iran/jalali/` | — | — | 24 unit tests PASS (3.11; 3.14 re-run in ENV-1) | n/a | ✅ |
| C1-ui | Jalali UI integration | TODO→WIP | `farda_iran/ui/`, assets, hooks | C1-core, ENV-2 | bootinfo flags, client date formatters, list/report/print display, date-picker support | JS parity tests with Python service (real JS runtime via nodejs-bin wheel if installable; else BLOCKED-ENV recorded) | XSS-safe rendering | desk shows Jalali |
| C1-api | Jalali API | TODO | `farda_iran/api/` | C1-core | whitelisted convert/format endpoints | API tests | authz | endpoints PASS |
| C2-core | IRR/Toman service | DONE | `farda_iran/currency/` | — | — | 18 unit tests PASS | n/a | ✅ |
| C2-ui | Toman display layer | TODO | `farda_iran/ui/` | C2-core, C1-ui | currency formatter patch (IRR→Toman display), labels | formatter tests + screenshot-level manual | no rounding drift (assert ×10 exact) | UI shows Toman |
| C2-input | Toman input layer | TODO | `farda_iran/ui/` | C2-ui | explicit field-level input conversion w/ audit-safe rounding | financial integrity tests | exactness proof | input in Toman |
| C2-api | Currency API | TODO | `farda_iran/api/` | C2-core | endpoints | API tests | authz | PASS |
| C3-core | VAT config+service+invoice | DONE | `farda_iran/tax/`, `Farda VAT Settings` | — | — | 5 integration PASS (incl. GL) | account scoping | ✅ core |
| C3-ext | VAT templates/categories/returns | TODO | `farda_iran/tax/` | C3-core | per-item/category rates, exemption certs, VAT return report | calc matrix tests + report test | rate-change audit | full §8 |
| H1-core | Party fields+validators | DONE | `farda_iran/party.py`, `setup/` | — | — | 21 unit + integration PASS | PII policy | ✅ core |
| H1-ext | Address province/city + duplicate policy | TODO | `farda_iran/customer/…` | H1-core | province/city fields + dup-national-ID policy | dup tests | — | full §9 |
| H2 | Normalization/search | PARTIAL | `farda_iran/utilities/` | — | fold used in search hooks + duplicate detection | integration | — | full §10 |
| H3-core | Banking utilities | DONE | `farda_iran/banking/` | — | — | unit PASS | n/a | ✅ core |
| H3-ext | Bank Account fields/UX + registry DocType | TODO | `farda_iran/banking/` | H3-core, ENV-2 | fields on Bank Account, registry management | site integration | — | full §11 |
| H4-core | Cheque DocType+lifecycle | DONE (code) | `farda_iran/doctype/cheque/` | — | — | **site test BLOCKED on ENV-2** | transition perms | site PASS pending |
| H4-ext | Cheque↔PE wiring, books, reminders, reports | TODO | `farda_iran/cheque/` | H4-core, ENV-2 | PE link actions, scheduler reminder, reports | integration+workflow | perms | full §12 |
| H5 | Payment gateway abstraction | TODO | `farda_iran/payments/` | — | interface+ZarinPal/IDPay/NextPay adapters, sandbox mode, idempotency/replay/amount checks, logs | sandbox adapter tests + security tests | callback signature, secrets env-only | §13+§17 |
| H6 | SMS/OTP | TODO | `farda_iran/sms/`, `otp/` | — | provider interface+adapters, OTP hash/expiry/rate/attempt/audit | unit+integration (sandbox provider) | hash storage, rate limit | §14+§18+§19 |
| H7 | Persian invoice/PDF | TODO | `farda_iran/printing/` | C1-ui, C2-ui | RTL print format(s), Persian PDF font pipeline, QR | PDF rendering tests | — | §15/§20/§21 |
| H8 | RTL/fa coverage | PARTIAL | translations+CSS | — | fill ~2488 empty msgids (priority subset), RTL css | msgid audit script + manual | — | §16 |
| H9 | Farda API surface | TODO | `farda_iran/api/` | above cores | versioned whitelisted APIs + rate limit + pagination + error schema | API tests | authz/audit | §17/§29 |
| H10 | CI/CD | TODO | `.github/workflows/` | ENV-2 | ci.yml (lint/compile/unit/integration/security), docker.yml | pipeline run green | secret scan | §38/§39 |
| M1 | Iranian reports | TODO | `farda_iran/reports/` | C1-ui, C2-ui | VAT return, cheque status, party ledger (Jalali/Toman) | report tests | — | §19/§22 |
| M2 | Dashboards (real data) | TODO | `farda_iran/dashboards/` | M1 | 4 role dashboards | data tests | — | §23 |
| M3 | Notifications | TODO | `farda_iran/notifications/` | H4-ext, H6 | triggers (cheque due/overdue, low stock…) provider-based | trigger tests | — | §30 |
| M4 | HRMS Iran | TODO | `farda_iran/hrms/` | C1-ui | emp national ID/IBAN, jalali leave/attendance views, configurable payroll rules | integration | — | §24 |
| M5 | CRM/Stock/Mfg alignment | TODO | follows C1/C2 | C1-ui, C2-ui | Persian/Jalali/Toman consistency passes | per-module tests | — | §25-27 |
| M6 | Monitoring/health | TODO | `farda_iran/monitoring/` | ENV-2 | health endpoints, structured logs | health tests | — | §50 |
| M7 | Performance pass | TODO | — | M1/M2 | benchmarks, N+1 fixes | perf regression | — | §51 |
| M8 | SaaS/feature-flags | TODO | `farda_iran/saas/` | — | flags for jalali/toman/sms/otp/payment | flag tests | isolation review | §52/53 |
| L1 | AI/PWA/Accessibility | TODO | — | after core | provider abstractions only | — | — | §54/61 |
| SEC | Security audit | TODO | — | H5/H6/H9 | §28 checklist execution | security tests | — | §28/31/32 |
| BAK | Backup/Restore | TODO | `scripts/` | ENV-2 | backup.sh/restore.sh + **tested restore** | restore proof | optional encryption | §29/34 |
| DKR | Docker production | TODO | `docker/`, compose | — | pinned images, compose, healthchecks, .env.example | build+smoke **BLOCKED-ENV (no daemon)** | secrets env-only | §30/35/36 |
| CERT | Final gates A–Z | TODO | — | all | gate execution + evidence | full suite | — | §70 |

## Execution order now

`ENV-1 → ENV-2 → C1-ui+C2-ui → C1-api/C2-api → C3-ext → H1-ext/H2 → H3-ext/H4-ext → H5 → H6 → H7 → M1/M2 → H8 → H9 → SEC → BAK → DKR → H10 → E2E/M7 → CERT`
