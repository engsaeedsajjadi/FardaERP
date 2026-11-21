// FardaERP report filters (CORE-027). Defaults: the user's company and the
// current Jalali month, so the report opens with useful numbers.

frappe.query_reports["Farda Cheque Report"] = {
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
			"fieldname": "direction",
			"label": "نوع چک",
			"fieldtype": "Select",
			"options": [
				{
					"value": "",
					"label": "همه"
				},
				{
					"value": "Received",
					"label": "دریافتی"
				},
				{
					"value": "Issued",
					"label": "صادره"
				}
			]
		},
		{
			"fieldname": "status",
			"label": "وضعیت",
			"fieldtype": "Select",
			"options": [
				{
					"value": "",
					"label": "همه"
				},
				{
					"value": "Received",
					"label": "دریافت‌شده"
				},
				{
					"value": "Issued",
					"label": "صادرشده"
				},
				{
					"value": "Deposited",
					"label": "واگذارشده به بانک"
				},
				{
					"value": "Cleared",
					"label": "وصول‌شده"
				},
				{
					"value": "Returned",
					"label": "برگشتی"
				},
				{
					"value": "Cancelled",
					"label": "باطل‌شده"
				}
			]
		},
		{
			"fieldname": "party",
			"label": "طرف حساب",
			"fieldtype": "Data"
		},
		{
			"fieldname": "due_until",
			"label": "سررسید تا",
			"fieldtype": "Date"
		}
	],
};
