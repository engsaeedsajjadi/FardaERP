// FardaERP — فهرست معاملات فصلی (ماده ۱۶۹)
(function () {
	function jalali_now() {
		const F = window.FardaIR;
		const t = frappe.datetime.str_to_obj(frappe.datetime.get_today());
		if (!F || !F.gregorianToJalali) return [1405, 1];
		const j = F.gregorianToJalali(t.getFullYear(), t.getMonth() + 1, t.getDate());
		// default to the season that just ended (that is the one being filed)
		let season = Math.ceil(j[1] / 3) - 1, year = j[0];
		if (season < 1) { season = 4; year -= 1; }
		return [year, season];
	}
	const now = jalali_now();
	frappe.query_reports["Farda Seasonal Transactions"] = {
		filters: [
			{ fieldname: "company", label: "شرکت", fieldtype: "Link", options: "Company", default: frappe.defaults.get_user_default("Company") },
			{ fieldname: "year", label: "سال (شمسی)", fieldtype: "Int", default: now[0], reqd: 1 },
			{ fieldname: "season", label: "فصل", fieldtype: "Select", reqd: 1, default: String(now[1]),
				options: [{ value: "1", label: "بهار" }, { value: "2", label: "تابستان" }, { value: "3", label: "پاییز" }, { value: "4", label: "زمستان" }] },
			{ fieldname: "kind", label: "نوع معامله", fieldtype: "Select", options: "خرید\nفروش", default: "خرید", reqd: 1 },
			{ fieldname: "aggregate_limit", label: "سقف معاملات تجمیعی (ریال)", fieldtype: "Int", default: 211500000,
				description: "۵٪ حد نصاب معاملات کوچک؛ برای ۱۴۰۵ برابر ۲۱۱٬۵۰۰٬۰۰۰ ریال" },
			{ fieldname: "include_moadian", label: "فروش‌های ثبت‌شده در سامانه مودیان هم بیاید", fieldtype: "Check", default: 0,
				depends_on: "eval:doc.kind=='فروش'" },
		],
		formatter(value, row, column, data, default_formatter) {
			value = default_formatter(value, row, column, data);
			if (column.fieldname === "status" && data && data.status && data.status.indexOf("ناقص") >= 0) {
				return `<span style="color:var(--red-600)">${value}</span>`;
			}
			return value;
		},
	};
})();
