"""Sandbox/runtime provisioning for FRESH PostgreSQL sites (env-side helper —
never shipped in the Docker image path).

Fresh PG installs lack seeds that MariaDB installs normally receive through
fixtures or the desktop wizard: warehouse types, default address template,
root item groups, UOMs and standard Stock Entry Types. Runtime suites call
this first so they stay self-contained. Idempotent: every step checks before
inserting. This seeds infrastructure only — never business/demo data.
"""

import frappe

WAREHOUSE_TYPES = ("Transit", "Manufacturing", "Receivable", "Store")
STOCK_ENTRY_TYPES = (
	"Material Receipt",
	"Material Transfer",
	"Material Issue",
	"Repack",
	"Send to Subcontractor",
)


def run() -> str:
	out = []
	for t in WAREHOUSE_TYPES:
		if not frappe.db.exists("Warehouse Type", t):
			frappe.get_doc({"doctype": "Warehouse Type", "warehouse_type": t, "name": t}).db_insert()
			out.append(f"WH:{t}")
	if not frappe.db.sql("select name from `tabAddress Template` where is_default=1 limit 1"):
		country = frappe.db.get_value("Country", {}, "name")
		frappe.get_doc({
			"doctype": "Address Template", "address_template_name": "Default",
			"country": country, "is_default": 1,
			"template": "{{ address_line1 }}\n{{ city }}\n{{ country }}",
		}).insert(ignore_permissions=True)
		out.append("AddrTemplate")
	if not frappe.db.exists("Item Group", "All Item Groups"):
		frappe.get_doc({"doctype": "Item Group", "item_group_name": "All Item Groups", "is_group": 1}).insert()
		out.append("IG:root")
	if not frappe.db.exists("Item Group", "Products"):
		frappe.get_doc({
			"doctype": "Item Group", "item_group_name": "Products", "is_group": 0,
			"parent_item_group": "All Item Groups",
		}).insert()
		out.append("IG:leaf")
	for uom, whole in (("Unit", 1), ("Nos", 1), ("Hour", 0)):
		if not frappe.db.exists("UOM", uom):
			frappe.get_doc({"doctype": "UOM", "uom_name": uom, "must_be_whole_number": whole}).insert()
			out.append(f"UOM:{uom}")
	# Party Type masters are missing entirely on fresh PG installs (no wizard);
	# JE validation reads Party Type.account_type when a party is set
	for pt, at in (("Customer", "Receivable"), ("Supplier", "Payable"),
				   ("Employee", ""), ("Member", ""), ("Shareholder", "")):
		if not frappe.db.exists("Party Type", pt):
			frappe.get_doc({"doctype": "Party Type", "party_type": pt, "name": pt,
							"account_type": at or None}).db_insert()
			out.append(f"PT:{pt}")
		elif at and frappe.db.get_value("Party Type", pt, "account_type") != at:
			frappe.db.set_value("Party Type", pt, "account_type", at)
			out.append(f"PT:{pt}:{at}")
	for st in STOCK_ENTRY_TYPES:
		if not frappe.db.exists("Stock Entry Type", st):
			frappe.get_doc({"doctype": "Stock Entry Type", "name": st, "purpose": st}).db_insert()
			out.append(f"SET:{st}")
	frappe.db.commit()
	return "PROVISIONED: " + (", ".join(out) or "nothing to do")
