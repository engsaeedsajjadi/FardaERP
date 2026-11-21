// FardaERP — تنظیمات سامانه مودیان: connection status (from the server's .env) + read-only test.
frappe.ui.form.on("Farda Moadian Settings", {
	refresh(frm) {
		const esc = (s) => frappe.utils.escape_html(s == null ? "" : String(s));
		const wrap = frm.fields_dict.connection_html.$wrapper;
		wrap.html('<div class="text-muted">در حال بررسی…</div>');
		frappe.call("erpnext.farda_iran.moadian.service.get_status").then((r) => {
			const c = (r.message || {}).config || {};
			const yes = (b) => (b ? "✓ موجود" : "✗ پیدا نشد");
			const probs = (c.problems || []).map((p) => `<li>${esc(p)}</li>`).join("");
			wrap.html(`
				<div class="farda-md-target ${c.target === "live" ? "is-live" : "is-sandbox"}">
					<strong>${esc(c.target_label)}</strong><span dir="ltr">${esc(c.base_url)}</span>
				</div>
				<table class="farda-md-sum">
					<tr><th>شناسه یکتای حافظه مالیاتی</th><td dir="ltr">${esc(c.memory_id)}</td></tr>
					<tr><th>کلید خصوصی</th><td>${yes(c.private_key)}</td></tr>
					<tr><th>گواهی امضا</th><td>${yes(c.certificate)}</td></tr>
					<tr><th>ارسال به سامانه اصلی</th><td>${c.allow_live ? "مجاز" : "قفل (فقط محیط آزمایشی)"}</td></tr>
				</table>
				${probs ? `<div class="farda-md-box is-error"><ul>${probs}</ul></div>` : '<div class="farda-md-box is-ok">تنظیمات اتصال کامل است.</div>'}
				<div class="text-muted small">کلید، گواهی و شناسه حافظه فقط در فایل <code>.env</code> سرور نگه‌داری می‌شوند و در پایگاه داده ذخیره نمی‌شوند.</div>`);
		});
		frm.add_custom_button("تست اتصال", () => {
			frappe
				.call({ method: "erpnext.farda_iran.moadian.service.test_connection", freeze: true, freeze_message: "در حال اتصال…" })
				.then((r) => {
					const m = r.message || {};
					frappe.msgprint({
						title: `${m.ok ? "اتصال موفق" : "اتصال ناموفق"} — ${esc(m.target_label)}`,
						indicator: m.ok ? "green" : "red",
						message: m.ok
							? `<pre dir="ltr">${esc(JSON.stringify(m.info, null, 2))}</pre>`
							: `${esc(m.message)}${m.detail ? `<pre dir="ltr" style="white-space:pre-wrap">${esc(m.detail)}</pre>` : ""}`,
					});
				});
		});
	},
});
