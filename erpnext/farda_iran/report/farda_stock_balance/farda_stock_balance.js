// FardaERP report filters (CORE-027). Defaults: the user's company and the
// current Jalali month, so the report opens with useful numbers.

frappe.query_reports["Farda Stock Balance"] = {
	filters: [
		{
			"fieldname": "company",
			"label": "شرکت",
			"fieldtype": "Link",
			"options": "Company",
			"reqd": 1,
			"default": frappe.defaults.get_user_default("Company")
		},
		{
			"fieldname": "as_on",
			"label": "تا تاریخ",
			"fieldtype": "Date",
			"reqd": 0,
			"default": frappe.datetime.get_today()
		},
		{
			"fieldname": "item_code",
			"label": "کالا",
			"fieldtype": "Link",
			"options": "Item"
		},
		{
			"fieldname": "item_group",
			"label": "گروه کالا",
			"fieldtype": "Link",
			"options": "Item Group"
		},
		{
			"fieldname": "warehouse",
			"label": "انبار",
			"fieldtype": "Link",
			"options": "Warehouse",
			"get_query": function () { const c = frappe.query_report.get_filter_value("company"); return { filters: Object.assign({ is_group: 0 }, c ? { company: c } : {}) }; }
		}
	],
};
