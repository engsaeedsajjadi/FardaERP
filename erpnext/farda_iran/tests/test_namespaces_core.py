"""Unit tests for the pure API-namespace registry (§21; no frappe needed)."""

import os
import sys
import unittest
from importlib.util import module_from_spec, spec_from_file_location

_REGISTRY_PATH = os.path.abspath(
	os.path.join(os.path.dirname(__file__), "..", "api", "namespaces_registry.py")
)
_spec = spec_from_file_location("farda_namespaces_registry", _REGISTRY_PATH)
reg = module_from_spec(_spec)
sys.modules["farda_namespaces_registry"] = reg
_spec.loader.exec_module(reg)


class TestRegistryIntegrity(unittest.TestCase):
	def test_roles_defined_for_every_namespace(self):
		self.assertEqual(set(reg.NAMESPACE_ROLES), set(reg.NAMESPACE_ACTIONS))
		for ns, roles in reg.NAMESPACE_ROLES.items():
			self.assertTrue(roles, f"{ns} has no role gate")
			self.assertFalse("Guest" in roles, f"{ns} must never be guest-accessible")

	def test_handlers_covered(self):
		# every (namespace, action) pair must have a handler in the dispatch layer
		ns_py = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "api", "namespaces.py"))
		src = open(ns_py, encoding="utf-8").read()
		for ns, actions in reg.NAMESPACE_ACTIONS.items():
			for action in actions:
				self.assertIn(f'("{ns}", "{action}")', src, f"handler missing for {ns}.{action}")

	def test_report_allowlist_matches_disk(self):
		import glob

		report_dir = os.path.abspath(
			os.path.join(os.path.dirname(__file__), "..", "report")
		)
		on_disk = {
			os.path.basename(p) for p in glob.glob(os.path.join(report_dir, "farda_*"))
		}
		self.assertTrue(on_disk, "no farda report dirs found")
		self.assertEqual(set(reg.REPORT_ALLOWLIST), on_disk)

	def test_error_vocabulary(self):
		self.assertEqual(
			set(reg.ERROR_CODES), {"VALIDATION", "NOT_FOUND", "FORBIDDEN", "RATE_LIMITED", "UNKNOWN"}
		)


if __name__ == "__main__":
	unittest.main()
