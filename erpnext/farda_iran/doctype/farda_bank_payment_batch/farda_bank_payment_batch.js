// FardaERP — پرداخت گروهی بانکی
frappe.ui.form.on("Farda Bank Payment Batch", {
	setup(frm) {
		frm.set_query("payroll_entry", () => ({ filters: { company: frm.doc.company, docstatus: 1 } }));
	},
	refresh(frm) {
		if (frm.is_new()) return;
		const closed = frm.doc.status === "پرداخت شد";
		if (!closed && frm.doc.source !== "دستی") {
			frm.add_custom_button("آوردن ردیف‌ها", () => {
				frm.call("fetch_rows").then((r) => {
					frm.reload_doc();
					const m = r.message || {};
					frappe.show_alert({ message: `${m.count} ردیف آمد`, indicator: "green" });
				});
			});
		}
		if (!closed && (frm.doc.rows || []).length) {
			frm.add_custom_button("ساخت فایل بانک", () => {
				if (frm.is_dirty()) return frappe.msgprint("اول «ذخیره» را بزنید.");
				frm.call("make_bank_file").then((r) => {
					frm.reload_doc();
					if (r.message) window.open(r.message.file_url);
				});
			}).addClass("btn-primary");
		}
		if (frm.doc.status === "فایل ساخته شد") {
			frm.add_custom_button("پرداخت در بانک انجام شد", () => {
				frappe.confirm("فایل را در اینترنت‌بانک بارگذاری کرده‌اید و بانک پرداخت را تأیید کرده است؟", () =>
					frm.call("mark_paid").then(() => frm.reload_doc())
				);
			});
		}
		const bad = (frm.doc.rows || []).filter((r) => r.problem).length;
		if (bad) frm.dashboard.set_headline(`<span class="text-danger">${bad} ردیف ایراد دارد؛ ستون «ایراد» را ببینید.</span>`);
		frm.set_intro("فایل ساخته‌شده را در بخش «پرداخت گروهی» اینترنت‌بانک خود بارگذاری کنید. قبل از اولین استفاده، ستون‌های فایل را با نمونهٔ فایل بانک مقایسه کنید.", "blue");
	},
	bank(frm) {
		if (frm.doc.bank !== "ملت" && frm.doc.file_format !== "پایا گروهی (اکسل)") frm.set_value("file_format", "پایا گروهی (اکسل)");
	},
});
