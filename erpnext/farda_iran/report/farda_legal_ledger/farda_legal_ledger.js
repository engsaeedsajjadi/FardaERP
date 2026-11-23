// FardaERP — دفتر کل قانونی
function farda_jalali_year_start() {
	const F = window.FardaIR;
	if (!F || !F.gregorianToJalali || !F.jalaliToGregorian) return frappe.datetime.year_start();
	const t = frappe.datetime.str_to_obj(frappe.datetime.get_today());
	const j = F.gregorianToJalali(t.getFullYear(), t.getMonth() + 1, t.getDate());
	const g = F.jalaliToGregorian(j[0], 1, 1);
	return `${g[0]}-${String(g[1]).padStart(2, "0")}-${String(g[2]).padStart(2, "0")}`;
}
frappe.query_reports["Farda Legal Ledger"] = {
	filters: [
		{ fieldname: "company", label: "شرکت", fieldtype: "Link", options: "Company", reqd: 1, default: frappe.defaults.get_user_default("Company") },
		{ fieldname: "from_date", label: "از تاریخ", fieldtype: "Date", reqd: 1, default: farda_jalali_year_start() },
		{ fieldname: "to_date", label: "تا تاریخ", fieldtype: "Date", reqd: 1, default: frappe.datetime.get_today() },
		{ fieldname: "account", label: "فقط این حساب", fieldtype: "Link", options: "Account", get_query: () => ({ filters: { company: frappe.query_report.get_filter_value("company") } }) },
		{ fieldname: "account_level", label: "سطح حساب کل", fieldtype: "Int", default: 1, description: "۰ = گروه‌های اصلی، ۱ = یک سطح پایین‌تر (معمولاً حساب کل)" },
		{ fieldname: "rows_per_page", label: "ردیف در هر صفحه", fieldtype: "Int", default: 30 },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		return data && data.bold ? "<b>" + value + "</b>" : value;
	},
};
