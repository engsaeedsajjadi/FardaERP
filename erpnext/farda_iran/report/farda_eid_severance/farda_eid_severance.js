function farda_eid_jyear() {
	const F = window.FardaIR, t = new Date();
	return F && F.gregorianToJalali ? F.gregorianToJalali(t.getFullYear(), t.getMonth() + 1, t.getDate())[0] : 1405;
}
frappe.query_reports["Farda Eid Severance"] = {
	filters: [
		{ fieldname: "company", label: "شرکت", fieldtype: "Link", options: "Company", default: frappe.defaults.get_user_default("Company"), reqd: 1 },
		{ fieldname: "year", label: "سال", fieldtype: "Int", default: farda_eid_jyear(), reqd: 1 },
	],
};
