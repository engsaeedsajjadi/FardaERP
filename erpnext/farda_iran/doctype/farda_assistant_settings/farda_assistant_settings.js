// Copyright (c) 2026, FardaERP and contributors
frappe.ui.form.on("Farda Assistant Settings", {
	refresh(frm) {
		if (!frm.doc.use_ai) return;
		frm.add_custom_button("آزمایش اتصال", () => {
			if (frm.is_dirty()) {
				frappe.msgprint("اول تغییرات را ذخیره کنید، بعد اتصال را آزمایش کنید.");
				return;
			}
			frappe.call({
				method: "erpnext.farda_iran.assistant.service.test_connection",
				freeze: true,
				freeze_message: "در حال آزمایش اتصال…",
			}).then((r) => {
				const m = r.message || {};
				frappe.msgprint({
					title: m.ok ? "اتصال برقرار است" : "اتصال برقرار نشد",
					indicator: m.ok ? "green" : "red",
					message: frappe.utils.escape_html(m.message || ""),
				});
			});
		});
	},
});
