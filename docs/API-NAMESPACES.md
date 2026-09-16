# FardaERP — API Namespaces (§21/§34)

> Generated: 2026-09-16 · Registry (single source of truth): `erpnext/farda_iran/api/namespaces_registry.py`
> Dispatch layer: `erpnext/farda_iran/api/namespaces.py` — live E2E: **R21 7/7** (`tests/test_namespaces_runtime.py`, ×3 idempotent)

## Contract

- **Endpoint shape** — one whitelisted action-dispatch per namespace, authenticated only (never guest):

  | Endpoint | Actions |
  |---|---|
  | `/api/method/erpnext.farda_iran.api.namespaces.tax` | `calculate_vat` |
  | `/api/method/erpnext.farda_iran.api.namespaces.party` | `get_profile`, `search` |
  | `/api/method/erpnext.farda_iran.api.namespaces.bank` | `resolve` |
  | `/api/method/erpnext.farda_iran.api.namespaces.reports` | `run` |

  Call: `POST` (or `GET`) with `action=<name>` plus the action's parameters
  (e.g. `action=calculate_vat&net_amount=1000000`).

- **Uniform envelope** (HTTP 200 by convention — the `ok` flag carries status):
  ```json
  {"ok": true,  "data": { ... }}
  {"ok": false, "error": {"code": "VALIDATION", "message": "…fa…"}}
  ```

- **Error codes** (exact vocabulary): `VALIDATION` · `NOT_FOUND` · `FORBIDDEN` · `RATE_LIMITED` · `UNKNOWN`
  - `VALIDATION` — bad input / unknown action / non-allowlisted report
  - `NOT_FOUND` — entity lookup miss (e.g. unknown party)
  - `FORBIDDEN` — Guest, or authenticated user without the namespace roles
  - `RATE_LIMITED` — sliding-window budget exceeded
  - `UNKNOWN` — unexpected server error (traceback logged via `frappe.log_error`, never returned)

- **Role gates** (frozensets in the registry):
  `tax` → Accounts User/Manager, Sales User, Purchase User, System Manager ·
  `party` → Sales/Purchase/Stock User, Accounts User, System Manager ·
  `bank` → Accounts User/Manager, System Manager ·
  `reports` → Accounts User/Manager/Viewer, Sales User, System Manager.
  Guest is rejected before any role check.

- **Rate limits**: `farda.reports.run` → per-user sliding window (30 calls / 60 s,
  Redis limiter). `farda.party.search` and `farda.bank.resolve` reuse the same
  throttled service functions as the existing endpoints.

- **Actions**:
  - `farda.tax.calculate_vat(net_amount, rate?)` — pure HALF-UP planner; `rate`
    defaults to the configurable `Farda VAT Settings.default_rate` (10% shipped default).
  - `farda.party.get_profile(party_type, name)` — identity fields (کد ملی، شناسه ملی،
    کد اقتصادی، کد پستی، شبا، معافیت VAT) + normalized `farda_search_key`.
  - `farda.party.search(query, party_type="Customer", limit=20)` — Persian-normalized
    fold-at-rest search (ي/ی، ك/ک، digits، ZWNJ).
  - `farda.bank.resolve(iban)` — IBAN validation + bank code/name from the published
    registry + linked `Bank Account` rows.
  - `farda.reports.run(report, filters?)` — allow-listed Farda reports only
    (sales/purchase register, cheque, party balance, VAT) via `frappe.desk.query_report.run`,
    JSON-safe payload.

- **Audit behavior**: the namespace surface is **READ-ONLY by design** — no handler
  writes. Every mutating path stays on the model layer, where `audit.service`
  doc_events produce the append-only audit trail (payment/cheque/VAT-change/identity).
  Error messages carry no secrets; payloads carry only document names/fields the
  caller's roles already expose in Desk.

- **Guest surface invariant**: these four dispatchers are whitelisted but NOT
  `allow_guest` — the R16-verified guest surface (OTP×2, payment verify, health)
  is unchanged (re-proven by `test_security_audit_runtime` after this module landed).
