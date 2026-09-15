"""FardaERP whitelisted API surface (versioned, authed, rate-limited).

Conventions (docs/MASTER-TASK-LIST.md H9):
- All endpoints require an authenticated session (no guest) unless stated.
- Errors: frappe.throw with a `farda_*` prefix + HTTP-appropriate title.
- Pure/idempotent operations only on the conversion endpoints.
- Rate limited per user via farda_iran.api.limiter.
"""
