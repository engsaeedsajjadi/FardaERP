// FardaERP report filters (CORE-027). Defaults: the user's company and the
// current Jalali month, so the report opens with useful numbers.

frappe.query_reports["Farda Balance Sheet"] = {
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
			"reqd": 1,
			"default": frappe.datetime.get_today()
		},
		{
			"fieldname": "root_type",
			"label": "بخش",
			"fieldtype": "Select",
			"options": [
				{
					"value": "",
					"label": "همه"
				},
				{
					"value": "Asset",
					"label": "دارایی"
				},
				{
					"value": "Liability",
					"label": "بدهی"
				},
				{
					"value": "Equity",
					"label": "سرمایه"
				}
			]
		}
	],
};
