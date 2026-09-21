# FardaERP — UX Audit (Phase 1)

Date: 2026-09-21 · Baseline: branch tip (`b070fcb`) · Method: repo inspection + live
runtime battery (PG site, real documents). No user-browser session yet — visual QA is
listed as pending work, not claimed.

## 1. What already exists and is USABLE (do not rebuild)

| Asset | Location | Verdict |
|---|---|---|
| KPI backend (real data, Toman/FA strings, rate-limited) | `farda_iran/dashboard/kpis.py` (`farda_kpis`) + `kpis_pure.py` | REUSE — this is the §6 data layer |
| Dashboard artifacts (5 Number Cards, «فروش ماهانه» chart, Dashboard «فردا — مدیریت», all public, real aggregation) | `setup/install.py::ensure_dashboards` | REUSE — §26 satisfied (no fake data) |
| Persian display layer (Jalali dates, IRR→Toman, Persian digits) flag-gated via `frappe.boot.farda_iran` | `farda_iran/public/js/farda_ui.js` + `ui/boot.py` | REUSE — display-only, accounting untouched |
| Persian-normalized search (folded search key + API) | `api/search.py`, `utilities/normalization.py` | REUSE — §16 satisfied at API level |
| Iranian identifier validators (کد ملی/شناسه ملی/شبا/کد پستی/کد اقتصادی) wired into Customer/Supplier/Company validate | `utilities/validators.py`, `party.py` | REUSE |
| Persian print formats (Sales/Purchase invoice + 80mm thermal) | `farda_iran/print_format/` | REUSE |
| Bundled Vazirmatn fonts (Regular+Bold, OFL) | `farda_iran/public/fonts/` | REUSE — currently used by PDF only |
| RTL stylesheet scoped to `html[lang="fa"]` (numbers/ISO LTR) | `public/css/farda_rtl.css` | REUSE/EXTEND |
| Translation layer (8,898/10,157 translated; 4 curated batches) | `translations/` | CONTINUE |

## 2. Gaps found (what this redesign must build)

1. **No Farda workspace / IA (§5, §8):** Desk navigation is ERPNext's default
   (English-titled role workspaces). An Iranian user has no «فروش / خرید / انبار /
   حسابداری / چک / گزارش‌ها» entry points. → build a public «FardaERP» workspace with
   Persian shortcuts + the existing real number cards.
2. **No design system (§18):** styling is scattered (single rtl css); no tokens for
   color/spacing/typography; components inherit raw Frappe look. → central
   `farda_design.css` (tokens + components), hooked once.
3. **Vazirmatn not loaded in Desk UI (§19):** bundled fonts serve PDF only; the Desk
   renders with the default Latin-first stack. → `@font-face` (local assets, no external
   HTTP) + fa-scoped font-family.
4. **No landing/dashboard surface wired into navigation (§6):** KPIs/cards exist but
   there is no Farda entry that a first-time user lands on. → workspace becomes the
   landing surface (header + cards + shortcuts); charts inherit frappe's own rendering.
5. **Quick Actions (§7):** no one-click creation surface. → workspace shortcuts to list
   views with New affordance (frappe renders per-permission); dedicated quick-create
   dialogs deferred to Phase 6 (needs form research per DocType).
6. **Portal/login RTL QA (§11/§32):** pending a real browser session — NEEDS E2E; not
   claimed fixed.
7. **Form simplification (§9/§10):** ERPNext forms expose advanced fields by default —
   field-grouping redesign is Phase 6 (per-DocType research required; not attempted
   blindly in this phase).

## 3. Must NOT be touched

Accounting/Stock engines, document lifecycle, permissions, workflow state machines, GL
and Stock Ledger schemas, any `frappe`/core file, API payloads (display-only transforms
stay in the UI layer). The UX layer is: 2 CSS files, 1 JS display file, workspace/setup
ensures — all inside `farda_iran`.

## 4. Architecture decision

```text
ERPNext/Frappe  → business engine (unchanged)
farda_iran      → display/UX layer: workspace IA + design css + fa display js
User            → Persian-first, RTL, Toman/Jalali, real data only
```

## 5. Success criteria mapping (§33)

«مشتری‌ها/فاکتور فروش/دریافت وجه/موجودی/گزارش فروش/چک‌ها کجاست؟» → the workspace gives a
labeled Persian shortcut for each within one click of landing. Verified by the runtime
suite (workspace + shortcuts existence, real card wiring).
