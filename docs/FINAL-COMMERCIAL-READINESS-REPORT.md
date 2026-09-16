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
6. RTL/translation coverage — **PARTIAL**: 1,601 of 10,157 fa msgids still empty (§47 recount; earlier ~2,488 figure superseded); Portal/Login/Dialog RTL QA pending
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
- Performance: **pass executed** — see «2026-09-16 — §31» below. Migration rehearsal: PENDING (needs MariaDB/Docker = BLOCKED-ENV). No false claims.

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
| Cheque | ✅ PRESENT | DocType + TRANSITIONS + PE wiring (create_payment_entry/clear/revert) + reminders; R19 live E2E legal 2-step clear + revert (2 latent bugs fixed) |
| Payment | 🟡 PARTIAL | gateway adapter + security sandbox-verified (9/9); LIVE CREDS = BLOCKED-ENV |
| SMS | 🟡 PARTIAL | provider abstraction + OTP delivery path sandbox-verified; LIVE SMS = BLOCKED-ENV |
| OTP | ✅ PRESENT (sandbox) | hashed-only storage + TTL/cooldown + rate-limit, 6/6 live asserts |
| Invoice | ✅ PRESENT | real invoices + Persian RTL print: Sales A4 + Purchase A4 + Thermal 80mm (H7 9 + R15 4 live) |
| PDF | ✅ PRESENT | pure-Python Persian PDF (reportlab+Vazirmatn), text-layer verified |
| RTL | 🟡 PARTIAL | fa-scoped CSS live-tested; ~1,601 empty fa msgids remain |
| Reports | 🟡 PARTIAL | 7 Iranian reports live-tested (VAT/Cheque/Party/Purchase/Sales-Register + §48 General Ledger/Trial Balance); remaining: Stock Balance/Movement, Bank Report, Cash Flow, P&L, Balance Sheet presentation — NOT 100% |
| Security | ✅ PRESENT (Farda surfaces) | dedicated audit R16 5/5 live (guest surface, XSS-escaped formats, SQLi, PII, escalation matrix) + docs/SECURITY-AUDIT.md; framework security gates |
| Backup | ✅ PRESENT (restore-verified) | §25 R13 5/5: fresh-site restore + data identity + 160/160 on restored site (160 = §25-era suite size; canonical suite 2026-09-16 = 178) |
| Docker | 🟡 IMPLEMENTED-BUT-UNVERIFIED | §26 stack written; compose-spec schema-VALID; entrypoint config-phase runtime-proven on real Frappe v16 CLI; build/up = BLOCKED-ENV (no daemon) |
| CI/CD | ✅ PRESENT (pipeline) / 🟡 activation BLOCKED-ENV | 7-stage pipeline ALL GREEN in-repo (lint 0-findings, unit green — 160/160 at §27 date, canonical 178/178 as of 2026-09-16 — +JS, Gate-5+Iran live, wheel verified, bandit baseline); wrapper versioned for activation (CORE-002) |
| Tests | ✅ PRESENT | 178 unit + 131+ live asserts (R13–R22 همه idempotent) + migration rehearsal (fresh PG 8/8 زنجیره روی سایت بِکِر)؛ MariaDB rehearsal = BLOCKED-ENV |
| Monitoring | ✅ PRESENT (health layer) | guest /health: db/redis/workers/scheduler checks, exact payload contract, no secrets/PII (R17 4/4 live + sweep); LB-ready with 503 mapping |
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

## 2026-09-16 — §24 Audit log (append-only, R14 7/7 live)
- `Farda Audit Log` DocType (append-only): فقط System Manager read؛ هیچ create/write/delete
  برای هیچ نقشی؛ کنترلر ویرایش/حذف ORM را حتی برای Administrator می‌بندد؛ ثبت فقط از
  `farda_iran/audit/service.py` (fail-open: خطای ممیزی هرگز عملیات کسب‌وکار را نمی‌شکند —
  در error log می‌رود).
- چه چیزی ممیزی می‌شود (hooks CORE-005): Payment Entry submit/cancel · گذار وضعیت چک
  (Create + StatusChange old→new) · تغییر Farda VAT Settings (SettingsChange با old/new) ·
  تغییر داده‌های هویتی (farda_*/iban روی Customer/Supplier/Bank Account → IdentityChange).
- هر ردیف: موضوع، رویداد، old/new JSON، **user (owner)، timestamp (creation)، IP**.
- **Sanitizer** (۶ تست واحد + پوشش زنده): کلیدهای secret (password/token/key/otp/auth/
  merchant/hash/…) → `***`؛ کلیدهای هویتی → ماسک ۴ رقم آخر (مقدار کامل هرگز ذخیره
  نمی‌شود — در R14 اثبات منفی شد)؛ OTP plaintext هرگز (فقط hash؛ که هم ماسک می‌شود).
- **R14 7/7 زنده** (idempotent): سناریوهای بالا + Guest نمی‌خواند/نمی‌سازد + Administrator
  نمی‌تواند edit/delete کند + IP ثبتشده در بافت درخواست.
- **PG-14 کشف و شیم شد**: PE cancel روی PG سخت‌گیر خطای DatatypeMismatch می‌داد (upstream
  `delinked = True` بولین روی smallint — شاخهٔ Advance خود upstream عدد `1` می‌نویسد)؛
  کپی faithful با `1`؛ pg_compat اکنون ۱۳ شیم (PG-1..PG-14).
- رگرسیون کامل: Gate-5 13 + Iran 5 + Pay 9 + OTP 6 + Search 7 + Bank 7 + Pack 4 + Rep 5 +
  VAT 8 + Print 9 + Dash 6 + Audit 7 = **86 live asserts ALL PASS** · unit **166/166** +
  JS parity · pipeline 7/7 GREEN.

## 2026-09-16 — §28 Print formats: Purchase A4 + Thermal 80mm (R15 4/4 live)
- `Farda Persian Purchase Invoice` (A4 RTL): «صورتحساب خرید کالا و خدمات»، فروشنده=تأمین‌کننده
  با کد ملی/شناسه ملی/کد اقتصادی/کد پستی (فیلدهای farda_*)، خریدار=شرکت، شماره فاکتور
  فروشنده (bill_no)، ردیف‌ها، VAT با نرخ، مبلغ به حروف، مهر و امضا — همان سرویس‌های مرکزی
  (Toman/Jalali/words) فرمت فروش؛ کاهش VAT خودکار از سرویس مالیات.
- `Farda Thermal Receipt 80mm` (فروش): عرض محتوا 72mm (کاغذ ۸۰mm)، فونت ۱۱px، سربرگ
  فروشگاه با کد اقتصادی، ردیف‌های فشرده (کالا/تعداد/قیمت/جمع)، ردیف تخفیف فقط در صورت
  وجود، مالیات/قابل پرداخت/به حروف، پانویس تشکر — تاریخ جلالی.
- **R15 4/4 زنده** (idempotent، teardown کامل): همگام‌سازی استاندارد هر دو فرمت · خرید A4
  (RTL + شناسه‌های بردار معتبر ۲۴۰۰۵۶۷۸۹۰۷/۴۱۱۳۶۶۵۱۲۳۴۵ + VAT ۱۲٬۰۰۰ تومان + به حروف منطبق)
  · حرارتی (layout 72mm + ردیف‌های فشرده + ۱۳۷٬۵۰۰ تومان + بدون ردیف تخفیفِ خالی) · ردیف
  تخفیف دقیقاً با تخفیف واقعی (۵٬۰۰۰ تومان).
- رگرسیون: Print 9/9 + unit 166/166 + JS parity + pipeline 7/7 GREEN. جمع زنده: ۹۰ assert.

## 2026-09-16 — §29 Security audit pass (R16 5/5 live + docs/SECURITY-AUDIT.md)
- **XSS (یافته و بسته)**: Jinja فراپه `autoescape=False` دارد (اثبات‌شده) — هر ۴ فرمت
  چاپ حالا فیلدهای کاربر-کنترل (نام احزاب/کالاها/شناسه‌ها/bill_no/company) را با `| e`
  escape می‌کنند؛ نکتهٔ اولویت `(x or "-") | e` پرانتز شد (پیش از آن escape روی مقدار
  truthy اعمال نمی‌شد — همان چیزی که تست payload گرفت). R16 سه فرمت را با payload
  `<script>` رندر و HTML-escape را ادعا می‌کند.
- **Guest surface**: enumeration از مجموعه‌های فراپه — دقیقاً ۳ متد (OTP request/verify +
  payment verify)؛ هر انحراف آینده fail می‌شود.
- **SQLi**: payloadهای کلاسیک از APIهای جستجو → پارامترشده، جدول دست‌نخورده، ستون‌های
  حداقلی؛ سطح‌های SQL همه placeholder یا query-builder یا allowlist (نقشه در سند).
- **PII**: کلیدهای پاسخ OTP/payment-status حداقلی + sanitizer ممیزی (هویتی→۴ رقم آخر،
  secret→***)؛ OTP فقط hash؛ هیچ PAN/تلفنی در پاسخ‌ها.
- **Escalation matrix**: Farda Audit Log فقط SM-read؛ Cheque فقط نقش‌های Accounts؛
  VAT Settings فقط SM/Accounts Manager؛ برای Guest هیچ.
- رگرسیون پس از تغییر فرمت‌ها: Print 9/9 + R15 4/4 + unit 166/166 + JS parity — جمع زندهٔ
  امنیتی/چاپ: **95 assert**. (CSRF تصمیم مستند: گیت فریم‌ورک برای session‌های authed؛
  endpointهای guest با توکن یک‌بارمصرف + بررسی مبلغ محافظت می‌شوند.)

## 2026-09-16 — §30 Monitoring/health (R17 4/4 live)
- `erpnext.farda_iran.monitoring.api.health` — GET، مهمان‌خوان (برای LB/uptime)،
  rate-limit ۶۰/دقیقه، unhealthy → HTTP 503 از طریق mapping فریم‌ورک.
- چک‌ها (fast/read-only): db (SELECT 1) · redis (PING روی queue+cache با timeout 2s) ·
  workers (رجیستری RQ فراپه) · scheduler (heartbeat فراپه)؛ کش ۵ ثانیه‌ای برای هموارسازی
  پرس‌وجوی انبوه.
- **قرارداد payload (ادعا شده با تست):** فقط {status, checks, durations_ms} (+failed در
  وضعیت ناسالم)؛ مقادیر = ok/fail + میلی‌ثانیه. **بدون secret/PII** — sweep تضمین می‌کند
  هیچ host/cred/port/نسخه/نام کاربری در payload نیست.
- fail-open: مرگ وابستگی‌ها → status unhealthy + فهرست failed؛ endpoint هرگز raise
  نمی‌کند (اثبات با قطع برنامه‌ای workers/scheduler).
- نکتهٔ محیطی صادقانه: در sandbox دایمون worker/scheduler اجرا نمی‌شود → آن دو چک «fail»
  صحیح گزارش می‌شوند (M2 همین مسیر را تست می‌کند)؛ در استک Docker §26 هر دو سرویس واقعی‌اند
  و healthcheckها می‌توانند همین endpoint را مصرف کنند.
- **گیت drift سطح guest (R16) به‌روزرسانی شد**: سطح guest حالا دقیقاً ۴ متد است (OTP×2 +
  payment verify + health probe)؛ هر surface جدید = FAIL آگاهانه.
- رگرسیون: unit 166/166 + JS parity + R16 5/5 + pipeline 7/7 GREEN (lint گیر F401 خودش را
  هم گرفت و بست). جمع زنده: **۹۹ assert**.

## 2026-09-16 — §31 Performance pass (R18 5/5 live + docs/PERFORMANCE.md)
- **ممیزی ایستای N+1** (AST: کوئری داخل حلقه، کد غیرتستی): `tax/service._get_exempt_flags`
  batch واقعی بود (false positive — یک get_all با `in`)؛ **N+1 واقعی در `cheque/reminders`**
  پیدا و بسته شد — یک EXISTS به‌ازای هر چک → یک کوئری batch از جفت‌های (چک، کاربر)
  اطلاع‌داده‌شده؛ insert فقط برای جفت‌های دیده‌نشده؛ اجرای دوم = صفر ردیف (در R18 ادعا شده).
  مسیرهای سرد (install/migrate) پذیرفتنی و مستند.
- **گاردهای عملکرد بودجه‌دار در کد** (اجرا در هر pass کل CI): search ×25 میانگین 2.0ms ·
  insert SI با VAT+ممیزی بیشینهٔ 295/میانگین 140ms · KPIها 13ms · رندر چاپ 24ms · ۴ گزارش
  هرکدام ≤1.2s · audit.record 5ms · dedupe یادآورها 78ms.
- **ایندکس ترکیبی ممیزی** (subject_doctype+subject_name) با ensure_audit_index روی
  install+before_migrate (idempotent؛ در R18 ادعا شده).
- docs/PERFORMANCE.md: جدول ممیزی ایستا + بودجه‌ها + روش (بازتنظیم بودجه = ویرایش آگاهانه
  در کد، هرگز با حذف).
- رگرسیون: Pay/Audit/VAT زنده سبز + unit 166/166. جمع زنده: **۱۰۴ assert**.

## 2026-09-16 — §32 E2E breadth (R19 8/8 live — ONE Iranian order-to-cash chain)
- زنجیرهٔ پیوستهٔ سر‌تا‌سر روی سایت واقعی: مشتری با کد ملی معتبر (+سطر audit Create) →
  Bank Account از شبا با اتصال خودکار بانک ملی (رجیستری) → SO→DN→SI با VAT ۱۰٪
  (grand ۲٬۲۰۰٬۰۰۰ IRR + GL) → رندر چاپ فارسی (کد ملی + ۲۲۰٬۰۰۰ تومان) → درگاه
  sandbox با transport تزریقی از طریق endpointهای whitelisted واقعی (start→verify→ACCEPT
  → PE submit → outstanding=0 + audit) → چک دریافتی: create_payment_entry → PE submit →
  وصول قانونی دو‌مرحله‌ای (Received→Deposited→Cleared + ۲ سطر audit) → PE cancel → برگشت
  به Received → انعکاس در Sales Register/VAT Report/Party Balance/KPIs + سلامت db/redis.
- **دو باگ نهان در سیم‌کشی چک↔PE کشف و بسته شد**:
  1. گذار مستقیم Received/Returned→Cleared با TRANSITIONS ناسازگار بود (validate
     می‌شکست) — حالا پیشروی قانونی پله‌به‌پله با یک سطر audit به‌ازای هر پله؛
  2. `create_payment_entry` بدون نرخ ارز/`paid_to_account_currency` و بدون fallback
     حساب بانک/صندوق بود (MandatoryError) — نرخ ۱ برای IRR، fallback بانک→صندوق، خطای
     فارسی اگر هیچ.
- **بهداشت بین‌تستی**: پیشوند authority یکتا (FAKEE2E) + پاک‌سازی سطرهای Farda Payment Log
  در ابتدا/انتهای اجرا (خود‌شفاما) — دیگر تداخلی با payments_runtime (FAKEAUTH) رخ
  نمی‌دهد؛ PR برای بالابردن موجودی قبل از DN (الگوی gate5).
- idempotent ×3 متوالی سبز؛ رگرسیون payments/audit/unit 166/166 + pipeline 7/7 GREEN.

## 2026-09-16 — §33 Notifications (R20 6/6 live ×3 idempotent)
- شش تریگر با دادهٔ واقعی: cheque_due (واگذاری به reminders بهینه‌شدهٔ R18) · low_stock
  (Item Reorder × Bin) · invoice_overdue (فاکتور واخورده با مانده) · payment_received/
  payment_failed (Farda Payment Log) · approval_pending (پیش‌نویس راکد).
- دو کانال: اِین‌اپ (Notification Log، کاربران مالی + fallback Administrator، dedupe
  همیشگی per (doctype,name,user) با خواندن دسته‌ای — قانون N+1) و **پیامک** از طریق
  abstraction موجود (resolve از env؛ گیرندگان env-only با پشتیبانی ارقام فارسی/+98؛
  بدنهٔ یکدست «[FardaERP] برچسب: موضوع»؛ یک ارسال به‌ازای هر رویداد NEW — ledger داخلی
  نقش dedupe پیامک را هم دارد).
- SMS زنده = BLOCKED-ENV (بدون اعتبارنامه) — کانال با provider ضبط‌کننده اثبات شد.
- hooks.daily ← notifications.service.run (CORE-007)؛ normalize_ir_mobile به هستهٔ
  pure validators منتقل شد (provider بازنشر می‌کند).
- regression: R18 perf / R19 / payments / audit همگی سبز؛ unit 171/171؛ pipeline 7/7.

## 2026-09-16 — §34 API namespaces (R21 7/7 live ×3 idempotent)
- چهار dispatcher یکپارچه با قرارداد پاکت واحد: `farda.tax/party/bank/reports` —
  registry pure به‌عنوان تک‌منبع حقیقت (اکشن‌ها/نقش‌ها/allowlist گزارش‌ها/کدهای خطا).
- کدهای خطای دقیق: VALIDATION/NOT_FOUND/FORBIDDEN/RATE_LIMITED/UNKNOWN —
  traceback هرگز برنمی‌گردد (log_error)، Guest پیش از نقش رد می‌شود، نقش‌ها per-namespace.
- `farda.reports.run` فقط گزارش‌های فردا (allowlist=دیسک، تست unit تطبیق) + پنجرهٔ
  لغزنده ۳۰/۶۰ثانیه؛ `calculate_vat` با نرخ پیش‌فرض قابل‌تنظیم و نرخ صفر.
- سطح guest تغییر نکرده (R16 مجدد سبز)؛ سطح فقط‌خواندنی — mutation ها در لایهٔ model
  با audit trail. قرارداد کامل: docs/API-NAMESPACES.md.
- unit 175/175؛ pipeline 7/7؛ R20/آماریت/امنیت regression سبز.

## 2026-09-16 — §35 Feature flags (R22 6/6 live ×3 idempotent)
- رجیستری مرکزی ۷ فلگ سطح‌سیستم (sms/otp/payment/vat/banking/cheque/reports) در
  `flags/{core,service}.py` — core کاملاً pure (واژگان، نام فیلدها، پارسِ ۰/۱/on/off/ارقام فارسی).
- ذخیره‌سازی: ۷ فیلد Check روی System Settings (farda_enable_*، پیش‌فرض روشن) با
  ensure_flags ای‌دمپوتنت در install.py؛ خواندن fail-open (پیش‌ازmigrate=روشن)؛
  مقدار ۰ صریحِ ادمین هیچ‌وقت بازنویسی نمی‌شود.
- سیم‌کشی واقعی: flags.sms کانال پیامک notifications را قطع می‌کند (خاموش ⇒ صفر
  فراخوانی provider — اثبات زنده)؛ bootinfo `modules` وضعیت را به Desk می‌برد؛
  فلگ‌های نمایشی site_config (jalali/toman) دست‌نخورده.
- unit 178/178؛ pipeline 7/7؛ R19/R20/R21 regression سبز.
- **با این فاز، سه ردیف HIGH MISSING ماتریس صفر شد** (Notifications §33 · API
  namespaces §34 · Feature flags §35) — فقط BLOCKED-ENVها و گیت نهایی باقی است.

---

# 🚦 CURRENT-FINAL GATE VERDICT — 2026-09-16 (§36 / §41 نقطهٔ پایان قابل‌اجرای sandbox)

## FINAL_STATUS: **NOT COMMERCIAL READY** — دقیقاً به‌سبب ۵ بلاکر محیطی زیر؛ هیچ بلاکرِ کدی باقی نیست.

| # | بلاکر | نوع | گشایش |
|---|---|---|---|
| 1 | MariaDB 10.6 production-like validation | BLOCKED-ENV | docker daemon / باینری mariadb در sandbox نیست (G-MDB) — قرارداد تکرار: docs/MIGRATION-REHEARSAL.md §5 |
| 2 | Docker stack build/up (IMPLEMENTED-BUT-UNVERIFIED) | BLOCKED-ENV | همان daemon؛ گیت docs/DOCKER.md §7 |
| 3 | اعتبارنامهٔ واقعی درگاه پرداخت | BLOCKED-ENV | stop-and-ask کاربر؛ sandbox اثبات‌شده |
| 4 | اعتبارنامهٔ واقعی SMS | BLOCKED-ENV | stop-and-ask کاربر؛ abstraction اثبات‌شده |
| 5 | فعال‌سازی GitHub CI (workflow آماده) | BLOCKED-ENV | تنظیمات repo/runner بیرون از sandbox؛ pipeline درون‌ریپو 7/7 GREEN |

## شواهد پایانی (این تاریخ)
- unit **178/178** + JS parity ALL PASS · pipeline **7/7 GREEN** (lint/compile/security/build)
- زنده: R3 5/5 · R4 9/9 · R5 6/6 · R13 5/5 · R14 7/7 · R16 5/5 · R17 4/4 · R18 5/5 ·
  R19 8/8 · R20 6/6 · R21 7/7 · R22 6/6 — همگی idempotent (×3) — جمع **131+ assert**
- **migration rehearsal**: re-migrate سایت دارای داده PASS · fresh-install PASS با
  زنجیرهٔ کامل R19 8/8 روی سایت بِکِر · ۳ حفرهٔ واقعی کشف/بسته شد
- **docs freeze**: ماتریس/گزارش‌ها همگام با همین کامیت؛ تنها تغییرات مجاز آینده:
  نتایج گیت‌های BLOCKED-ENV پس از گشایش محیط، یا اصلاح ناشی از آن‌ها.

**مسیر تا COMMERCIAL READY**: گشایش Docker (بند 1–2) → اجرای rehearsal روی MariaDB →
اعتبارنامه‌های زنده (بند 3–4) با stop-and-ask → فعال‌سازی CI (بند 5) → به‌روزرسانی همین
جدول و ثبت FINAL_STATUS جدید.

**زنجیرهٔ الزامی آمادگی (COMMERCIAL READY فقط با سبز بودن کل زنجیره، نه صرفاً رفع ۵ بلاکر):**

`Code → Unit → Integration → MariaDB → Docker → Fresh Install → Migration →
Backup/Restore → Payment Live → SMS Live → GitHub CI → Security → Production Smoke →
Commercial Readiness`

## 2026-09-16 — §47 Production Verification (fresh sandbox, verify-not-rebuild)

Full battery re-executed after a complete sandbox re-bootstrap: pipeline 7/7 GREEN
(unit 178/178 + JS parity), 21 runtime suites PASS, idempotency ×3 on payments/VAT/
audit/performance/order-to-cash/notifications, re-migrate 0 errors.

- **Bugs found by verification: 2 — both fixed & regression-proven (commit 4016290):**
  1. CODE-BUG `flags/service.py` — fresh installs shipped all 7 kill-switches OFF
     (Check column reads 0, NULL-guard never fired) → seeds ON for fields it creates;
     admin-set 0 preserved (virgin-path + preservation tests PASS).
  2. TEST-BUG R21 — customer from R19 assumed; now self-seeded (order-independent).
- **Gates 1–5: ALL BLOCKED-ENV** (Docker daemon, MariaDB binaries, live payment creds,
  live SMS creds, GitHub `workflows` scope — exact push-rejection message recorded).
  Local validations that COULD run, ran: compose-spec schema VALID (8 services),
  workflow YAML parse + stage order + no-secrets PASS, bandit clean vs baseline,
  pg_compat db_type guard verified, secrets/PII/OTP-plaintext greps clean.
- **Translations: 10,157 total / 1,601 empty msgids** (counted; not functional failures).
- **FINAL_STATUS unchanged: NOT COMMERCIAL READY — 5 environmental blockers, 0 open
  code bugs.** Evidence: docs/PRODUCTION-VERIFICATION-REPORT.md.
- **Documentation Reconciliation (2026-09-16T21:00:48Z):** single canonical snapshot applied across README /
  Gap Matrix / Production Verification Report / Final Report / CI-CD: code snapshot `4016290`
  (last code-affecting commit; everything after is docs-only), authoritative HEAD = branch tip,
  canonical unit count **178/178** with 160/160 and 166/166 labeled as dated suite-growth
  checkpoints (not subsets), reconciliation timestamp unified. Dated phase-log entries keep
  their original figures as historical evidence.
- **Post-verification doc fixes:** upstream ERPNext README replaced with the FardaERP product
  README (CORE-008) — reviewer-identified top documentation gap; RTL & Reports rows corrected
  to PARTIAL (no 100% claims); GATE 5 hard evidence extended: Contents-API
  `.github/workflows?ref=arena/01a0a51f-fardaerp` → **404** (no executable workflow on the
  branch; upstream workflows exist on `main` only).

### 📌 وضعیت یک‌نگاهی — Reviewer consensus (2026-09-17)

| بُعد | وضعیت |
|---|---|
| CODE | 🟢 عمدتاً آماده — ۰ باگ بازِ شناخته‌شده |
| LOCAL/PG runtime | 🟢 شواهد گسترده و regression شده (unit ۱۷۸/۱۷۸ · ۲۱ سوئیت · ×3 idempotent) |
| DOCUMENTATION | 🟢 Documentation Reconciliation انجام شد (snapshot واحد) |
| RTL | 🟡 PARTIAL — ۱٬۶۰۱/۱۰٬۱۵۷ msgid خالی + QA Portal/Login/Dialog مانده |
| Reports | 🟡 PARTIAL — ۵ گزارش ایرانی تست‌شده؛ GL/TB، Stock، Bank، CashFlow، P&L، BS باقی |
| Docker | 🟡 آماده — runtime واقعی اثبات نشده (BLOCKED-ENV) |
| MariaDB | 🟠 نیازمند اجرای واقعی (G-MDB) |
| Payment Live | 🟠 نیازمند credential واقعی (G-PAY) |
| SMS Live | 🟠 نیازمند credential واقعی (G-SMS) |
| GitHub Actions | 🟠 نیازمند مجوز `workflows` (G-GCI) |
| Commercial Release | 🔴 هنوز نه |

**گام بعدی توافقی:** بستن ۵ گیت محیطی به محض دسترسی + تکمیل هم‌زمان RTL (batch ترجمهٔ بعدی + QA پورتال/لاگین/دیالوگ) و گزارش‌های ایرانی باقی‌مانده — بدون بازکاری روی featureهای اثبات‌شده (verify-not-rebuild همچنان حاکم است).

## 2026-09-16 — §48 Reports batch 1: Farda General Ledger + Farda Trial Balance

- Two new Script Reports (Farda Iran module, roles SM/AM/AU, read-only parameterized SQL,
  Jalali/Toman via central services, zero core changes): **Farda General Ledger** (rows +
  running balance + company-wide balanced totals) و **Farda Trial Balance** (opening/period/
  closing per account + root_type filter).
- REPORT_ALLOWLIST extended 5→7 (unit test asserts disk match); bandit baseline regenerated
  for the 2 new reviewed B608s (same parameterized pattern).
- **Runtime-verified on a fresh-drop site** (PG 18.4): R48 2/2 PASS ×3 idempotent; pipeline
  7/7 (unit 178/178); pack R11 + R21 namespaces + VAT regression PASS.
- TEST-BUG class fixed: SI-creating suites (integration, pack) now self-seed selling Price
  List + Fiscal Year — fresh-site independent, no mid-run death/leak.
- Re-bootstrap note: sandbox reset again; runtime rebuilt from recipes with two recipe
  refinements (see session docs): sqlite3.h sed must yield UNQUOTED version number, and
  pkg-config shim must parse "mod >= ver" as one spec; _ctypes via system libffi.so.8 +
  generated headers (consumer ffi.h needs no fficonfig).
