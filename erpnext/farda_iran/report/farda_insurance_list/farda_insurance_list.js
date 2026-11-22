const FARDA_MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
function farda_jnow() {
	const F = window.FardaIR, t = new Date();
	return F && F.gregorianToJalali ? F.gregorianToJalali(t.getFullYear(), t.getMonth() + 1, t.getDate()) : [1405, 1, 1];
}
frappe.query_reports["Farda Insurance List"] = {
	filters: [
		{ fieldname: "company", label: "شرکت", fieldtype: "Link", options: "Company", default: frappe.defaults.get_user_default("Company") },
		{ fieldname: "year", label: "سال", fieldtype: "Int", default: farda_jnow()[0], reqd: 1 },
		{ fieldname: "month", label: "ماه", fieldtype: "Select", options: FARDA_MONTHS.join("\n"), default: FARDA_MONTHS[farda_jnow()[1] - 1], reqd: 1 },
	],
};
