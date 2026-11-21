// FardaERP — سامانه مودیان on the Sales Invoice form (CORE-034).
// Two-step send: preview (offline build + checks) -> explicit confirmation -> send.
(() => {
	const M = "erpnext.farda_iran.moadian.service.";
	const fa = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("fa-IR"));
	const esc = (s) => frappe.utils.escape_html(s == null ? "" : String(s));
	const STATUS_COLOR = {
		"آماده ارسال": "gray",
		"ارسال شد": "blue",
		"در حال پردازش": "orange",
		"ثبت شد": "green",
		"رد شد": "red",
		"یافت نشد": "red",
		"خطای ارسال": "red",
	};
	const TOB = { 1: "حقیقی", 2: "حقوقی", 3: "مشارکت مدنی", 4: "اتباع غیرایرانی" };

	function target_banner(cfg) {
		const live = cfg.target === "live";
		return `<div class="farda-md-target ${live ? "is-live" : "is-sandbox"}">
			<strong>${esc(cfg.target_label)}</strong>
			<span>${live ? "صورتحساب با اثر قانونی ثبت می‌شود." : "ارسال آزمایشی است و اثر قانونی ندارد."}</span>
		</div>`;
	}

	function render_preview(p) {
		const s = p.summary || {};
		const v = p.validation || { errors: [], warnings: [] };
		const cfg = p.config || {};
		const rows = [
			["شماره منحصر به فرد مالیاتی", `<code dir="ltr">${esc(s.taxid)}</code>`],
			["موضوع", p.subject === "ابطال" ? `ابطال صورتحساب <code dir="ltr">${esc(s.irtaxid)}</code>` : "صورتحساب اصلی"],
		];
		if (p.subject !== "ابطال") {
			rows.push(
				["نوع", s.inty === 2 ? "نوع دوم" : "نوع اول"],
				["خریدار", s.buyer ? `${esc(TOB[s.tob] || "")} — <span dir="ltr">${esc(s.buyer)}</span>` : "—"],
				["تعداد ردیف", fa(s.lines)],
				["مبلغ پس از تخفیف", `${fa(s.tadis)} ریال`],
				["مالیات بر ارزش افزوده", `${fa(s.tvam)} ریال`],
				["مبلغ کل صورتحساب", `<strong>${fa(s.tbill)} ریال</strong>`],
				["روش تسویه", esc(s.setm_label || "—")]
			);
		}
		const table = rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join("");
		const errs = (v.errors || []).map((e) => `<li>${esc(e.message)}</li>`).join("");
		const warns = (v.warnings || []).map((e) => `<li>${esc(e.message)}</li>`).join("");
		const conf = (cfg.problems || []).map((e) => `<li>${esc(e)}</li>`).join("");
		return `${target_banner(cfg)}
			<table class="farda-md-sum">${table}</table>
			${errs ? `<div class="farda-md-box is-error"><b>پیش از ارسال این موارد را اصلاح کنید:</b><ul>${errs}</ul></div>` : ""}
			${conf ? `<div class="farda-md-box is-error"><b>تنظیمات اتصال کامل نیست:</b><ul>${conf}</ul>
				<div class="text-muted small">مقادیر را مدیر سیستم در فایل <code>.env</code> سرور وارد می‌کند.</div></div>` : ""}
			${warns ? `<div class="farda-md-box is-warn"><ul>${warns}</ul></div>` : ""}
			${!errs && !conf ? `<div class="farda-md-box is-ok">صورتحساب آماده ارسال است. کد تأیید: <code dir="ltr">${esc(p.confirm_code)}</code></div>` : ""}
			<details class="farda-md-json"><summary>نمایش داده‌های فنی (JSON)</summary>
				<pre dir="ltr">${esc(JSON.stringify(p.invoice, null, 2))}</pre></details>`;
	}

	function open_send_dialog(frm, subject) {
		const is_cancel = subject === "cancel";
		const d = new frappe.ui.Dialog({
			title: is_cancel ? "ابطال صورتحساب در سامانه مودیان" : "ارسال به سامانه مودیان",
			size: "large",
			fields: [
				...(is_cancel
					? []
					: [
							{
								fieldname: "invoice_type",
								fieldtype: "Select",
								label: "نوع صورتحساب",
								options: [
									{ value: "", label: "طبق تنظیمات" },
									{ value: "1", label: "نوع اول (با اطلاعات خریدار)" },
									{ value: "2", label: "نوع دوم (بدون الزام اطلاعات خریدار)" },
								],
								change: () => load(),
							},
					  ]),
				{ fieldname: "preview", fieldtype: "HTML" },
				{
					fieldname: "agree",
					fieldtype: "Check",
					label: "اطلاعات بالا را بررسی کردم و ارسال همین صورتحساب را تأیید می‌کنم",
					change: () => toggle(),
				},
			],
			primary_action_label: is_cancel ? "ارسال ابطالیه" : "ارسال به سامانه",
			primary_action: () => submit(),
		});
		let current = null;
		const toggle = () => {
			const ok = current && current.confirm_code && d.get_value("agree");
			d.get_primary_btn().prop("disabled", !ok);
		};
		const load = () => {
			d.fields_dict.preview.$wrapper.html('<div class="text-muted">در حال آماده‌سازی…</div>');
			current = null;
			toggle();
			frappe
				.call({
					method: M + "prepare",
					args: {
						sales_invoice: frm.doc.name,
						subject: is_cancel ? "cancel" : "original",
						invoice_type: is_cancel ? null : d.get_value("invoice_type") || null,
					},
				})
				.then((r) => {
					current = r.message;
					d.fields_dict.preview.$wrapper.html(render_preview(current));
					toggle();
				})
				.catch(() => d.fields_dict.preview.$wrapper.html('<div class="text-danger">آماده‌سازی انجام نشد.</div>'));
		};
		const submit = () => {
			if (!current || !current.confirm_code) return;
			d.get_primary_btn().prop("disabled", true);
			frappe
				.call({
					method: M + "send",
					args: { log: current.log, confirm_code: current.confirm_code },
					freeze: true,
					freeze_message: "در حال ارسال به سامانه مودیان…",
				})
				.then((r) => {
					d.hide();
					const m = r.message || {};
					frappe.msgprint({
						title: `سامانه مودیان: ${m.status}`,
						message: `<div style="white-space:pre-wrap">${esc(m.messages)}</div>`,
						indicator: STATUS_COLOR[m.status] || "blue",
					});
					frm.reload_doc();
				})
				.catch(() => toggle());
		};
		d.show();
		load();
	}

	function inquire(frm, log) {
		frappe
			.call({ method: M + "inquire", args: { log }, freeze: true, freeze_message: "در حال استعلام…" })
			.then((r) => {
				const m = r.message || {};
				frappe.msgprint({
					title: `وضعیت در سامانه: ${m.status}`,
					message: `<div style="white-space:pre-wrap">${esc(m.messages || "")}</div>`,
					indicator: STATUS_COLOR[m.status] || "blue",
				});
				frm.reload_doc();
			});
	}

	frappe.ui.form.on("Sales Invoice", {
		refresh(frm) {
			if (frm.is_new() || frm.doc.docstatus === 0 || frm.doc.is_return) return;
			if (!frappe.model.can_submit("Sales Invoice") && !frappe.user.has_role("Accounts Manager")) return;
			frappe.call({ method: M + "get_status", args: { sales_invoice: frm.doc.name } }).then((r) => {
				const st = r.message || {};
				if (!st.enabled) return;
				const logs = st.logs || [];
				const orig = logs.find((l) => l.subject === "اصلی" && l.status !== "رد شد" && l.status !== "یافت نشد");
				const cancel = logs.find((l) => l.subject === "ابطال" && l.status !== "رد شد" && l.status !== "یافت نشد");
				const G = "سامانه مودیان";
				const pending = (l) => l && ["ارسال شد", "در حال پردازش", "خطای ارسال"].includes(l.status);

				if (frm.doc.docstatus === 1 && (!orig || orig.status === "آماده ارسال")) {
					frm.add_custom_button("ارسال به سامانه مودیان", () => open_send_dialog(frm, "original"), G);
				}
				[orig, cancel].filter(pending).forEach((l) =>
					frm.add_custom_button(
						l.subject === "ابطال" ? "استعلام وضعیت ابطالیه" : "استعلام وضعیت",
						() => inquire(frm, l.name),
						G
					)
				);
				if (orig && orig.status === "ثبت شد" && (!cancel || cancel.status === "آماده ارسال")) {
					frm.add_custom_button("ابطال در سامانه مودیان", () => open_send_dialog(frm, "cancel"), G);
				}
				if (logs.length) {
					frm.add_custom_button("سوابق ارسال", () => frappe.set_route("List", "Farda Moadian Log", { sales_invoice: frm.doc.name }), G);
				}
				const shown = cancel && cancel.status !== "آماده ارسال" ? cancel : orig;
				if (shown && shown.status !== "آماده ارسال") {
					const label = shown.subject === "ابطال" ? `ابطال در سامانه مودیان: ${shown.status}` : `سامانه مودیان: ${shown.status}`;
					frm.dashboard.add_indicator(label, STATUS_COLOR[shown.status] || "gray");
				} else if (frm.doc.docstatus === 1) {
					frm.dashboard.add_indicator("سامانه مودیان: ارسال نشده", "gray");
				}
			});
		},
	});
})();
