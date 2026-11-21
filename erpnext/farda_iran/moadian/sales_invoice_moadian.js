// FardaERP — سامانه مودیان on the Sales Invoice form (CORE-034/035).
// The server decides which actions apply (original / correction / return / cancel);
// every send is two-step: preview (offline build + checks) -> explicit confirmation.
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
	const PENDING = ["ارسال شد", "در حال پردازش", "خطای ارسال"];
	const TITLES = {
		original: "ارسال صورتحساب به سامانه مودیان",
		correction: "ارسال صورتحساب اصلاحی",
		return: "ارسال برگشت از فروش",
		cancel: "ابطال صورتحساب در سامانه مودیان",
	};

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
			["موضوع", esc(p.subject)],
			["شماره منحصر به فرد مالیاتی", `<code dir="ltr">${esc(s.taxid)}</code>`],
		];
		if (s.irtaxid) rows.push(["صورتحساب مرجع", `<code dir="ltr">${esc(s.irtaxid)}</code>`]);
		if (p.subject !== "ابطال") {
			rows.push(
				["الگو", esc(s.pattern_label || "فروش")],
				["نوع", s.inty === 2 ? "نوع دوم" : "نوع اول"]
			);
			if (s.buyer) rows.push(["خریدار", `${esc(TOB[s.tob] || "")} — <span dir="ltr">${esc(s.buyer)}</span>`]);
			rows.push(
				["تعداد ردیف", fa(s.lines)],
				["مبلغ پس از تخفیف", `${fa(s.tadis)} ریال`],
				["مالیات بر ارزش افزوده", `${fa(s.tvam)} ریال`]
			);
			if (s.todam) rows.push(["سایر مالیات و عوارض", `${fa(s.todam)} ریال`]);
			rows.push(["مبلغ کل صورتحساب", `<strong>${fa(s.tbill)} ریال</strong>`]);
			if (s.setm_label) rows.push(["روش تسویه", esc(s.setm_label)]);
		}
		const table = rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join("");
		const li = (arr) => (arr || []).map((e) => `<li>${esc(e.message || e)}</li>`).join("");
		const errs = li(v.errors);
		const warns = li(v.warnings);
		const conf = li(cfg.problems);
		return `${target_banner(cfg)}
			<table class="farda-md-sum">${table}</table>
			${errs ? `<div class="farda-md-box is-error"><b>پیش از ارسال این موارد را اصلاح کنید:</b><ul>${errs}</ul></div>` : ""}
			${conf ? `<div class="farda-md-box is-error"><b>تنظیمات اتصال کامل نیست:</b><ul>${conf}</ul>
				<div class="small">این مقادیر را مدیر سیستم در فایل <code>.env</code> سرور وارد می‌کند.</div></div>` : ""}
			${warns ? `<div class="farda-md-box is-warn"><ul>${warns}</ul></div>` : ""}
			${!errs && !conf ? `<div class="farda-md-box is-ok">آماده ارسال است. کد تأیید: <code dir="ltr">${esc(p.confirm_code)}</code></div>` : ""}
			<details class="farda-md-json"><summary>نمایش داده‌های فنی (JSON)</summary>
				<pre dir="ltr">${esc(JSON.stringify(p.invoice, null, 2))}</pre></details>`;
	}

	function open_send_dialog(frm, action) {
		const with_type = action === "original";
		const d = new frappe.ui.Dialog({
			title: TITLES[action],
			size: "large",
			fields: [
				...(with_type
					? [
							{
								fieldname: "invoice_type",
								fieldtype: "Select",
								label: "نوع صورتحساب",
								options: [
									{ value: "", label: "طبق فاکتور / تنظیمات" },
									{ value: "1", label: "نوع اول (با اطلاعات خریدار)" },
									{ value: "2", label: "نوع دوم (بدون الزام اطلاعات خریدار)" },
								],
								change: () => load(),
							},
					  ]
					: []),
				{ fieldname: "preview", fieldtype: "HTML" },
				{
					fieldname: "agree",
					fieldtype: "Check",
					label: "اطلاعات بالا را بررسی کردم و ارسال همین صورتحساب را تأیید می‌کنم",
					change: () => toggle(),
				},
			],
			primary_action_label: action === "cancel" ? "ارسال ابطالیه" : "ارسال به سامانه",
			primary_action: () => submit(),
		});
		let current = null;
		const toggle = () => d.get_primary_btn().prop("disabled", !(current && current.confirm_code && d.get_value("agree")));
		const load = () => {
			d.fields_dict.preview.$wrapper.html('<div class="text-muted">در حال آماده‌سازی…</div>');
			current = null;
			toggle();
			frappe
				.call({
					method: M + "prepare",
					args: { sales_invoice: frm.doc.name, action, invoice_type: with_type ? d.get_value("invoice_type") || null : null },
				})
				.then((r) => {
					current = r.message;
					d.set_title(current.subject === "ابطال" && action !== "cancel" ? TITLES.cancel : TITLES[action]);
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
		frappe.call({ method: M + "inquire", args: { log }, freeze: true, freeze_message: "در حال استعلام…" }).then((r) => {
			const m = r.message || {};
			frappe.msgprint({
				title: `وضعیت در سامانه: ${m.status}`,
				message: `<div style="white-space:pre-wrap">${esc(m.messages || "")}</div>`,
				indicator: STATUS_COLOR[m.status] || "blue",
			});
			frm.reload_doc();
		});
	}

	function resolve_unknown(frm, log) {
		frappe.confirm(
			"ارسال قبلی با خطای ارتباط تمام شد و شناسه پیگیری ندارد. در کارپوشه بررسی کنید: آیا این صورتحساب آنجا ثبت شده است؟<br><br>«بله» = ثبت شده · «خیر» = ثبت نشده (می‌توانید دوباره بفرستید)",
			() => frappe.call(M + "resolve_unknown", { log, registered: 1 }).then(() => frm.reload_doc()),
			() => frappe.call(M + "resolve_unknown", { log, registered: 0 }).then(() => frm.reload_doc())
		);
	}

	frappe.ui.form.on("Sales Invoice", {
		onload(frm) {
			if (frm.is_new() && !frm.doc.farda_moadian_pattern) {
				frappe.call(M + "default_pattern").then((r) => r.message && frm.set_value("farda_moadian_pattern", r.message));
			}
		},
		farda_moadian_pattern(frm) {
			frm.refresh_field("items");
		},
		refresh(frm) {
			if (frm.is_new() || frm.doc.docstatus === 0) return;
			if (!frappe.model.can_submit("Sales Invoice") && !frappe.user.has_role("Accounts Manager")) return;
			frappe.call({ method: M + "get_status", args: { sales_invoice: frm.doc.name } }).then((r) => {
				const st = r.message || {};
				if (!st.enabled) return;
				const G = "سامانه مودیان";
				(st.actions || []).forEach((a) => frm.add_custom_button(a.label, () => open_send_dialog(frm, a.action), G));
				const logs = st.logs || [];
				logs.filter((l) => PENDING.includes(l.status)).forEach((l) => {
					if (l.uid) frm.add_custom_button(`استعلام وضعیت (${l.subject})`, () => inquire(frm, l.name), G);
					else if (frappe.user.has_role("Accounts Manager") || frappe.user.has_role("System Manager"))
						frm.add_custom_button(`ثبت نتیجه بررسی کارپوشه (${l.subject})`, () => resolve_unknown(frm, l.name), G);
				});
				if (logs.length) {
					frm.add_custom_button("سوابق ارسال", () => frappe.set_route("List", "Farda Moadian Log", { chain_root: st.chain_root }), G);
				}
				const last = logs.find((l) => l.status !== "آماده ارسال");
				if (last) {
					frm.dashboard.add_indicator(`سامانه مودیان: ${last.subject} — ${last.status}`, STATUS_COLOR[last.status] || "gray");
				} else if (frm.doc.docstatus === 1) {
					frm.dashboard.add_indicator("سامانه مودیان: ارسال نشده", "gray");
				}
				if (st.notice) frm.dashboard.set_headline(`<span class="text-muted">${esc(st.notice)}</span>`);
			});
		},
	});
})();
