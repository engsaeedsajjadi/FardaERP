// FardaERP report filters (CORE-027). Defaults: the user's company and the
// current Jalali month, so the report opens with useful numbers.

frappe.query_reports["Farda Party Balance"] = {
	filters: [
		{
			"fieldname": "company",
			"label": "شرکت",
			"fieldtype": "Link",
			"options": "Company",
			"reqd": 0,
			"default": frappe.defaults.get_user_default("Company")
		},
		{
			"fieldname": "kind",
			"label": "نوع",
			"fieldtype": "Select",
			"options": [
				{
					"value": "",
					"label": "همه"
				},
				{
					"value": "AR",
					"label": "دریافتنی (مشتریان)"
				},
				{
					"value": "AP",
					"label": "پرداختنی (تأمین‌کنندگان)"
				}
			]
		},
		{
			"fieldname": "party",
			"label": "طرف حساب",
			"fieldtype": "Data"
		}
	],
};
