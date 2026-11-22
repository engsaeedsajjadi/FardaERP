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
,
	onload(report) {
		report.page.add_inner_button("دریافت دیسکت بیمه (DBF)", () => {
			const f = report.get_values();
			if (!f || !f.company) return frappe.msgprint("شرکت را انتخاب کنید");
			frappe.confirm(
				"فایل‌های DSKKAR00 و DSKWOR00 طبق مشخصات جداول سازمان تأمین اجتماعی ساخته می‌شوند (متن فارسی با کدگذاری ایران‌سیستم). " +
					"پیش از ارسال اول، فایل را در «برنامه لیست» یا سامانه خدمات غیرحضوری باز کنید و یک بار کنترل کنید.",
				() => {
					const q = new URLSearchParams({ company: f.company, year: f.year, month: f.month });
					window.open("/api/method/erpnext.farda_iran.report.farda_insurance_list.farda_insurance_list.download_disk?" + q.toString());
				}
			);
		});
	},
};
