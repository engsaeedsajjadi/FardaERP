frappe.listview_settings["Farda Moadian Log"] = {
	add_fields: ["status", "subject"],
	get_indicator(doc) {
		const color = {
			"آماده ارسال": "gray",
			"ارسال شد": "blue",
			"در حال پردازش": "orange",
			"ثبت شد": "green",
			"رد شد": "red",
			"یافت نشد": "red",
			"خطای ارسال": "red",
		}[doc.status];
		return [doc.status, color || "gray", "status,=," + doc.status];
	},
};
