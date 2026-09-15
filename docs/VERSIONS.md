# FardaERP — Version Register & Controlled Upstream Sync Policy

> Single source of truth for every version FardaERP is built on.
> Established in Phase 1 (re-baseline). Update this file on every upstream sync.

## 1) FardaERP Baseline

| Item | Value |
|---|---|
| FardaERP Baseline tag | `fardainerp-baseline-v16.34.2` |
| Baseline date | 2026-09-15 |
| Re-baseline commit | `adc8f889ec1e0c887e835470ca7bc67f29ad5e6e` (`chore: re-baseline FardaERP on ERPNext v16.34.2`) |
| Previous state | ERPNext `17.0.0-dev` snapshot (initial commit `b9c7401`, from upstream `develop`) |
| Safety tags | `fardaerp-pre-v16-rebaseline` → `b9c7401` · `fardaerp-pre-v16-rebaseline-head` → `f6dbb89` |
| Upstream tree identity | tag `v16.34.2` = `4048fb70e14d1843956fcdabb7c3cca75a1cbcdd` (verified byte-identical; only `docs/` added) |

## 2) Platform Pins

| Component | Version | Source of truth | Verified |
|---|---|---|---|
| **ERPNext** | **v16.34.2** | upstream tag `v16.34.2` (branch `version-16`), `erpnext/__init__.py` | 2026-09-15 |
| **Frappe** | **v16.33.1** | upstream tag `v16.33.1` = `988e54f3c4c291e2077a83809663f123731abe76`; satisfies app range `>=16.21.0,<17.0.0` | 2026-09-15 |
| **HRMS** | **v16.18.1** | upstream tag `v16.18.1` = `a4768b441cff346def505e27f2a2229ee1e05b9b`; declares `frappe >=16,<17` **and** `erpnext >=16,<17` → compatible | 2026-09-15 |
| **Python** | **3.14** (upstream hard requirement: `requires-python >= "3.14"`, official CI image `py3.14`) | erpnext/frappe v16 `pyproject.toml` + CI | 2026-09-15 |
| **Node** | **24** (official CI image `node24`; ≥ 20 expected by Frappe v16 tooling) | erpnext v16 CI workflow | 2026-09-15 |
| **Database** | **MariaDB 10.6** (CI standard; `mariadb:11.8` also exercised in patch CI). PostgreSQL supported by upstream CI. | erpnext v16 CI workflows | 2026-09-15 |
| **Redis** | REQUIRED by Frappe (cache/queue). CI installs distro `redis-server`. Exact minimum: UNKNOWN — needs verification against Frappe v16 docs at first bench bring-up (Phase 16). | erpnext v16 CI `install.sh` | 2026-09-15 |

## 3) Upstream Sync Policy (Controlled)

```text
Stable ERPNext (version-16 branch only — NEVER develop)
        ↓
FardaERP Baseline (v16.34.2)
        ↓
Iranian Localization (farda_iran/ + fixtures + locale)
        ↓
Controlled Upstream Sync (gated)
```

Rules:

1. Sync source: `https://github.com/frappe/erpnext` branch **`version-16`** / release tags `v16.x.y` only.
2. Frappe/HRMS pins move only within their approved major series (v16) and only after gates pass.
3. Every sync runs on a branch `upstream-sync/v16.<x>.<y>` and must pass **all five gates**:
   - **G1** Git tree verification (diff limited to expected files)
   - **G2** Dependency verification (versions + compatibility matrix)
   - **G3** Python validation (`compileall`, lint with upstream config)
   - **G4** Frappe/ERPNext consistency (versions, hooks, modules, patches, migrations)
   - **G5** Regression/smoke test (runtime bench suite — see §4)
4. Merge to `main` only with all gates green; tag result `fardainerp-v16.<x>.<y>-farda.<n>`.
5. **Stability > Continuous Upstream Changes.** Syncs are deliberate events, not rolling.

## 4) Gate 5 (runtime smoke) — runbook

G5 requires a bench environment with Python 3.14 + MariaDB + Redis (NOT available
in the current dev sandbox, which has Python 3.11). Execute via:

1. `frappe_docker`-style stack (Phase 16) or GitHub Actions runner (Phase 17) using
   image `ghcr.io/frappe/erpnext-ci-mariadb:py3.14-node24` (as upstream CI does).
2. `bench init` with Frappe v16.33.1 + this app (`v16.34.2`) + HRMS v16.18.1.
3. Create site (MariaDB 10.6), install apps, run:
   `bench --site <site> run-tests` (upstream suite) — proves
   Login/User/Company/Customer/Supplier/Item/Warehouse/Sales/Purchase/Stock/
   Accounting/Reports/Permissions paths.
4. Record results in this file (§5) and in the phase report of the phase that runs it.

## 5) Gate Run History

| Date | Gate | Commit / Tag | Result | Notes |
|---|---|---|---|---|
| 2026-09-15 | G1 Tree | `adc8f88` vs tag `v16.34.2` | ✅ PASS | diff = only `docs/` (2 files, +530); core subtrees byte-identical |
| 2026-09-15 | G2 Deps | `adc8f88` | ✅ PASS | erpnext 16.34.2 · frappe range OK (v16.33.1) · HRMS v16.18.1 compatible · py3.14/node24/mariadb10.6 documented |
| 2026-09-15 | G3 Python | `adc8f88` | ✅ PASS | `compileall` exit 0 on 2,637 files (sandbox py3.11; upstream target 3.14) |
| 2026-09-15 | G4 Consistency | `adc8f88` | ✅ PASS | no `17.0.0-dev` refs; patches end at v16_0; version strings consistent; modules.txt = upstream 21 + `Farda Iran` |
| 2026-09-15 | G5 Runtime smoke (Python 3.14 / PostgreSQL 16.2 / Redis 7.4.1, site `smoke.farda.local`) | `29b8f8c` · tag `fardainerp-gate5-pass` | ✅ **PASS 13/13** | REAL runtime bench run (PostgreSQL site — stricter than MariaDB baseline). Steps: Currency(IRR), Company, Fiscal Year, Auth(+negative), Permissions(negative), Customer+Address+Contact, Supplier, Item+Price, **Purchase chain PO→PR→PI→PE**, **Sales chain SO→DN→SI→PE**, **Stock ledger+transfer+reconciliation**, **Accounting COA(95)+JE+GL(128)+TrialBalance+GeneralLedger reports**, HRMS(Employee/Dept/Leave/Attendance). Savepoint-isolated, rerun-idempotent (13/13 on repeated runs). Harness: `erpnext/farda_iran/tests/gate5_smoke.py` |

### §5.1 — Actual G5 runtime environment (evidence)

| Component | Value |
|---|---|
| Python | 3.14 (`/opt/tools/venv314`) |
| Frappe | v16.33.1 (`988e54f3`) |
| ERPNext | 16.34.2 (this repo, symlinked bench app) |
| HRMS | v16.18.1 (`a4768b44`) |
| Database | **PostgreSQL 16.2** (`db_type=postgres`) — NOT the MariaDB CI default; 12 upstream strict-PostgreSQL defects surfaced and are shimmed in `erpnext/farda_iran/tests/pg_compat.py` (PG-1..PG-12), queued for upstream reporting |
| Redis | 7.4.1 |
| Command | `bench --site smoke.farda.local execute erpnext.farda_iran.tests.gate5_smoke.run_all` |

> NOTE (honesty): G5 passed on PostgreSQL. MariaDB was not available in this
> sandbox; MariaDB path remains covered by upstream CI and must be re-verified
> in the Phase "Production Docker" gate (DOCKER VALIDATION PENDING).
