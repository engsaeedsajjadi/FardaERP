"""Backward-compatible alias: the PostgreSQL shims now live in
erpnext.farda_iran.compat.pg so production hooks never import from tests/."""

from erpnext.farda_iran.compat.pg import apply  # noqa: F401
