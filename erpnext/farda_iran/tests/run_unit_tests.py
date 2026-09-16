"""FardaERP unit-test runner for pure-Python farda_iran services.

Standalone (no bench / no frappe needed):
    python erpnext/farda_iran/tests/run_unit_tests.py

Inside a bench:
    bench --site <site> execute erpnext.farda_iran.tests.run_unit_tests.run
"""

import importlib.util
import os
import shutil
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))

MODULES = (
	"test_jalali_service",
	"test_currency_service",
	"test_normalization",
	"test_validators",
	"test_banking",
	"test_rate_limiter",
	"test_otp_core",
	"test_sms_providers",
	"test_payments_policy",
	"test_invoice_words",
	"test_vat_planner",
	"test_search_keys",
	"test_dashboard_pure",
	"test_audit_pure",
)


def build_suite() -> unittest.TestSuite:
	loader = unittest.defaultTestLoader
	suite = unittest.TestSuite()
	for name in MODULES:
		path = os.path.join(_HERE, name + ".py")
		spec = importlib.util.spec_from_file_location(name, path)
		module = importlib.util.module_from_spec(spec)
		sys.modules[name] = module
		spec.loader.exec_module(module)  # test file performs its own path bootstrap
		suite.addTests(loader.loadTestsFromModule(module))
	return suite


def run() -> str:
	result = unittest.TextTestRunner(verbosity=1).run(build_suite())
	total = result.testsRun
	failed = len(result.failures) + len(result.errors)
	summary = f"farda_iran unit tests: {total - failed}/{total} passed, {failed} failed"
	print(summary)
	# JS parity tests (real node execution) — best-effort, failure = overall failure
	if shutil.which("node"):
		from farda_iran.tests.js import run_js_tests

		run_js_tests.run()  # prints its own summary
	else:
		print("JS parity tests: SKIPPED (node not available)")
	if not result.wasSuccessful():
		raise SystemExit(1)
	return summary


if __name__ == "__main__":
	run()
