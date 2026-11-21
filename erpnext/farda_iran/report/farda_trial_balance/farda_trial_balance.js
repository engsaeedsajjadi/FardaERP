// FardaERP report filters (CORE-027). Defaults: the user's company and the
// current Jalali month, so the report opens with useful numbers.
function farda_jalali_month_start() {
	// first day of the current Jalali month, as an ISO Gregorian date
	const F = window.FardaIR;
	if (!F || !F.gregorianToJalali || !F.jalaliToGregorian) return frappe.datetime.month_start();
	const t = frappe.datetime.str_to_obj(frappe.datetime.get_today());
	const j = F.gregorianToJalali(t.getFullYear(), t.getMonth() + 1, t.getDate());
	const g = F.jalaliToGregorian(j[0], j[1], 1);
	return `${g[0]}-${String(g[1]).padStart(2, "0")}-${String(g[2]).padStart(2, "0")}`;
}

frappe.query_reports["Farda Trial Balance"] = {
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
			"fieldname": "from_date",
			"label": "از تاریخ",
			"fieldtype": "Date",
			"reqd": 0,
			"default": farda_jalali_month_start()
		},
		{
			"fieldname": "to_date",
			"label": "تا تاریخ",
			"fieldtype": "Date",
			"reqd": 0,
			"default": frappe.datetime.get_today()
		},
		{
			"fieldname": "account",
			"label": "حساب",
			"fieldtype": "Link",
			"options": "Account",
			"get_query": function () { const c = frappe.query_report.get_filter_value("company"); return { filters: Object.assign({ is_group: 0 }, c ? { company: c } : {}) }; }
		},
		{
			"fieldname": "root_type",
			"label": "گروه",
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
				},
				{
					"value": "Income",
					"label": "درآمد"
				},
				{
					"value": "Expense",
					"label": "هزینه"
				}
			]
		}
	],
};
