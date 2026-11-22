// FardaERP — ویزیتور: سفارش‌گیری سریع روی موبایل (CORE-038).
// One column, thumb-sized controls: pick a customer, tap items, adjust qty,
// send. The order is a normal Sales Order created with the user's own rights.

const FV_API = "erpnext.farda_iran.page.farda_visitor.farda_visitor.";

frappe.pages["farda-visitor"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: "ویزیتور", single_column: true });
	wrapper.fv = new FardaVisitor(page);
};
frappe.pages["farda-visitor"].on_page_show = function (wrapper) {
	wrapper.fv && wrapper.fv.load_orders();
};

class FardaVisitor {
	constructor(page) {
		this.page = page;
		this.ratio = (frappe.boot.farda_iran && frappe.boot.farda_iran.irr_per_toman) || 10;
		this.customer = null;
		this.cart = new Map(); // item_code -> {item_name, rate, qty, uom}
		this.$ = $(`
			<div class="farda-visitor" dir="rtl" lang="fa">
				<section class="fv-block">
					<label class="fv-label" for="fv-cust">مشتری</label>
					<div class="fv-chosen" hidden></div>
					<input id="fv-cust" class="fv-input" type="search" inputmode="search" autocomplete="off" placeholder="نام، کد یا موبایل مشتری">
					<ul class="fv-list fv-cust-list"></ul>
				</section>
				<section class="fv-block fv-items-block" hidden>
					<label class="fv-label" for="fv-item">کالا</label>
					<input id="fv-item" class="fv-input" type="search" inputmode="search" autocomplete="off" placeholder="جستجوی نام یا کد کالا">
					<ul class="fv-list fv-item-list"></ul>
				</section>
				<section class="fv-block fv-cart-block" hidden>
					<h3 class="fv-h">سبد سفارش</h3>
					<ul class="fv-cart"></ul>
					<textarea class="fv-input fv-notes" rows="2" placeholder="توضیح برای انبار یا ارسال (اختیاری)"></textarea>
				</section>
				<section class="fv-block">
					<h3 class="fv-h">سفارش‌های ۷ روز اخیر من</h3>
					<ul class="fv-orders"></ul>
				</section>
				<div class="fv-bar" hidden>
					<div class="fv-total"><span>جمع</span><b></b></div>
					<button class="fv-send" type="button">ثبت سفارش</button>
				</div>
			</div>`).appendTo(page.main);
		this.bind();
		this.load_orders();
	}

	fa(n) {
		return Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
	}
	toman(irr) {
		return this.fa(Math.round((Number(irr) || 0) / this.ratio)) + " تومان";
	}
	esc(s) {
		return frappe.utils.escape_html(s == null ? "" : String(s));
	}
	debounce(fn) {
		let t;
		return (...a) => {
			clearTimeout(t);
			t = setTimeout(() => fn.apply(this, a), 250);
		};
	}

	bind() {
		const $c = this.$.find("#fv-cust"), $i = this.$.find("#fv-item");
		$c.on("input", this.debounce(() => this.search_customers($c.val())));
		$i.on("input", this.debounce(() => this.search_items($i.val())));
		$c.on("focus", () => !$c.val() && this.search_customers(""));
		$i.on("focus", () => !$i.val() && this.search_items(""));
		this.$.on("click", ".fv-cust-list li", (e) => this.pick_customer($(e.currentTarget).data("row")));
		this.$.on("click", ".fv-chosen button", () => this.pick_customer(null));
		this.$.on("click", ".fv-item-list li", (e) => this.add_item($(e.currentTarget).data("row")));
		this.$.on("click", ".fv-step", (e) => {
			const $b = $(e.currentTarget), code = $b.closest("li").data("code"), line = this.cart.get(code);
			line.qty = Math.max(0, line.qty + Number($b.data("d")));
			if (!line.qty) this.cart.delete(code);
			this.render_cart();
		});
		this.$.on("change", ".fv-qty", (e) => {
			const $q = $(e.currentTarget), code = $q.closest("li").data("code"), v = Number(frappe.utils.convert_to_english_digits ? frappe.utils.convert_to_english_digits($q.val()) : $q.val());
			if (v > 0) this.cart.get(code).qty = v;
			else this.cart.delete(code);
			this.render_cart();
		});
		this.$.find(".fv-send").on("click", () => this.send());
	}

	search_customers(txt) {
		frappe.call({ method: FV_API + "customers", args: { txt } }).then((r) => {
			const rows = r.message || [];
			this.$.find(".fv-cust-list").html(
				rows.length
					? rows.map((c) => `<li tabindex="0"><b>${this.esc(c.customer_name)}</b><small>${this.esc(c.mobile_no || c.territory || c.name)}</small></li>`).join("")
					: `<li class="fv-empty">مشتری‌ای پیدا نشد. نام دیگری را امتحان کنید.</li>`
			).find("li:not(.fv-empty)").each((i, el) => $(el).data("row", rows[i]));
		});
	}

	pick_customer(row) {
		this.customer = row;
		const $chosen = this.$.find(".fv-chosen");
		this.$.find("#fv-cust").prop("hidden", !!row).val("");
		this.$.find(".fv-cust-list").empty();
		$chosen.prop("hidden", !row).html(row ? `<b>${this.esc(row.customer_name)}</b><button type="button">تغییر مشتری</button>` : "");
		this.$.find(".fv-items-block").prop("hidden", !row);
		if (row) this.$.find("#fv-item").trigger("focus");
		this.render_cart();
	}

	search_items(txt) {
		frappe.call({ method: FV_API + "items", args: { txt, customer: this.customer && this.customer.name } }).then((r) => {
			const rows = r.message || [];
			this.$.find(".fv-item-list").html(
				rows.length
					? rows.map((it) => `<li tabindex="0"><span><b>${this.esc(it.item_name)}</b><small>موجودی: ${this.fa(it.stock)} ${this.esc(it.stock_uom)}</small></span><em>${it.rate ? this.toman(it.rate) : "بدون قیمت"}</em></li>`).join("")
					: `<li class="fv-empty">کالایی پیدا نشد.</li>`
			).find("li:not(.fv-empty)").each((i, el) => $(el).data("row", rows[i]));
		});
	}

	add_item(it) {
		const line = this.cart.get(it.item_code) || { item_name: it.item_name, rate: it.rate, uom: it.stock_uom, qty: 0 };
		line.qty += 1;
		this.cart.set(it.item_code, line);
		frappe.show_alert({ message: `${it.item_name} اضافه شد`, indicator: "green" }, 2);
		this.render_cart();
	}

	render_cart() {
		const lines = [...this.cart.entries()];
		this.$.find(".fv-cart-block").prop("hidden", !lines.length);
		this.$.find(".fv-cart").html(
			lines.map(([code, l]) => `
				<li data-code="${this.esc(code)}">
					<div class="fv-line"><b>${this.esc(l.item_name)}</b><small>${l.rate ? this.toman(l.rate * l.qty) : "قیمت از فهرست قیمت"}</small></div>
					<div class="fv-qtybox">
						<button class="fv-step" data-d="-1" type="button" aria-label="کم کردن">−</button>
						<input class="fv-qty" inputmode="decimal" value="${this.fa(l.qty)}" aria-label="تعداد">
						<button class="fv-step" data-d="1" type="button" aria-label="اضافه کردن">+</button>
					</div>
				</li>`).join("")
		);
		const total = lines.reduce((s, [, l]) => s + (l.rate || 0) * l.qty, 0);
		this.$.find(".fv-bar").prop("hidden", !(this.customer && lines.length));
		this.$.find(".fv-total b").text(this.toman(total));
	}

	send() {
		const lines = [...this.cart.entries()].map(([item_code, l]) => ({ item_code, qty: l.qty }));
		const $b = this.$.find(".fv-send").prop("disabled", true).text("در حال ثبت…");
		frappe
			.call({
				method: FV_API + "create_order",
				args: { customer: this.customer.name, lines: JSON.stringify(lines), notes: this.$.find(".fv-notes").val() },
			})
			.then((r) => {
				const m = r.message;
				frappe.show_alert({ message: `سفارش ${m.name} ثبت شد (پیش‌نویس، ${this.toman(m.grand_total)})`, indicator: "green" }, 5);
				this.cart.clear();
				this.$.find(".fv-notes").val("");
				this.pick_customer(null);
				this.load_orders();
			})
			.always(() => $b.prop("disabled", false).text("ثبت سفارش"));
	}

	load_orders() {
		frappe.call({ method: FV_API + "my_orders" }).then((r) => {
			const rows = r.message || [];
			this.$.find(".fv-orders").html(
				rows.length
					? rows.map((o) => `<li><a href="/app/sales-order/${encodeURIComponent(o.name)}"><b>${this.esc(o.customer_name)}</b><small>${this.esc(o.name)} — ${o.docstatus ? __(o.status) : "پیش‌نویس"}</small></a><em>${this.toman(o.grand_total)}</em></li>`).join("")
					: `<li class="fv-empty">هنوز سفارشی ثبت نکرده‌اید. اول مشتری را انتخاب کنید.</li>`
			);
		});
	}
}
