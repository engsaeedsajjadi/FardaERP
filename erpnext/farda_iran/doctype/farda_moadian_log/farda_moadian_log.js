frappe.ui.form.on("Farda Moadian Log", {
	refresh(frm) {
		if (frm.doc.uid && ["ارسال شد", "در حال پردازش", "خطای ارسال"].includes(frm.doc.status)) {
			frm.add_custom_button("استعلام وضعیت", () =>
				frappe
					.call({ method: "erpnext.farda_iran.moadian.service.inquire", args: { log: frm.doc.name }, freeze: true })
					.then(() => frm.reload_doc())
			);
		}
	},
});
