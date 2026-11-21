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

frappe.query_reports["Farda Bank Report"] = {
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
			"fieldname": "account",
			"label": "حساب بانک یا صندوق",
			"fieldtype": "Link",
			"options": "Account",
			"get_query": function () { return { filters: { account_type: ["in", ["Bank", "Cash"]], is_group: 0, company: frappe.query_report.get_filter_value("company") } }; }
		},
		{
			"fieldname": "from_date",
			"label": "از تاریخ",
			"fieldtype": "Date",
			"reqd": 1,
			"default": farda_jalali_month_start()
		},
		{
			"fieldname": "to_date",
			"label": "تا تاریخ",
			"fieldtype": "Date",
			"reqd": 1,
			"default": frappe.datetime.get_today()
		}
	],
};
