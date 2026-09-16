# FardaERP — Security Audit (§23 / R16)

> Executed 2026-09-16 as **executable tests**: `erpnext/farda_iran/tests/test_security_audit_runtime.py`
> (R16, 5/5 live, idempotent). This document records the surface map, decisions and posture.
> Re-run R16 after every new guest/API surface.

## 1) Attack-surface map (Farda-specific)

| Surface | File | Exposure | Controls |
|---|---|---|---|
| OTP request/verify | `otp/api.py` | **Guest** (POST-only, by design) | cooldown + max-attempts dead-lock + hashed-only storage (pepper) + vague rejections; response keys = challenge_id/expires_in/message |
| Payment verify (gateway callback) | `payments/api.py::verify_payment` | **Guest** (POST+GET, gateway redirect) | amount-match vs OWN record, replay→ALREADY_SETTLED, unknown→FAIL_UNKNOWN_TX, transport-fail→FAIL (R5 suite) |
| Payment start / status | `payments/api.py` | authenticated; status returns authority/gateway/amount/status/payment_entry only | allowlisted references, amount>0, gateway allowlist |
| Search (party/item) | `api/search.py` | authenticated | doctype allowlist, permission-aware `frappe.get_list`, rate-limit, minimal response columns (name/title/doctype) |
| Conversions (jalali/toman) | `api/conversions.py` | authenticated | rate-limited, pure inputs |
| KPIs endpoint | `dashboard/kpis.py` | authenticated | rate-limited 60/min, read-only SQL |
| Cheque transition | `doctype/cheque/cheque.py::set_status` | authenticated (Accounts roles) | TRANSITIONS allowlist + permission checks (R4) |
| Banking resolve | `api/banking.py` | authenticated | validators, registry lookup |
| Farda Audit Log | `doctype/farda_audit_log/` | System Manager read-only | append-only (controller blocks edit/delete even for Administrator; no create/delete perms for any role) |

## 2) Findings & posture

- **XSS (fixed in R16)**: Frappe's Jinja runs with `autoescape=False` (verified). All
  4 Farda print formats now apply `| e` to every user-controlled field
  (party names, item names, IDs, bill_no, company) — with parenthesization
  `(x or "-") | e` because Jinja binds `|` tighter than `or`. R16 renders
  `<script>` payloads through all three invoice formats and asserts HTML-escaping.
- **SQLi**: every Farda SQL surface is either (a) fully parameterized
  (`%(name)s` placeholders in reports/KPIs), or (b) built through frappe's
  query-builder, or (c) allowlisted (`search_party` doctype whitelist;
  internal-only `name_field`). R16 fires classic payloads (DROP/UNION/OR-tautology)
  through the search APIs and asserts table integrity + minimal columns.
- **CSRF**: enforced by the framework for authenticated web requests
  (X-Frappe-CSRF-Token gate in frappe's app handler). All Farda state-changing
  endpoints are session-authenticated + method-restricted; guest endpoints
  (OTP/payment verify) are intentionally cross-site-reachable and are guarded by
  one-time tokens (authority/challenge) + amount/policy checks instead.
- **PII**: audit trail masks identity values to last-4 and never stores secrets
  (password/token/key/otp/auth/merchant/hash → `***`); OTP store keeps only
  code_hash+salt; no PAN/phone in any API response; search returns no personal
  columns beyond name/title.
- **Escalation matrix (R16, via `frappe.has_permission`)**: Farda Audit Log =
  SM-read-only (denied for Accounts User/Sales User/Guest); Cheque create =
  Accounts User/Manager only (Sales User denied); Farda VAT Settings =
  SM/Accounts Manager only (read+write); Farda OTP Log denied to Sales User;
  Guest has nothing.

## 3) Method

Every finding in this file corresponds to an assertion in R16; anything not
asserted there is documented here as a decision, not silently assumed. HTTP-layer
behaviour (CSRF token rejection, method-not-allowed at the HTTP boundary) is
framework-enforced and is exercised by frappe's own test infrastructure; in-repo
we verify the deterministic in-process equivalents (whitelist sets, method
restrictions in decorators, permission engine).
