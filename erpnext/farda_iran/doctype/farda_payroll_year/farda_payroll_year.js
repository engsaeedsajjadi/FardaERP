// حقوق و دستمزد ایرانی: نرخ‌های سال + راه‌اندازی برای یک شرکت
frappe.ui.form.on("Farda Payroll Year", {
	refresh(frm) {
		frm.fields_dict.setup_html.$wrapper.html(
			`<div class="text-muted small">ارقام این سال از بخشنامه‌های رسمی پر شده است. اگر مصوبه جدیدی آمد (مثلاً افزایش حق مسکن) فقط همین‌جا عدد را عوض کنید؛ فیش‌های بعدی با عدد جدید حساب می‌شوند.</div>`
		);
		if (frm.is_new()) return;
		frm.add_custom_button("راه‌اندازی حقوق ایرانی برای یک شرکت", () => {
			frappe.prompt(
				[{ fieldname: "company", fieldtype: "Link", options: "Company", label: "شرکت", reqd: 1, default: frappe.defaults.get_user_default("Company") }],
				(v) =>
					frappe
						.call({ method: "erpnext.farda_iran.payroll.setup.setup_company", args: { company: v.company, year: frm.doc.year }, freeze: true })
						.then((r) => frappe.msgprint({ title: "راه‌اندازی انجام شد", message: r.message, indicator: "green" })),
				"راه‌اندازی حقوق و دستمزد",
				"انجام بده"
			);
		});
	},
});
