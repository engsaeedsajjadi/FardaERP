# FardaERP — Phase 1 Report: Stable Re-Baseline (ERPNext v16.34.2)

> Date: 2026-09-15 · Branch: `arena/01a0a51f-fardaerp` · Approved work order: "APPROVED — START PHASE 1"

## Summary

FardaERP was re-baselined from an ERPNext **17.0.0-dev** snapshot (upstream
`develop`, taken 2026-09-15) to the **stable ERPNext v16.34.2** release, using a
controlled **tree replacement in a single commit** with **full preservation of
Git history** (no reset/rebase/force).

```text
b9c7401  Initialize FardaERP based on ERPNext          (preserved)
aea2a38  docs: version baseline analysis               (preserved)
f6dbb89  docs: Phase 0 audit report                    (preserved)
adc8f88  chore: re-baseline FardaERP on ERPNext v16.34.2   ← NEW (this phase)
```

## 1) Previous baseline
ERPNext `17.0.0-dev` — proven byte-identical to upstream `develop` HEAD of
2026-09-15 via blob SHA comparison (`erpnext/hooks.py`, `pyproject.toml`).

## 2) New baseline
ERPNext **v16.34.2** — upstream tag `4048fb70e14d1843956fcdabb7c3cca75a1cbcdd`,
byte-identical tree except FardaERP `docs/` (Gate 1).

## 3) ERPNext version
**16.34.2** (`erpnext/__init__.py`; flit dynamic version)

## 4) Frappe version
**v16.33.1** (tag `988e54f3…`) — satisfies app range `frappe >=16.21.0,<17.0.0`

## 5) HRMS version
**v16.18.1** (tag `a4768b44…`) — declares `frappe >=16,<17` and
`erpnext >=16,<17` → **officially compatible with this baseline**
(integration itself is Phase 13)

## 6) Python version
**3.14** — upstream hard requirement (`requires-python >= "3.14"`; official CI
image `py3.14`). Dev sandbox runs Python 3.11.2 → static validation only (G3).

## 7) Node version
**24** — official CI image (`py3.14-node24`).

## 8) Database
**MariaDB 10.6** (CI standard; 11.8 also exercised in patch CI).
PostgreSQL remains supported by upstream CI.

## 9) Redis
Required by Frappe (cache/queue/scheduler). CI installs distro `redis-server`.
Exact minimum version: UNKNOWN — needs verification at first bench bring-up
(Phase 16). Tracked in docs/VERSIONS.md §2.

## 10) Git safety tag
- `fardaerp-pre-v16-rebaseline` → **`b9c7401`** (verified)
- `fardaerp-pre-v16-rebaseline-head` → `f6dbb89` (exact pre-rebaseline HEAD)

## 11) New commit SHA
**`adc8f889ec1e0c887e835470ca7bc67f29ad5e6e`** —
`chore: re-baseline FardaERP on ERPNext v16.34.2` (single, clean transition commit)

## 12) Files/modules preserved
- `docs/PHASE-0-AUDIT.md`, `docs/VERSION-BASELINE-AND-ARCHITECTURE.md`
  (the only FardaERP content existing before re-baseline — carried into the new tree)
- Full Git history (`b9c7401` reachable; safety tags created before any change)

## 13) Files removed
Everything belonging to the v17-dev snapshot that is not part of v16.34.2
(tree replacement). The delta between develop-2026-09-15 and v16.34.2 was
**5,225 ahead / 3,207 behind commits** upstream — replaced wholesale, not merged,
per approved plan.

## 14) Files changed (net vs v16.34.2 tag)
Exactly **2 files added** (`docs/PHASE-0-AUDIT.md` +339,
`docs/VERSION-BASELINE-AND-ARCHITECTURE.md` +191). Zero other differences.
Post-baseline architecture commit adds: `erpnext/farda_iran/{__init__.py,README.md}`,
`erpnext/modules.txt` (+1 line, CORE-001), `docs/VERSIONS.md`,
`docs/CORE-CHANGES.md`, this report.

## 15) Validation results (gates)
| Gate | Result | Evidence |
|---|---|---|
| G1 Tree | ✅ PASS | `git diff --stat v16.34.2 HEAD` = docs-only; core subtrees empty diff |
| G2 Deps | ✅ PASS | versions table above; HRMS compatibility matrix verified via upstream pyprojects + remote tag SHAs |
| G3 Python | ✅ PASS | `python3 -m compileall -q erpnext banking` → exit 0, 2,637 files compiled |
| G4 Consistency | ✅ PASS | no `17.0.0-dev` refs; `patches.txt` ends at `v16_0`; `app_name=erpnext` intact; modules.txt = 21 upstream + 1 Farda |
| G5 Runtime smoke | ⏸ DEFERRED | requires Python 3.14 + MariaDB + Redis — not present in sandbox; runbook in docs/VERSIONS.md §4; executes in Phase 16 (Docker) / Phase 17 (CI) |

## 16) Test results
Static gates executed and green (above). Runtime ERP smoke test (Login, Company,
Customer, …, Permissions): **NOT RUN in this environment** — see G5; no errors
hidden. Upstream v16.34.2 is the exact tagged release that passes upstream CI.

## 17) Remaining warnings
1. G5 runtime validation pending environment (blocking gate for localization phases per stop-condition — needs Docker/CI bench).
2. Sandbox Python 3.11 vs upstream 3.14: G3 syntax check is a *subset* of the official check.
3. Redis minimum version to confirm at first bench bring-up.
4. Upstream `change_log/` has no `v16` folder yet (upstream state — informational only).

## 18) Known risks
1. **Python 3.14 ecosystem**: third-party libs used by FardaERP (jalali date, SMS/gateway SDKs) must be verified against 3.14 wheels during their phases; pure-Python fallbacks exist (e.g., built-in Jalali algorithm, HTTP-only gateway adapters).
2. **Upstream v16 patch stream**: weekly `v16.x.y` releases — controlled sync cadence per docs/VERSIONS.md §3.
3. **HRMS v16.18.1 pin** must move in lockstep with ERPNext v16 syncs.

## 19) Exact next step for Phase 2 (FardaERP Architecture)
1. Extend `farda_iran/` skeleton with subpackage structure (`setup/`, `tests/` first).
2. `after_install` hook: default language `fa`, system settings, region seed (provinces/cities fixtures structure).
3. `app_include_js/css` registration for the future FardaERP bundle; branding assets plan (logo/favicon/login) — implementation in Phase 3.
4. Validation policy per phase: G3+G4 mandatory per commit; G5 before any DB-affecting feature phase merges.
> Phase 2 starts only after your approval of this report (per stop condition).
