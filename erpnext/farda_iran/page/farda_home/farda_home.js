// FardaERP — Persian home (CORE-022).
// The first screen a Persian user sees: who/when/which company, the actions
// people do every day, live figures, what is due, and a plain-language map of
// everything the product can do. Real data only; every link respects permissions.

frappe.pages["farda-home"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: "سیمراکس", single_column: true });
	wrapper.farda_home = new FardaHome(wrapper, page);
};

frappe.pages["farda-home"].on_page_show = function (wrapper) {
	if (wrapper.farda_home) wrapper.farda_home.refresh();
};

class FardaHome {
	constructor(wrapper, page) {
		this.wrapper = $(wrapper);
		this.page = page;
		this.ratio = (frappe.boot.farda_iran && frappe.boot.farda_iran.irr_per_toman) || 10;
		this.company = frappe.defaults.get_user_default("Company") || frappe.defaults.get_global_default("company");
		this.wrapper.find(".page-head").addClass("farda-home-hide");
		this.$root = $('<div class="farda-home" dir="rtl" lang="fa"></div>').appendTo(this.page.main);
		this.render_shell();
		this.refresh();
	}

	// ------------------------------------------------------------------ helpers
	fa(n) {
		return Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: 0 });
	}
	toman(irr) {
		const t = Math.round((Number(irr) || 0) / this.ratio);
		return { num: this.fa(Math.abs(t)), neg: t < 0 };
	}
	esc(s) {
		return frappe.utils.escape_html(s == null ? "" : String(s));
	}
	jalali(date) {
		if (!date) return "";
		const d = typeof date === "string" ? frappe.datetime.str_to_obj(date) : date;
		const [jy, jm, jd] = window.FardaIR.gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
		return { jy, jm, jd };
	}
	jalali_text(date) {
		const j = this.jalali(date);
		return j ? `${this.fa(j.jd)} ${FardaHome.MONTHS[j.jm - 1]} ${String(j.jy).replace(/\d/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[c])}` : "";
	}
	can(doctype) {
		return !doctype || frappe.model.can_read(doctype);
	}
	icon(name) {
		const p = FardaHome.ICONS[name] || FardaHome.ICONS.dot;
		return `<svg class="fh-ico" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
	}
	go(target) {
		// target: ["new", doctype] | ["list", doctype] | ["report", name] | ["form", doctype] | ["tree", doctype] | ["route", ...]
		const [kind, a, b] = target;
		if (kind === "new") return frappe.new_doc(a);
		if (kind === "list") return frappe.set_route("List", a);
		if (kind === "report") return frappe.set_route("query-report", a);
		if (kind === "form") return frappe.set_route("Form", a, b || a);
		if (kind === "tree") return frappe.set_route("Tree", a);
		return frappe.set_route(...target.slice(1));
	}
	link(label, target, cls = "") {
		const id = "fh" + Math.random().toString(36).slice(2, 9);
		this._links[id] = target;
		return `<a href="#" class="${cls}" data-fh="${id}">${label}</a>`;
	}
	async call(method, args) {
		try {
			const r = await frappe.call({ method, args, freeze: false, async: true });
			return r && r.message;
		} catch (e) {
			return null;
		}
	}
	count(doctype, filters) {
		if (!this.can(doctype)) return Promise.resolve(null);
		return this.call("frappe.client.get_count", { doctype, filters: filters || {} });
	}

	// ------------------------------------------------------------------ layout
	render_shell() {
		this._links = {};
		const user = frappe.boot.user || {};
		const name = user.first_name || frappe.session.user_fullname || "";
		const today = frappe.datetime.now_date();
		const j = this.jalali(today);
		const weekday = FardaHome.WEEKDAYS[frappe.datetime.str_to_obj(today).getDay()];

		this.$root.html(`
			<section class="fh-hero">
				<div class="fh-hero-text">
					<img class="fh-brand" src="/assets/erpnext/farda_iran/brand/simorax-logo-fa-on-dark.svg" alt="سیمراکس">
					<p class="fh-greet">سلام${name ? "، " + this.esc(name) : ""}</p>
					<h1 class="fh-date"><span class="fh-day">${this.fa(j.jd)}</span> ${FardaHome.MONTHS[j.jm - 1]}
						<span class="fh-year">${weekday}، ${String(j.jy).replace(/\d/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[c])}</span></h1>
					<p class="fh-sub">فروش، خرید، انبار، بانک و چک، و مالیات بر ارزش افزوده — همه در یک جا.</p>
				</div>
				<label class="fh-company">
					<span>شرکت</span>
					<select class="fh-company-select" aria-label="انتخاب شرکت"></select>
				</label>
			</section>

			<nav class="fh-actions" aria-label="کارهای پرتکرار">
				${FardaHome.ACTIONS.filter((a) => this.can(a.doctype))
					.map((a) => this.link(`${this.icon(a.icon)}<span>${a.label}</span>`, ["new", a.doctype], "fh-action"))
					.join("")}
			</nav>

			<section class="fh-kpis" aria-label="وضعیت این ماه">
				<header class="fh-section-head">
					<h2>وضعیت ${FardaHome.MONTHS[j.jm - 1]}</h2>
					<p>مبالغ به تومان، از اسناد ثبت‌نهایی‌شده</p>
				</header>
				<div class="fh-kpi-strip">${FardaHome.KPIS.map(
					(k) => `<button type="button" class="fh-kpi" data-kpi="${k.key}" data-fh-go='${JSON.stringify(k.go)}'>
						<span class="fh-kpi-label">${k.label}</span>
						<span class="fh-kpi-value fh-skeleton">—</span>
						<span class="fh-kpi-hint">${k.hint}</span>
					</button>`
				).join("")}</div>
			</section>

			<div class="fh-grid">
				<section class="fh-modules" aria-label="قابلیت‌ها">
					<header class="fh-section-head">
						<h2>بخش‌های برنامه</h2>
						<p>بخش‌های سیمراکس و کاری که هر کدام انجام می‌دهد — <a class="fh-all-modules" href="/desk">نمای همهٔ ماژول‌ها</a></p>
					</header>
					<div class="fh-module-list">${FardaHome.MODULES.map((m) => this.module_row(m)).join("")}</div>
				</section>

				<aside class="fh-side">
					<section class="fh-panel fh-setup" hidden>
						<header class="fh-panel-head"><h3>راه‌اندازی</h3><span class="fh-progress"></span></header>
						<ol class="fh-steps"></ol>
					</section>
					<section class="fh-panel">
						<header class="fh-panel-head"><h3>چک‌های سررسید ۱۴ روز آینده</h3>${this.link("همه", ["report", "Farda Cheque Report"], "fh-more")}</header>
						<ul class="fh-list fh-cheques"><li class="fh-empty">در حال بارگذاری…</li></ul>
					</section>
					<section class="fh-panel">
						<header class="fh-panel-head"><h3>آخرین فاکتورهای فروش</h3>${this.link("همه", ["list", "Sales Invoice"], "fh-more")}</header>
						<ul class="fh-list fh-invoices"><li class="fh-empty">در حال بارگذاری…</li></ul>
					</section>
				</aside>
			</div>

			<section class="fh-panel fh-chart-panel">
				<header class="fh-panel-head"><h3>فروش شش ماه اخیر</h3><span class="fh-muted">تومان، بر اساس ماه شمسی</span></header>
				<div class="fh-chart"></div>
			</section>
		`);

		this.$root.on("click", "[data-fh]", (e) => {
			e.preventDefault();
			const t = this._links[e.currentTarget.dataset.fh];
			if (t) this.go(t);
		});
		this.$root.on("click", ".fh-all-modules", (e) => {
			e.preventDefault();
			try { sessionStorage.setItem("farda_show_grid", "1"); } catch (err) { /* private mode */ }
			window.location.href = "/desk";
		});
		this.$root.on("click", "[data-fh-go]", (e) => this.go(JSON.parse(e.currentTarget.dataset.fhGo)));
		this.$root.on("change", ".fh-company-select", (e) => {
			this.company = e.target.value;
			this.refresh();
		});
	}

	module_row(m) {
		const links = m.links.filter((l) => this.can(l.doctype || (l.go[0] !== "report" ? l.go[1] : null)));
		if (!links.length) return "";
		return `<article class="fh-module">
			<div class="fh-module-icon">${this.icon(m.icon)}</div>
			<div class="fh-module-body">
				<h3>${m.title}</h3>
				<p>${m.desc}</p>
				<div class="fh-module-links">${links.map((l) => this.link(l.label, l.go, l.report ? "is-report" : "")).join("")}</div>
			</div>
		</article>`;
	}

	// ------------------------------------------------------------------ data
	refresh() {
		this.load_companies();
		this.load_kpis();
		this.load_setup();
		this.load_cheques();
		this.load_invoices();
		this.load_chart();
	}

	async load_companies() {
		const rows = (await this.call("frappe.client.get_list", { doctype: "Company", fields: ["name"], limit_page_length: 50 })) || [];
		if (!this.company && rows.length) this.company = rows[0].name;
		this.$root
			.find(".fh-company-select")
			.html(rows.map((r) => `<option value="${this.esc(r.name)}" ${r.name === this.company ? "selected" : ""}>${this.esc(r.name)}</option>`).join(""));
	}

	async load_kpis() {
		// figures for the current JALALI month, matching the «وضعیت <ماه>» heading
		const j = this.jalali(frappe.datetime.now_date());
		const g = window.FardaIR.jalaliToGregorian(j.jy, j.jm, 1);
		const from_date = `${g[0]}-${String(g[1]).padStart(2, "0")}-${String(g[2]).padStart(2, "0")}`;
		const k = await this.call("erpnext.farda_iran.dashboard.kpis.farda_kpis", {
			company: this.company,
			from_date,
			to_date: frappe.datetime.now_date(),
		});
		FardaHome.KPIS.forEach((def) => {
			const $v = this.$root.find(`.fh-kpi[data-kpi="${def.key}"] .fh-kpi-value`).removeClass("fh-skeleton");
			const item = k && k[def.key];
			if (!item) return $v.text("—");
			const t = this.toman(item.irr);
			$v.html(`${t.neg ? '<span class="fh-neg">منفی</span> ' : ""}${t.num}`).toggleClass("is-negative", t.neg);
		});
	}

	async load_setup() {
		const today_si = { docstatus: 1 };
		const vat_account = await this.call("frappe.client.get_single_value", { doctype: "Farda VAT Settings", field: "vat_account" });
		const checks = await Promise.all([
			this.count("Company"),
			Promise.resolve(vat_account ? 1 : 0),
			this.count("Bank Account", { is_company_account: 1 }),
			this.count("Item", { disabled: 0 }),
			this.count("Customer", { disabled: 0 }),
			this.count("Sales Invoice", today_si),
		]);
		const steps = FardaHome.SETUP.map((s, i) => ({ ...s, done: (checks[i] || 0) > 0, known: checks[i] !== null }));
		const visible = steps.filter((s) => s.known);
		const done = visible.filter((s) => s.done).length;
		const $panel = this.$root.find(".fh-setup");
		if (!visible.length || done === visible.length) return $panel.attr("hidden", true);
		$panel.removeAttr("hidden");
		$panel.find(".fh-progress").text(`${this.fa(done)} از ${this.fa(visible.length)}`);
		$panel.find(".fh-steps").html(
			visible
				.map(
					(s) => `<li class="${s.done ? "is-done" : ""}">
					<span class="fh-step-text"><strong>${s.title}</strong><small>${s.hint}</small></span>
					${s.done ? '<span class="fh-check" aria-label="انجام شد">✓</span>' : this.link(s.cta, s.go, "fh-step-cta")}
				</li>`
				)
				.join("")
		);
	}

	async load_cheques() {
		const $ul = this.$root.find(".fh-cheques");
		if (!this.can("Cheque")) return $ul.closest(".fh-panel").attr("hidden", true);
		const limit = frappe.datetime.add_days(frappe.datetime.now_date(), 14);
		const filters = [["status", "in", ["Received", "Issued", "Deposited"]], ["due_date", "<=", limit]];
		if (this.company) filters.push(["company", "=", this.company]);
		const rows =
			(await this.call("frappe.client.get_list", {
				doctype: "Cheque",
				fields: ["name", "direction", "party", "amount", "due_date", "cheque_number"],
				filters,
				order_by: "due_date asc",
				limit_page_length: 6,
			})) || [];
		if (!rows.length) return $ul.html('<li class="fh-empty">چکی در دو هفتهٔ آینده سررسید نمی‌شود.</li>');
		const today = frappe.datetime.now_date();
		$ul.html(
			rows
				.map((r) => {
					const late = r.due_date < today;
					const dir = r.direction === "Issued" ? "پرداختی" : "دریافتی";
					return `<li>${this.link(
						`<span class="fh-li-main"><strong>${this.esc(r.party || r.cheque_number || r.name)}</strong>
							<small class="${late ? "is-late" : ""}">${dir} · سررسید ${this.jalali_text(r.due_date)}${late ? " (گذشته)" : ""}</small></span>
						<span class="fh-li-amount">${this.toman(r.amount).num}</span>`,
						["form", "Cheque", r.name],
						"fh-li-link"
					)}</li>`;
				})
				.join("")
		);
	}

	async load_invoices() {
		const $ul = this.$root.find(".fh-invoices");
		if (!this.can("Sales Invoice")) return $ul.closest(".fh-panel").attr("hidden", true);
		const filters = [["docstatus", "<", 2]];
		if (this.company) filters.push(["company", "=", this.company]);
		const rows =
			(await this.call("frappe.client.get_list", {
				doctype: "Sales Invoice",
				fields: ["name", "customer_name", "base_grand_total", "posting_date", "status", "docstatus"],
				filters,
				order_by: "creation desc",
				limit_page_length: 6,
			})) || [];
		if (!rows.length)
			return $ul.html(`<li class="fh-empty">هنوز فاکتوری ثبت نشده. ${this.link("اولین فاکتور فروش را بسازید", ["new", "Sales Invoice"])}</li>`);
		$ul.html(
			rows
				.map(
					(r) => `<li>${this.link(
						`<span class="fh-li-main"><strong>${this.esc(r.customer_name)}</strong>
							<small>${this.jalali_text(r.posting_date)} · <span class="fh-status s-${frappe.scrub(r.status || "")}">${__(r.status)}</span></small></span>
						<span class="fh-li-amount">${this.toman(r.base_grand_total).num}</span>`,
						["form", "Sales Invoice", r.name],
						"fh-li-link"
					)}</li>`
				)
				.join("")
		);
	}

	async load_chart() {
		const $c = this.$root.find(".fh-chart");
		if (!this.can("Sales Invoice")) return $c.closest(".fh-panel").attr("hidden", true);
		// six Jalali months ending with the current one
		const now = this.jalali(frappe.datetime.now_date());
		const months = [];
		let jy = now.jy, jm = now.jm;
		for (let i = 0; i < 6; i++) {
			months.unshift({ jy, jm, total: 0 });
			jm -= 1;
			if (jm === 0) { jm = 12; jy -= 1; }
		}
		const [gy, gm, gd] = window.FardaIR.jalaliToGregorian(months[0].jy, months[0].jm, 1);
		const from = `${gy}-${String(gm).padStart(2, "0")}-${String(gd).padStart(2, "0")}`;
		const filters = [["docstatus", "=", 1], ["posting_date", ">=", from]];
		if (this.company) filters.push(["company", "=", this.company]);
		const rows =
			(await this.call("frappe.client.get_list", {
				doctype: "Sales Invoice",
				fields: ["posting_date", { SUM: "base_grand_total", as: "total" }],
				filters,
				group_by: "posting_date",
				order_by: "posting_date asc",
				limit_page_length: 400,
			})) || [];
		rows.forEach((r) => {
			const j = this.jalali(r.posting_date);
			const m = months.find((x) => x.jy === j.jy && x.jm === j.jm);
			if (m) m.total += Number(r.total) || 0;
		});
		if (!months.some((m) => m.total)) {
			return $c.html('<p class="fh-empty">در شش ماه اخیر فروش ثبت‌نهایی‌شده‌ای وجود ندارد.</p>');
		}
		$c.empty();
		new frappe.Chart($c[0], {
			type: "bar",
			height: 220,
			colors: [document.documentElement.dataset.theme === "dark" ? "#c9ced6" : "#2a3650"],
			data: {
				labels: months.map((m) => FardaHome.MONTHS[m.jm - 1]),
				datasets: [{ name: "فروش", values: months.map((m) => Math.round(m.total / this.ratio)) }],
			},
			barOptions: { spaceRatio: 0.45 },
			axisOptions: { xIsSeries: true },
			tooltipOptions: { formatTooltipY: (v) => `${this.fa(v)} تومان` },
		});
	}
}

FardaHome.MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
FardaHome.WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

FardaHome.ACTIONS = [
	{ label: "فاکتور فروش", doctype: "Sales Invoice", icon: "receipt" },
	{ label: "دریافت و پرداخت", doctype: "Payment Entry", icon: "cash" },
	{ label: "فاکتور خرید", doctype: "Purchase Invoice", icon: "cart" },
	{ label: "ثبت چک", doctype: "Cheque", icon: "cheque" },
	{ label: "سند انبار", doctype: "Stock Entry", icon: "box" },
	{ label: "مشتری جدید", doctype: "Customer", icon: "user" },
];

FardaHome.KPIS = [
	{ key: "sales", label: "فروش", hint: "فاکتورهای این ماه", go: ["report", "Farda Sales Register"] },
	{ key: "receivables", label: "طلب از مشتریان", hint: "مانده دریافتنی", go: ["report", "Farda Party Balance"] },
	{ key: "payables", label: "بدهی به تأمین‌کنندگان", hint: "مانده پرداختنی", go: ["report", "Farda Party Balance"] },
	{ key: "cash_balance", label: "نقد و بانک", hint: "مانده حساب‌ها", go: ["report", "Farda Bank Report"] },
	{ key: "inventory_value", label: "ارزش موجودی", hint: "کالاهای انبار", go: ["report", "Farda Stock Balance"] },
	{ key: "vat_net", label: "مالیات قابل پرداخت", hint: "ارزش افزوده این ماه", go: ["report", "Farda VAT Report"] },
];

FardaHome.SETUP = [
	{ title: "اطلاعات شرکت", hint: "نام، شناسهٔ ملی و نشانی", cta: "تکمیل", go: ["list", "Company"] },
	{ title: "مالیات بر ارزش افزوده", hint: "حساب مالیات و نرخ ۱۰٪", cta: "تنظیم", go: ["form", "Farda VAT Settings"] },
	{ title: "حساب بانکی شرکت", hint: "با شمارهٔ شبا", cta: "افزودن", go: ["new", "Bank Account"] },
	{ title: "اولین کالا یا خدمت", hint: "برای استفاده در فاکتورها", cta: "افزودن", go: ["new", "Item"] },
	{ title: "اولین مشتری", hint: "با کد ملی یا شناسهٔ ملی", cta: "افزودن", go: ["new", "Customer"] },
	{ title: "اولین فاکتور فروش", hint: "صدور و ثبت نهایی", cta: "صدور", go: ["new", "Sales Invoice"] },
];

FardaHome.MODULES = [
	{
		title: "فروش و مشتریان",
		icon: "receipt",
		desc: "پیش‌فاکتور، سفارش و فاکتور فروش صادر کنید و طلب هر مشتری را پیگیری کنید.",
		links: [
			{ label: "مشتریان", go: ["list", "Customer"] },
			{ label: "پیش‌فاکتورها", go: ["list", "Quotation"] },
			{ label: "سفارش‌های فروش", go: ["list", "Sales Order"] },
			{ label: "ویزیتور (سفارش‌گیری با موبایل)", go: ["route", "farda-visitor"], doctype: "Sales Order" },
			{ label: "فاکتورهای فروش", go: ["list", "Sales Invoice"] },
			{ label: "گزارش فروش", go: ["report", "Farda Sales Register"], report: 1 },
		],
	},
	{
		title: "خرید و تأمین‌کنندگان",
		icon: "cart",
		desc: "درخواست و سفارش خرید ثبت کنید، فاکتور تأمین‌کننده را وارد کنید و بدهی‌ها را ببینید.",
		links: [
			{ label: "تأمین‌کنندگان", go: ["list", "Supplier"] },
			{ label: "درخواست‌های کالا", go: ["list", "Material Request"] },
			{ label: "سفارش‌های خرید", go: ["list", "Purchase Order"] },
			{ label: "فاکتورهای خرید", go: ["list", "Purchase Invoice"] },
			{ label: "گزارش خرید", go: ["report", "Farda Purchase Register"], report: 1 },
		],
	},
	{
		title: "انبار و کالا",
		icon: "box",
		desc: "کالا و انبار تعریف کنید، ورود، خروج و انتقال را ثبت کنید و موجودی لحظه‌ای را ببینید.",
		links: [
			{ label: "کالاها", go: ["list", "Item"] },
			{ label: "انبارها", go: ["list", "Warehouse"] },
			{ label: "اسناد انبار", go: ["list", "Stock Entry"] },
			{ label: "موجودی کالا", go: ["report", "Farda Stock Balance"], report: 1 },
			{ label: "کاردکس کالا", go: ["report", "Farda Stock Movement"], report: 1 },
		],
	},
	{
		title: "بانک و چک",
		icon: "cheque",
		desc: "حساب‌های بانکی را با شبا ثبت کنید و چک‌های دریافتی و پرداختی را تا وصول دنبال کنید.",
		links: [
			{ label: "حساب‌های بانکی", go: ["list", "Bank Account"] },
			{ label: "چک‌ها", go: ["list", "Cheque"] },
			{ label: "دریافت و پرداخت", go: ["list", "Payment Entry"] },
			{ label: "گزارش بانک", go: ["report", "Farda Bank Report"], report: 1 },
			{ label: "گزارش چک", go: ["report", "Farda Cheque Report"], report: 1 },
		],
	},
	{
		title: "حسابداری و صورت‌های مالی",
		icon: "ledger",
		desc: "سند حسابداری ثبت کنید و دفتر کل، تراز، سود و زیان و ترازنامه را با تاریخ شمسی بگیرید.",
		links: [
			{ label: "سرفصل حساب‌ها", go: ["tree", "Account"], doctype: "Account" },
			{ label: "اسناد حسابداری", go: ["list", "Journal Entry"] },
			{ label: "دفتر کل", go: ["report", "Farda General Ledger"], report: 1 },
			{ label: "تراز آزمایشی", go: ["report", "Farda Trial Balance"], report: 1 },
			{ label: "سود و زیان", go: ["report", "Farda Profit and Loss"], report: 1 },
			{ label: "ترازنامه", go: ["report", "Farda Balance Sheet"], report: 1 },
			{ label: "جریان وجوه نقد", go: ["report", "Farda Cash Flow"], report: 1 },
		],
	},
	{
		title: "مالیات بر ارزش افزوده",
		icon: "percent",
		desc: "نرخ مالیات و معافیت مشتری یا کالا را تعیین کنید؛ فاکتورها خودکار محاسبه می‌شوند.",
		links: [
			{ label: "تنظیمات ارزش افزوده", go: ["form", "Farda VAT Settings"], doctype: "Farda VAT Settings" },
			{ label: "قالب‌های مالیاتی کالا", go: ["list", "Item Tax Template"] },
			{ label: "گزارش ارزش افزوده", go: ["report", "Farda VAT Report"], report: 1 },
			{ label: "مانده طرف‌حساب‌ها", go: ["report", "Farda Party Balance"], report: 1 },
		],
	},
	{
		title: "حقوق و دستمزد",
		icon: "user",
		desc: "حقوق ماهانه طبق قانون کار و نرخ‌های سال، با بیمه و مالیات خودکار؛ لیست بیمه و لیست مالیات حقوق.",
		links: [
			{ label: "کارکنان", go: ["list", "Employee"] },
			{ label: "محاسبه حقوق ماهانه", go: ["list", "Payroll Entry"] },
			{ label: "لیست بیمه", go: ["report", "Farda Insurance List"] },
			{ label: "نرخ‌های قانونی سال", go: ["list", "Farda Payroll Year"] },
		],
	},
	{
		title: "دارایی‌های ثابت",
		icon: "box",
		desc: "دارایی‌ها با گروه‌بندی جدول استهلاکات ماده ۱۴۹ و استهلاک ماهانه در پایان هر ماه شمسی.",
		links: [
			{ label: "دارایی‌ها", go: ["list", "Asset"] },
			{ label: "گروه‌های دارایی", go: ["list", "Asset Category"] },
			{ label: "دفتر دارایی‌های ثابت", go: ["report", "Fixed Asset Register"] },
		],
	},
	{
		title: "سامانه مودیان",
		icon: "upload",
		desc: "فاکتور فروش ثبت‌شده را با شماره منحصر به فرد مالیاتی به سامانه مودیان بفرستید و وضعیت آن را پیگیری کنید.",
		links: [
			{ label: "ارسال‌های سامانه مودیان", go: ["list", "Farda Moadian Log"] },
			{ label: "تنظیمات سامانه مودیان", go: ["form", "Farda Moadian Settings"], doctype: "Farda Moadian Settings" },
		],
	},
	{
		title: "پرداخت آنلاین و پیامک",
		icon: "phone",
		desc: "پرداخت فاکتور از درگاه زرین‌پال، آیدی‌پی یا نکست‌پی، و پیامک یادآوری چک و کد تأیید.",
		links: [
			{ label: "تراکنش‌های درگاه", go: ["list", "Farda Payment Log"] },
			{ label: "کدهای تأیید پیامکی", go: ["list", "Farda OTP Log"] },
		],
	},
	{
		title: "تنظیمات و کاربران",
		icon: "gear",
		desc: "کاربر و سطح دسترسی تعریف کنید، اطلاعات شرکت را ویرایش کنید و تغییرات حساس را ببینید.",
		links: [
			{ label: "کاربران", go: ["list", "User"] },
			{ label: "شرکت‌ها", go: ["list", "Company"] },
			{ label: "تنظیمات سیستم", go: ["form", "System Settings"], doctype: "System Settings" },
			{ label: "گزارش ممیزی", go: ["list", "Farda Audit Log"] },
		],
	},
];

// 24px line icons (stroke = currentColor)
FardaHome.ICONS = {
	upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
	dot: '<circle cx="12" cy="12" r="3"/>',
	receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
	cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 9v.01M17 15v.01"/>',
	cart: '<path d="M3 4h2l2.4 11h10.2L20 8H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
	cheque: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M6 14h7M15 11l2 2 3-4"/>',
	box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
	user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5"/>',
	ledger: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
	percent: '<path d="M6 18 18 6"/><circle cx="7.5" cy="7.5" r="2.2"/><circle cx="16.5" cy="16.5" r="2.2"/>',
	phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17h2"/>',
	gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
};

window.FardaHome = FardaHome;
