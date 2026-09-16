# FardaERP — CI/CD (§27)

> **STATUS: pipeline IMPLEMENTED + fully executed in-repo (this sandbox); GitHub-hosted
> activation = BLOCKED-ENV** (CORE-002: the environment's GitHub credential cannot push
> `.github/workflows/` changes). The pipeline is versioned as code and proven by
> execution; activation is a one-file copy once a workflows-scoped token exists.

## 1) Design

- **Single source of truth: `scripts/ci/pipeline.sh`** — the same stages run locally
  and on GitHub. No pipeline logic lives in YAML.
- Upstream ERPNext workflows were removed (CORE-002) and are NOT restored blindly;
  this pipeline is FardaERP-specific (farda_iran-focused lint/security scope).

## 2) Stages

| Stage | What it does | Gate |
|---|---|---|
| `deps` | git/bash + py modules (yaml/jsonschema) present; prints toolchain | informational |
| `lint` | flake8 over `erpnext/farda_iran` + `scripts/` with **upstream `.flake8` code set** (parsed from `.flake8` and passed via CLI because the in-value comment is rejected by flake8≥7) **+ E117** (fork tab-continuation idiom — the ONE documented deviation); `bash -n` all shell scripts; YAML parse compose | zero findings |
| `compile` | `compileall` every farda module; **compose-spec official schema validation** of docker-compose.yml (when schema cached) | exit 0 |
| `unit` | 166-test frappe-free unit suite + JS-parity suite via real bench_helper on the live site | summary `N/N passed, 0 failed` + `JS parity tests: ALL PASS` |
| `integration` | Gate-5 smoke (13) + Iran integration (5) on live site | exit 0 (BLOCKED-ENV without runtime) |
| `security` | bandit `-ll` (medium+) against **reviewed baseline** `scripts/ci/bandit-baseline.json` — only NEW findings fail; current baseline = 17× B608 (SQL built exclusively from `frappe.db.escape`d/validated inputs or internal constants; negative/permission tests live) | no new findings |
| `build` | `pip wheel --no-deps` → wheel must contain `farda_iran` (+tax service); `docker build` when a daemon exists | wheel gate |

Exit semantics: PASS/BLOCKED-ENV → 0, FAIL → 1. `BLOCKED-ENV` is reported in the
summary, never silently swallowed, never counted as failure without a note.

## 3) GitHub activation (when credential allows)

```bash
cp scripts/ci/github-workflow.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml && git commit -m "ci: activate FardaERP pipeline"
```
The wrapper provisions mariadb:10.6 + redis:7.4.1 services, Python 3.14, Node 24,
bench 5.31 (+click 8.4.1 re-pin), then runs the SAME script stages. Integration on
GitHub additionally needs a provisioned site (command in the workflow comment).

## 4) In-repo execution evidence (2026-09-16)

Executed `bash scripts/ci/pipeline.sh all` in the sandbox — results recorded in
docs/FINAL-COMMERCIAL-READINESS-REPORT.md §27 section (lint/compile/unit/security/
build + integration against the live site) and summarized in the §40 delivery.

## 5) Lint cleanup shipped with this phase

24 real findings fixed (not suppressed): 1× F821 latent NameError (pg_compat
`formatdate`), unused imports/locals removed, 4× lambda→def, 3× one-line def
expanded, payments/api now passes the RESOLVED callback URL to the gateway,
dead `bank_account` lookup removed from cheque/payment_link. Remaining 659× E117
+ tab codes are upstream-ignored style codes (E117 added, documented above).

## 6) Execution evidence (final, 2026-09-16)

```
deps PASS · lint PASS · compile PASS · unit PASS · integration PASS · security PASS · build PASS
CI: ALL REQUESTED STAGES GREEN
```
- unit = 166/166 + «JS parity tests: ALL PASS»; integration = Gate-5 13/13 + Iran 5/5
  (live site); build = `erpnext-16.34.2-py3-none-any.whl` (5067 files, farda_iran +
  tax service + 3 Vazirmatn fonts verified inside).
- Full live regression re-run after the lint cleanup (each suite its own process):
  Gate-5 13 + Iran 5 + Pay 9 + OTP 6 + Search 7 + Bank 7 + Pack 4 + Rep 5 + VAT 8
  + Print 9 + Dash 6 = **79 runtime asserts PASS**.

## 7) Harness fix shipped with this phase (not an upstream bug)

`test_payments_runtime.run()` was missing `pg_compat.apply()` (shims are
per-process; standalone runs hit upstream's strict-PostgreSQL grouping in
`update_voucher_outstanding → QueryPaymentLedger`). Added with an explanatory
comment — matches the convention the other runtime suites already follow.
