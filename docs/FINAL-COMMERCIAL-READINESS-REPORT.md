# FardaERP — Final Commercial Readiness Report (LIVING DOCUMENT)

> Created 2026-09-15 per the master completion prompt §69. This is an HONEST,
> continuously-updated report — it will say **NOT YET COMMERCIAL READY** until
> every gate has real evidence. Last update: 2026-09-16 (after Backup/Restore §25).

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
| Docker build/runtime | NOT RUN — **DOCKER VALIDATION PENDING** (no daemon); compose file schema-valid, entrypoint config-phase proven | — |
| MariaDB | NOT TESTED | needs Docker/runner (G-MDB gate defined, docs/DOCKER.md §7) |

## Security Results
- Negative permission tests PASS (Gate-5). OTP/payment/file-upload audit NOT YET PERFORMED (features pending). Secrets: none in repo (.env.example placeholders only).

## Docker / CI/CD / Performance / Backup-Restore / Migration Results
- Backup/Restore: **IMPLEMENTED + RESTORE-VERIFIED** — see «2026-09-16 — §25» below.
- Docker stack: **WRITTEN + statically validated** — see «2026-09-16 — §26» below; `docker build/up` BLOCKED-ENV (no daemon).
- CI/CD: **pipeline IMPLEMENTED + executed ALL GREEN in-repo** — see «2026-09-16 — §27» below; GitHub activation BLOCKED-ENV (CORE-002).
- Performance / Migration rehearsal: NOT RUN / PENDING — see Remaining Features. No false claims.

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
| Payment | 🟡 PARTIAL | gateway adapter + security sandbox-verified (9/9); LIVE CREDS = BLOCKED-ENV |
| SMS | 🟡 PARTIAL | provider abstraction + OTP delivery path sandbox-verified; LIVE SMS = BLOCKED-ENV |
| OTP | ✅ PRESENT (sandbox) | hashed-only storage + TTL/cooldown + rate-limit, 6/6 live asserts |
| Invoice | ✅ PRESENT | real invoices + Persian RTL print format (H7), 9/9 live |
| PDF | ✅ PRESENT | pure-Python Persian PDF (reportlab+Vazirmatn), text-layer verified |
| RTL | 🟡 PARTIAL | fa-scoped CSS live-tested; ~1,601 empty fa msgids remain |
| Reports | ✅ PRESENT | Iranian VAT/Cheque/Party/Purchase/Sales-Register pack live-tested |
| Security | 🟡 PARTIAL | framework security + negative tests; Farda audit pending |
| Backup | ✅ PRESENT (restore-verified) | §25 R13 5/5: fresh-site restore + data identity + 160/160 on restored site |
| Docker | 🟡 IMPLEMENTED-BUT-UNVERIFIED | §26 stack written; compose-spec schema-VALID; entrypoint config-phase runtime-proven on real Frappe v16 CLI; build/up = BLOCKED-ENV (no daemon) |
| CI/CD | ✅ PRESENT (pipeline) / 🟡 activation BLOCKED-ENV | 7-stage pipeline ALL GREEN in-repo (lint 0-findings, unit 160/160+JS, Gate-5+Iran live, wheel verified, bandit baseline); wrapper versioned for activation (CORE-002) |
| Tests | 🟡 PARTIAL | 160 unit + 79 live asserts (post-§27 full regression); dedicated perf pass pending |
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

## 2026-09-16 — Iranian reports pack + PG-13 payment-ledger fix
- New standard reports (real data, Jalali/Toman/Persian digits, جمع rows, filters):
  Farda Purchase Register · Farda Cheque Report (days-to-due + معوق + Persian statuses)
  · Farda Party Balance (AR/AP outstanding + خالص دریافتنی−پرداختنی).
- R11 pack E2E 4/4 live — including a real PE submit reducing AR 1,000,000→600,000 IRR.
- **PG-13 (upstream-compat bug found by the new AR test):** payment-ledger outstanding query
  needed upstream's 4-key GROUP BY with MAX() for the rest; PG-strict full-column grouping
  split PLE rows (differing due_date) so invoice outstanding never updated on PE submit.
  Fixed in pg_compat (PG-13); full regression re-run ALL GREEN.
- Live totals this phase: unit 157/157 + JS parity + Gate-5 13/13 + Iran 5 + Pay 9 + OTP 6
  + Print 9 + Rep 5 + VAT 8 + Search 7 + Bank 7 + Pack 4 = 60 runtime asserts PASS.

## 2026-09-16 — §18 Dashboards (real data)
- collect_kpis: فروش/خرید (SI/PI در بازه)، سود دوره (GL Income−Expense)، دریافتنی/پرداختنی (outstanding)،
  VAT فروش/خرید (سطرهای مالیات واقعی با حساب تنظیمات)، مانده نقد و بانک (GL)، ارزش موجودی (Bin)، سفارش‌های باز.
- kpis_pure: payload با برچسب فارسی + رشتهٔ Toman — تبدیل نرخ فقط از سرویس مرکزی (تست مقایسه‌ای).
- farda_kpis endpoint: authed-only (not in guest_methods — negative test)، rate-limit ۶۰/min.
- Desk: ۵ Number Card عمومی (فروش/خرید/دریافتنی/پرداختنی/موجودی) + نمودار «فروش ماهانه» + Dashboard «فردا — مدیریت» — idempotent.
- R12 زنده ۶/۶: KPIها دقیقاً با SI (+VAT ۱٬۱۰۰٬۰۰۰) و PE جزئی (−۴۰۰٬۰۰۰) حرکت کردند.
- Live totals: unit 160/160 + JS parity + Gate-5 13/13 + Iran 5 + Pay 9 + OTP 6 + Print 9 + Rep 5
  + VAT 8 + Search 7 + Bank 7 + Pack 4 + Dash 6 = 66 runtime asserts PASS.

## 2026-09-16 — §25 Backup/Restore (restore-verified)
- `scripts/backup.sh`: bench-native `bench backup --with-files` (bench_helper از sites/) → staging
  `$FARDA_BACKUP_DIR/<site>/<YYYYMMDD-HHMMSS>/` شامل `site_config.json` (که bench هرگز بکاپ نمی‌کند)،
  رمزنگاری اختیاری AES-256-CBC/PBKDF2 روی آرتیفکت‌ها با `FARDA_BACKUP_PASSPHRASE` (پسوند .enc؛
  site_config عمداً plaintext می‌ماند)، `MANIFEST.sha256`، اشاره‌گر `LATEST`، حذف دایرکتوری‌های
  قدیمی‌تر از `FARDA_RETENTION_DAYS` (پیش‌فرض 30).
- `scripts/restore.sh`: decrypt اختیاری → `bench restore` (با root-creds از env) → استخراج هر tar
  فایل‌ها با `--strip-components 1` (tars بنچ مسیر `./<source-site>/…` دارند) → شیم `file(1)`
  (binutils در sandbox نیست؛ فراپه هنگام restore نوع فایل را با `file` می‌سنحید — در ایمیج Docker
  بستهٔ واقعی file نصب خواهد شد).
- **R13 E2E 5/5 زنده** (`erpnext/farda_iran/tests/test_backup_restore_runtime.py`), دو اجرای متوالی idempotent:
  1. BACKUP-OK + دایرکتوری فِیک 45روزه واقعاً حذف شد (retention) 2. MANIFEST.sha256 سالم + site_config.json
  در staging 3. RESTORE-OK روی سایت تازهٔ `verify.farda.local` (DB + 2 tar) 4. هویت داده: Customer نشانه‌دار،
  تعداد SI، Custom Fieldها و سه‌گانهٔ Farda VAT Settings روی سایت بازگردانی‌شده عیناً برابر 5. سوییت واحد
  **160/160 روی سایت بازگردانی‌شده** + JS parity.
- پاک‌سازی: DB/سایت تست drop و نشانه از سایت اصلی حذف شد (تأیید بعد از اجرا).
- قاعدهٔ «بکاپ بدون اثبات restore = تأییدنشده» با همین تست بسته شد: اثبات = بازگردانی کامل در سایت تازه.

## 2026-09-16 — §26 Docker production stack (written + statically validated; build BLOCKED-ENV)
- `docker/Dockerfile` (3 stages): builder (python:3.14-slim + node 24، frappe v16.33.1 +
  hrms v16.18.1 از tag پین‌شده + این ریپو به‌عنوان apps/erpnext + yarn build assets) →
  final (gunicorn + workers + scheduler + socketio؛ libmariadb3/pango/file(1)/procps؛ فونت
  Vazirmatn برای PDF) → frontend (nginx:1.27-alpine با assets پخته + قالب conf envsubst).
- `docker-compose.yml`: mariadb:10.6 (cnf utf8mb4) + redis-cache/redis-queue 7.4.1 +
  backend/workers/scheduler/websocket/frontend با healthcheck واقعی هر سرویس، depends_on
  سالم، نام volume مشترک sites (frontend برای /files). فقط فرانت پورت 80 منتشر می‌کند.
- `docker/entrypoint.sh`: ساخت اسکلت bench (apps.txt/common_site_config/config/pids) —
  idempotent، انتظار برای DB/redis با wait_tcp، RUN_MIGRATIONS=1 برای migrate یک‌باره.
- `.env.example` + `.gitignore ← .env` (CORE-004): رازها فقط env؛ هیچ secretی در ایمیج.
- **اعتبارسنجی بدون daemon:** فایل compose با اسکیمای رسمی compose-spec (jsonschema)
  معتبر؛ فاز config/wait واقعاً روی bench CLI 5.31.0 + Frappe v16.33.1 اجرا و ۶ کلید
  دقیق نوشته شد. سه باگ واقعی که همین اجرا پیدا/بست: (۱) `bench set-config -g` مسیر
  common_site_config را از cwd می‌گیرد → باید از sites/؛ (۲) فایل موجود را نمی‌سازد →
  bootstrap «{}»؛ (۳) `is_bench_directory()` به config/pids و logs نیاز دارد. همچنین
  تداخل پین click (bench 5.31 می‌خواهد ~=8.2، frappe v16 می‌خواهد ~=8.4) → Dockerfile
  بعد از نصب bench، click==8.4.1 را دوباره پین می‌کند (اثبات‌شده که bench با 8.4
  فرمان‌های frappe را لود می‌کند).
- `docs/DOCKER.md`: معماری، استقرار اول، new-site، migration، بکاپ/ری‌استور داخل استک،
  گیت G-MDB-1..5 برای MariaDB، پین digest، نکات امنیتی.
- **وضعیت صادقانه: IMPLEMENTED-BUT-UNVERIFIED — docker build/up اجرا نشده (sandbox بدون
  daemon). MariaDB validation همچنان BLOCKED-ENV (گیت G-MDB تعریف شد).**

## 2026-09-16 — §27 CI/CD pipeline (executed ALL GREEN in-repo)
- `scripts/ci/pipeline.sh` — تنها منبع حقیقت CI: ۷ مرحله deps/lint/compile/unit/integration/
  security/build با معنای خروجی صادقانه (PASS/BLOCKED-ENV/FAIL؛ خلاصهٔ مرحله‌ای).
- **اجرای نهایی: هر ۷ مرحله GREEN** — unit 160/160 + JS parity؛ integration = Gate-5 13/13 +
  Iran 5/5 روی سایت زنده؛ build = wheel واقعی `erpnext-16.34.2-py3-none-any.whl`
  (۵۰۶۷ فایل؛ farda_iran + tax service + ۳ فونت داخل wheel تأیید شد).
- lint: مجموعه‌کدهای `.flake8` آپ‌استریم از طریق CLI (کامنت داخل مقدار برای flake8≥7 نامعتبر
  است) + E117 به‌عنوان تنها انحراف مستند fork؛ **۲۴ یافتهٔ واقعی اصلاح شد** (۱× F821 خطای
  پنهان NameError در pg_compat، import/متغیر بلااستفاده، ۴× lambda→def، ۳× def تک‌خطی،
  callback حل‌شده به درگاه پاس داده شد، lookup مردهٔ cheque/payment_link حذف) → **۰ یافته**.
- security: bandit `-ll` در برابر baseline بررسی‌شده (`scripts/ci/bandit-baseline.json` =
  ۱۷× B608 — SQL فقط از ورودی‌های escape/validated؛ یافتهٔ NEW بلاک می‌شود).
- GitHub activation = **BLOCKED-ENV** (CORE-002: توکن این محیط اجازهٔ push فایل workflows
  ندارد) — wrapper کامل در `scripts/ci/github-workflow.yml` (mariadb:10.6 + redis 7.4.1
  serviceها + py3.14 + node24 + bench 5.31/click 8.4.1) با فعال‌سازی یک‌فایلی (§3).
- **رفع‌عیب هارنس**: `test_payments_runtime.run()` فاقد `pg_compat.apply()` بود (شیم‌ها
  per-process هستند) — اجرای مستقل به GroupingError سخت‌گیر PG روی payment-ledger
  می‌خورد؛ اضافه شد (کانونشن بقیه سوییت‌ها). رگرسیون کامل پس از پاک‌سازی: Gate-5 13 +
  Iran 5 + Pay 9 + OTP 6 + Search 7 + Bank 7 + Pack 4 + Rep 5 + VAT 8 + Print 9 + Dash 6
  = **۷۹ assert زنده ALL PASS**.
- docs/CI-CD.md (طراحی/مراحل/فعال‌سازی/شواهد) · VERSIONS §10 (پین‌های CI).
