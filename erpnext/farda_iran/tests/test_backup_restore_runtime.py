"""E2E runtime test: §25 backup → restore → verification gate.

Full cycle against the live environment:
  marker data → scripts/backup.sh (manifest + retention prune) → fresh verify site
  → scripts/restore.sh (DB + files) → assertions ON THE RESTORED SITE:
  marker row, Sales Invoice count, custom-field count, Farda VAT Settings values,
  and the frappe-free unit suite. Cleans up (drops verify DB + site dir, deletes
  the marker from the source site).
"""

from __future__ import annotations

import os
import shutil
import subprocess

import frappe

REPO = "/home/user/FardaERP"
BENCH = "/opt/fardabench/frappe-bench"
SOURCE_SITE = "smoke.farda.local"
VERIFY_SITE = "verify.farda.local"
BACKUP_DIR = f"{BENCH}/backups"


def _script_env() -> dict:
	env = os.environ.copy()
	env.update({
		"FARDA_BENCH_DIR": BENCH,
		"FARDA_BACKUP_DIR": BACKUP_DIR,
		"FARDA_RETENTION_DAYS": "30",
		"FARDA_VENV": "/opt/tools/venv314",
		"FARDA_PGBIN": "/opt/tools/pgserver-extracted/pgserver/pginstall/bin",
		"FARDA_PGLIBS": "/opt/tools/pgserver-extracted/pgserver/pgserver.libs",
		# sandbox-local root credentials (ephemeral test cluster; env-only, never baked into scripts)
		"FARDA_DB_ROOT_USER": "postgres",
		"FARDA_DB_ROOT_PASS": "postgres123",
	})
	return env


def _bench(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
	env = _script_env()
	cwd = f"{BENCH}/sites" if any("bench_helper" in a for a in args) else BENCH
	return subprocess.run(
		args, env=env, capture_output=True, text=True, timeout=timeout, cwd=cwd
	)


def _cleanup_verify() -> None:
	"""Drop the verify database + site dir (manual, non-interactive)."""
	site_dir = f"{BENCH}/sites/{VERIFY_SITE}"
	cfg = os.path.join(site_dir, "site_config.json")
	if os.path.exists(cfg):
		import json

		db_name = json.load(open(cfg)).get("db_name")
		if db_name:
			env = _script_env()
			subprocess.run(
				[
					f"{env['FARDA_PGBIN']}/dropdb",
					"-h", "127.0.0.1", "-U", "postgres", "--if-exists", db_name,
				],
				env=env, capture_output=True, text=True, timeout=120,
			)
	if os.path.exists(site_dir):
		shutil.rmtree(site_dir, ignore_errors=True)


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []
	staged: str | None = None
	verify_started = False

	# ---------- marker data (committed — backups see committed state) ----------
	import time

	marker_name = f"BACKUPRT MARKER {int(time.time())}"
	frappe.get_doc({"doctype": "Customer", "customer_name": marker_name, "customer_type": "Individual"}).insert()
	frappe.db.commit()
	source_si_count = frappe.db.count("Sales Invoice")
	source_cf_count = frappe.db.count("Custom Field")
	source_vat = frappe.db.get_value(
		"Farda VAT Settings", "Farda VAT Settings", ["enabled", "default_rate", "vat_account"], as_dict=True
	)

	try:
		# ---------- retention pre-seed: a fake ancient backup dir ----------
		fake_old = f"{BACKUP_DIR}/{SOURCE_SITE}/20240101-000000"
		os.makedirs(fake_old, exist_ok=True)
		open(f"{fake_old}/dummy.sql.gz", "w").write("x")
		subprocess.run(["touch", "-d", "45 days ago", fake_old], check=True)

		# ---------- 1) backup ----------
		proc = _bench(["bash", f"{REPO}/scripts/backup.sh", SOURCE_SITE])
		assert proc.returncode == 0, f"backup failed:\n{proc.stdout[-400:]}\n{proc.stderr[-400:]}"
		assert "BACKUP-OK" in proc.stdout, proc.stdout[-400:]
		assert not os.path.exists(fake_old), "retention did not prune the 45-day-old backup"
		results.append("PASS: backup.sh → BACKUP-OK + retention pruned 45d-old dir")

		staged = open(f"{BACKUP_DIR}/{SOURCE_SITE}/LATEST").read().strip()
		manifest = os.path.join(staged, "MANIFEST.sha256")
		check = subprocess.run(
			["sha256sum", "-c", "MANIFEST.sha256"], cwd=staged, capture_output=True, text=True
		)
		assert check.returncode == 0, check.stdout
		assert os.path.exists(os.path.join(staged, "site_config.json")), "site_config not staged"
		results.append("PASS: MANIFEST.sha256 verifies + site_config.json staged")

		db_file = next(
			os.path.join(staged, f) for f in sorted(os.listdir(staged)) if "database" in f and f.endswith(".sql.gz")
		)
		files_tars = [
			os.path.join(staged, f)
			for f in sorted(os.listdir(staged))
			if f.endswith(".tar") and ("files" in f)
		]

		# ---------- 2) fresh verify site (frappe-only, fast) ----------
		_bench([
			"/opt/tools/venv314/bin/python", "-m", "frappe.utils.bench_helper", "frappe",
			"new-site", VERIFY_SITE,
			"--db-type", "postgres", "--db-host", "127.0.0.1", "--db-port", "5432",
			"--db-root-username", "postgres", "--db-root-password", "postgres123",
			"--admin-password", "admin123",
		])
		assert os.path.exists(f"{BENCH}/sites/{VERIFY_SITE}/site_config.json"), "verify site missing"
		verify_started = True

		# ---------- 3) restore ----------
		restore_args = ["bash", f"{REPO}/scripts/restore.sh", VERIFY_SITE, db_file, *files_tars]
		proc = _bench(restore_args)
		assert proc.returncode == 0, f"restore failed:\n{proc.stdout[-400:]}\n{proc.stderr[-400:]}"
		assert "RESTORE-OK" in proc.stdout, proc.stdout[-400:]
		results.append("PASS: restore.sh → RESTORE-OK (DB + %d file tars)" % len(files_tars))

		# ---------- 4) verification gate ON THE RESTORED SITE ----------
		frappe.destroy()
		frappe.init(VERIFY_SITE)
		frappe.connect()

		assert frappe.db.exists("Customer", {"customer_name": marker_name}), "marker lost"
		assert frappe.db.count("Sales Invoice") == source_si_count, "invoice count mismatch"
		assert frappe.db.count("Custom Field") == source_cf_count, "custom fields mismatch"
		restored_vat = frappe.db.get_value(
			"Farda VAT Settings", "Farda VAT Settings", ["enabled", "default_rate", "vat_account"], as_dict=True
		)
		assert dict(restored_vat) == dict(source_vat), (source_vat, restored_vat)
		results.append("PASS: restored site — marker + SI count + custom fields + VAT settings identical")

		from erpnext.farda_iran.tests.run_unit_tests import run as unit_run

		out = unit_run()
		assert "160/160" in out, out[-200:]
		results.append("PASS: frappe-free unit suite 160/160 on the RESTORED site")
	except Exception:
		raise
	finally:
		# ---------- cleanup: drop verify, remove marker from source ----------
		if verify_started or os.path.exists(f"{BENCH}/sites/{VERIFY_SITE}"):
			_cleanup_verify()
		frappe.destroy()
		frappe.init(SOURCE_SITE)
		frappe.connect()
		frappe.db.delete("Customer", {"customer_name": marker_name})
		frappe.db.commit()

	if staged and os.path.exists(f"{BACKUP_DIR}/{SOURCE_SITE}/LATEST"):
		pass  # keep backup artifacts (outside the repo) as evidence
	return " | ".join(results)
