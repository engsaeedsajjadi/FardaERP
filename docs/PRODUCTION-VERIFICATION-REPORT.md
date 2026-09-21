# FardaERP Production Verification Report

Per the "FardaERP Production Verification & Commercial Readiness" prompt (§42/§47):
the repository was **verified — not rebuilt** — in a production-like environment,
from a **fresh sandbox clone of `main` at b9c74011**, recovering the delivery branch
`arena/01a0a51f-fardaerp` (daf586c) via fetch + ff-merge, re-bootstrapping the full
runtime from documented recipes, and re-executing the complete test battery before
any changes were made.

Verification timestamp (this report): **2026-09-16T20:45:33Z**

> ### Canonical snapshot — Documentation Reconciliation (2026-09-16T21:00:48Z)
> - Branch: `arena/01a0a51f-fardaerp`. The authoritative HEAD is always `git rev-parse origin/arena/01a0a51f-fardaerp` — docs commits move it, so reports pin a **code snapshot** instead.
> - **Current code snapshot: `d08ad54`** — the latest code-affecting commit (reports completed at `5c7e84d`, translation batch 4 at `d08ad54`); commits after `d08ad54` are documentation-only (checked via per-commit `git diff --stat`).
> - **Canonical test counts (pipeline, 2026-09-16):** unit **178/178** = complete current suite + JS parity ALL PASS · pipeline **7/7** · 21 runtime suites · 131+ live asserts · sensitive suites ×3 idempotent. The older figures **160/160** (§25–§27 era) and **166/166** (§29–§36 era) are dated checkpoints of suite growth — NOT separate subsets and NOT current.
> - Point-in-time gate evidence keeps its original timestamps (§16); this reconciliation changes metadata only, no code.
> - **History vs Current (separation rule):** the environment facts and per-gate blocks in this
>   report are the **historical record of the 2026-09-16T20:45:33Z verification session** and are
>   deliberately NOT rewritten. The **only current-state statement is the Canonical snapshot
>   above** (code snapshot `4016290`; authoritative HEAD = branch tip). Section 16 is titled
>   accordingly. Do not mistake session-era metadata for the current tree.


---

## 1. Repository

| Item | Value |
|---|---|
| Upstream base | ERPNext v16.34.2 (tree-identical to adc8f88); Frappe v16.33.1; HRMS v16.18.1 |
| Branch | `arena/01a0a51f-fardaerp` — delivery chain b583cbe→…→daf586c **verified reachable & pushed**; code snapshot verified: **4016290** (last code-affecting commit; all later commits are docs-only — see Canonical snapshot above; authoritative HEAD = `git rev-parse origin/arena/01a0a51f-fardaerp`) |
| Isolation | `erpnext/farda_iran/` single-module home; `erpnext/patches.txt` contains **0** Farda entries (verified by grep) |
| Sandbox recovery | clone reset to b9c74011 by sandbox rebuild → fetch + ff-merge to daf586c → full runtime re-bootstrap (CPython 3.14, PG 16.2, Redis 7.4.1, bench 5.31.0, frappe+erpnext+hrms editable) → **7/7 pipeline GREEN re-proven before any edit** |
| Worktree integrity at close | `git status` clean; no temp/test artifacts in repo (all bench/sites/logs live outside the repo: /opt/fardabench, /tmp) |

## 2. Code Status

Verification-first outcome: **2 real bugs found by the battery — both fixed, both regression-tested, both committed (4016290).** Everything else on the verify-without-rebuild list was **re-verified PASS by execution** (not from docs):

- Localization (Jalali service/IRR-Toman central currency/normalization/party fields) — R3 5/5, R7, R9 PASS
- VAT (configurable, effective dates, exemption, item categories; **no hardcoded `0.10`/`/10` in business logic** — re-grepped PASS) — R8 PASS ×3
- Banking (IBAN MOD-97/card Luhn/cheque lifecycle+reminders+PE) — R10/R11/R12/R18 PASS; reminders dedupe proven on re-run
- Payment gateway abstraction (ZarinPal/IDPay/NextPay/Sandbox; creds env-only; sandbox failure-scenarios) — R4 PASS ×3
- OTP/SMS (hash-only storage, expiry, rate-limit, provider abstraction, kill-switch) — R5 6/6, R22 PASS
- Persian invoice/PDF/RTL — R2, invoice_print PASS
- Iranian reports, dashboard, monitoring, notifications dedupe, namespaced APIs, flags, security suites — all PASS
- pg_compat: **test-only isolation re-verified** — `apply()` refuses unless site `db_type == "postgres"` (pg_compat.py:907); production/MariaDB path untouched

## 3. Docker Gate — **BLOCKED-ENV**

- Environment/Command: `which docker` → not installed; `apt-get install docker.io` → apt blocked in sandbox; no daemon socket.
- **Local validation executed instead** (fresh, this session): `docker-compose.yml` (repo root, 8 services: backend, frontend, mariadb, redis-cache, redis-queue, scheduler, websocket, workers) **validates against the official compose-spec schema** (fetched from codeload.github.com/compose-spec/compose-spec, validated with jsonschema) → **PASS**. `bash -n` on `docker/entrypoint.sh` → **PASS**.
- Expected: image build + `compose up` with MariaDB 10.6. Actual: cannot run — **BLOCKED-ENV (no Docker daemon in sandbox)**. Sandbox success ≠ live verified.

## 4. MariaDB Gate — **BLOCKED-ENV**

- Environment/Command: `which mariadbd mysqld` → absent; `apt-get install mariadb-server` → `E: Unable to locate package` (apt blocked).
- Full production-like MariaDB E2E therefore not executable. The PG-based full-chain E2E (order-to-cash R19, reports R7, VAT R8, banking R10–R12) all PASS on PostgreSQL — **documented deviation, NOT claimed as MariaDB validation.**
- MariaDB-safety re-verified statically: pg_compat shims cannot activate on MariaDB (db_type guard, see §2); no Farda code in patches.txt; hooks-based integration only. Per prompt, ERPNext core untouched.

## 5. Payment Gate — **BLOCKED-ENV (live) / PASS (sandbox)**

- Live: no gateway credentials in environment (env-only policy) → live payment **NOT verified**, marked BLOCKED-ENV, never faked.
- Sandbox re-executed ×3: test_payments_runtime PASS ×3 (zero-amount rejection, unknown gateway, missing ref id, replay rejection, unknown authority, amount-tamper rejection, gateway-refusal path, PE idempotency).
- Timeout-path hardening verified in source: all HTTP calls wrapped with `requests` exception handling returning the FAIL policy envelope (grep-verified in gateways).

## 6. SMS Gate — **BLOCKED-ENV (live) / PASS (sandbox)**

- Live: no SMS provider credentials → live SMS **NOT verified**; flags.sms kill-switch OFF ⇒ zero sends by design (R22-proven).
- Sandbox: OTP suite R5 PASS (6/6: issue→verify, hash-only persistence, expiry, single-use, rate-limit, masked phone); notification abstraction PASS (R20 ×3 idempotent, no sends without creds).

## 7. GitHub CI Gate — **BLOCKED-ENV (credential) / PASS (local validation)**

- **Hard evidence this session:** committing `.github/workflows/ci.yml` (the §27 workflow, activation-ready) and pushing was **rejected by GitHub itself**: `! [remote rejected] … (refusing to allow a GitHub App to create or update workflow .github/workflows/ci.yml without workflows permission)`. The sandbox credential is a GitHub App token **without** `workflows` scope.
- Action taken: the workflow file was kept OUT of the pushed history (unpushed commit discarded before any push); `scripts/ci/github-workflow.yml` remains the activation artifact with updated triggers (push `main` + `arena/**`, PR, workflow_dispatch). **To activate:** provide a `workflows`-scoped credential or add the file via GitHub UI; then the first run should mirror the proven in-repo pipeline.
- Local validation (fresh): workflow YAML parses (yaml.safe_load), stage order checkout→setup→deps→lint→unit-note→integration-note→security→build verified, no secrets referenced (no `env:` secrets, no credentials in pipeline.sh).
- **Independent reviewer check reproduced via Contents API:** `GET /repos/engsaeedsajjadi/FardaERP/contents/.github/workflows?ref=arena/01a0a51f-fardaerp` → **404 Not Found** — the branch carries **no executable Actions workflow**; `.github/workflows` exists only on `main` (upstream Frappe CI leftovers, kept off this branch per CORE-002). Documentation alone is therefore NOT treated as a running workflow — GATE 5 stays BLOCKED-ENV until a workflows-scoped credential lands the file and a real green run exists.
- Status: **BLOCKED-ENV** (permission), not a code defect.

## 8. Security

- R16 security suite PASS (guest surface exactly 4 whitelisted methods; XSS vectors neutralized; SQLi parameters-verified; OTP hash-only; audit trail present; PII masking).
- R17 monitoring PASS — health/alert payloads contain no secrets and no PII.
- bandit: pipeline security stage PASS (baseline 17×B608 parameterized-SQL false positives, unchanged).
- Secrets scan (fresh grep): **no hardcoded api_key/merchant/secret/password in `erpnext/farda_iran/**`** — all credential reading is env-only. No `.env`, certs, or tokens in the tree.
- OTP plaintext leakage: store persists `code_hash` only (store.py grep-verified).

## 9. Performance

Re-executed with measurements (test_performance_runtime PASS ×3, this session):

| Vector | Budget | Measured |
|---|---|---|
| Search (bank) | <100ms | avg 2ms, worst 51ms (×25 queries) |
| Sales Invoice create | <800ms | ≤295ms |
| Dashboard KPIs | <200ms | 13ms |
| Persian print render | <300ms | 24ms |
| 4 Iranian reports | <3s each | ≤1.2s total |
| Cheque reminders (2nd run) | dedupe | 0 new |

## 10. Backup/Restore

R13 suite PASS: backup created → restore-verified (schema + data assertions on the restored copy). Per policy, "backup without restore verification = NOT verified" — this is **restore-verified**.

## 11. E2E

- **Iranian E2E breadth (R19)** PASS ×3: Company→Customer(NID)→Supplier(NID)→Item→Sales Order(VAT)→Sales Invoice→Payment Entry→reconcile→Persian PDF→reports→audit — all asserts green, no duplicate artifacts across runs.
- **Order-to-Cash** covered by the same chain on PostgreSQL. **On MariaDB: BLOCKED-ENV** (see §4) — not claimed.

## 12. Regression

- `pipeline.sh all`: **7/7 GREEN** (deps, lint, unit 178/178, integration, security, build + JS parity bundle). Re-run clean **after** both bug fixes.
- Runtime battery (single-run, this session): R2 gate5, R3 5/5, R4, R5 6/6, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22 — **ALL PASS**.
- **Idempotency ×3 on sensitive suites**: payments, VAT, audit, performance (incl. cheque-reminder dedupe), order-to-cash breadth, notifications — **PASS ×3 each**, zero duplicate artifacts.
- Re-`bench migrate` after battery: 0 errors.

## 13. Bugs Found

| # | Type | Component | Root cause | Impact |
|---|---|---|---|---|
| 1 | **CODE-BUG** | `erpnext/farda_iran/flags/service.py` `ensure_flags` | Singles do not inherit Custom Field defaults: a freshly created `Check` column reads `0` (not NULL), so the legacy `get_single_value(...) is None` guard never fired | Every **fresh install** shipped with all 7 subsystem kill-switches OFF → OTP/gateway/reports/etc. silently disabled on virgin sites |
| 2 | **TEST-BUG** | `test_namespaces_runtime.py` R21 | Required the chain customer created by R19 to already exist | Suite-order dependence → false failure in isolated runs |
| 3 | **DOCUMENTATION-GAP** | `erpnext/farda_iran/README.md` | Missing explicit non-affiliation/trademark disclaimer in the module readme | License/trademark gate incomplete |
| 4 | **ENV-BLOCKER (observation)** | Sandbox | Periodic sandbox reset wiped /opt tools + reset clone to b9c74011 | Required full documented-recipe re-bootstrap (completed); all baseline results re-proven post-recovery |

No UPSTREAM-COMPATIBILITY, CONFIG-BUG, DATABASE-BUG, or MIGRATION-BUG findings (migration rehearsal previously proven; re-migrate clean this session).

## 14. Bugs Fixed

| # | Fix | Commit | Test/Regression result |
|---|---|---|---|
| 1 | `ensure_flags` now seeds ON unconditionally for fields it creates in this run; an admin-set `0` on pre-existing fields is preserved | 4016290 | R22 PASS; targeted virgin-path test (field deleted → ensure_flags → ON) **PASS**; admin-0 preservation **PASS**; full battery + pipeline 7/7 PASS |
| 2 | R21 get-or-creates its customer (self-seed) | 4016290 | R21 PASS standalone and in full battery |
| 3 | Attribution & non-affiliation block added to `erpnext/farda_iran/README.md` | this commit | doc-only; no code impact |

## 15. Remaining Blockers

**FINAL_STATUS: NOT COMMERCIAL READY — 5 environmental blockers, 0 open code bugs.**

| Code | Blocker | Needed to clear |
|---|---|---|
| [G-MDB] | MariaDB 10.6 production-like validation (Gate 2 + E2E on MariaDB) | MariaDB available in CI/runner or sandbox with apt/docker |
| [IBU] | Docker image build + compose up (Gate 1) | Docker daemon |
| [G-PAY] | Live payment gateway validation (Gate 3) | Real merchant credentials (env-only) + owner authorization |
| [G-SMS] | Live SMS/OTP validation (Gate 4) | Real SMS provider credentials (env-only) + owner authorization |
| [G-GCI] | GitHub Actions activation (Gate 5) | `workflows`-scoped credential (exact rejection message recorded in §7) |

Each is a pure **Environment** blocker: no code change is possible in-sandbox that clears them, and none may be marked verified without execution ("Sandbox success ≠ Live verified").

## 16. Evidence — point-in-time historical record (session 2026-09-16T20:45:33Z; see Canonical snapshot for current state)

Per-gate blocks (Gate / Environment / Command / Expected / Actual / Status / Timestamp) — all fresh this session:

1. **Gate 1 Docker** · sandbox (no daemon) · `which docker` · build+up green · binary absent · **BLOCKED-ENV** · 2026-09-16T20:45:33Z. Local: compose-spec schema validation PASS (8 services); `bash -n entrypoint.sh` PASS.
2. **Gate 2 MariaDB** · sandbox (apt blocked) · `which mariadbd` + `apt-get install mariadb-server` · migrate+E2E green · binaries unobtainable · **BLOCKED-ENV** · 2026-09-16T20:45:33Z. Static: pg_compat db_type guard (line 907) verified; patches.txt 0 entries.
3. **Gate 3 Payment live** · sandbox (no creds) · R4 `.run` ×3 · live charge/verify · creds absent; sandbox PASS ×3 · **BLOCKED-ENV (live)** · 2026-09-16T20:45:33Z.
4. **Gate 4 SMS live** · sandbox (no creds) · R5/R22 `.run` · live send · creds absent; OTP sandbox 6/6; flags.sms OFF ⇒ 0 sends · **BLOCKED-ENV (live)** · 2026-09-16T20:45:33Z.
5. **Gate 5 GitHub CI** · sandbox (App token, no `workflows` scope) · `git push` with `.github/workflows/ci.yml` + Contents-API `…/contents/.github/workflows?ref=arena/01a0a51f-fardaerp` · green run on arena branch · push `! [remote rejected] … refusing to allow a GitHub App to create or update workflow … without workflows permission`; API on branch → **404** (workflow dir exists on `main` only, upstream leftover) · **BLOCKED-ENV** · 2026-09-16T20:45:33Z. Local: YAML parse + stage order + no-secrets PASS.
6. **Regression** · PG site smoke.farda.local · `pipeline.sh all` + 21 runtime suites + ×3 idempotency batch + re-migrate · all green · **ALL PASS** · 2026-09-16T20:45:33Z.
7. **Security** · R16/R17 + greps (secrets/PII/OTP-plaintext) + bandit stage · clean · **PASS** · 2026-09-16T20:45:33Z.
8. **Translations** · `translations/audit.py` · count · **total 10,157 · empty 1,601** (matches docs; empty msgids are gap-count items, not functional failures) · 2026-09-16T20:45:33Z.

## 17. Final Status

**Readiness chain (per reviewer — COMMERCIAL READY requires the FULL chain green, not merely the 5 blockers):**

`Code → Unit → Integration → MariaDB → Docker → Fresh Install → Migration → Backup/Restore → Payment Live → SMS Live → GitHub CI → Security → Production Smoke → Commercial Readiness`

Clearing the five §15 blockers un-pauses the chain at MariaDB/Docker/Payment/SMS/CI; every downstream link (fresh install, migration, backup/restore on MariaDB, production smoke) must then be **executed** before FINAL_STATUS can be revisited.

**NOT COMMERCIAL READY** — exclusively due to the five environmental blockers in §15. The codebase itself has **zero known open defects**: 178/178 unit, JS parity, 7/7 pipeline, 21/21 runtime suites (with ×3 idempotency on all sensitive paths), fresh-install migration rehearsal, and 2 verification bugs found-and-fixed with full regression. The moment MariaDB/Docker/live-payment/live-SMS/workflows credentials become available, each gate has a documented, activation-ready path — but each remains **unverified** until actually executed in that environment.
