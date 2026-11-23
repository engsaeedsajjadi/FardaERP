/* FardaERP — Persian UI layer (Desk client).
 * Loaded via app_include_js (plain JS, no build step needed).
 * Behaviour is flag-gated by frappe.boot.farda_iran (see ui/boot.py):
 *   - jalali_dates: all Date display formatters render Jalali DD/MM/YYYY
 *   - toman_display: IRR amounts render as Toman (value / irr_per_toman)
 * Accounting/API values remain IRR Gregorian — display layer only.
 * Self-test vectors: window.FardaIR.selfTest() (used by JS parity tests).
 */
(function () {
	"use strict";

	function flags() {
		var f = (window.frappe && frappe.boot && frappe.boot.farda_iran) || {};
		return {
			jalali: f.jalali_dates !== false,
			toman: f.toman_display !== false,
			ratio: f.irr_per_toman || 10,
		};
	}

	/* ---------- Jalali <-> Gregorian (33-year cycle, matches farda_iran/jalali) ---------- */
	function div(a, b) { return Math.floor(a / b); }

	function isLeap(jy) {
		var mod = jy % 33;
		return [1, 5, 9, 13, 17, 22, 26, 30].indexOf(mod) !== -1;
	}
	function monthLen(jy, jm) {
		if (jm <= 6) { return 31; }
		if (jm <= 11) { return 30; }
		return isLeap(jy) ? 30 : 29;
	}
	function jalaliToGregorian(jy, jm, jd) {
		var days = jd - 1, m, y;
		for (m = 1; m < jm; m++) { days += monthLen(jy, m); }
		if (jy >= 1404) { for (y = 1404; y < jy; y++) { days += isLeap(y) ? 366 : 365; } }
		else { for (y = jy; y < 1404; y++) { days -= isLeap(y) ? 366 : 365; } }
		// anchor 1404/01/01 == 2025-03-21 (UTC-agnostic: use Date.UTC)
		var d = new Date(Date.UTC(2025, 2, 21));
		d.setUTCDate(d.getUTCDate() + days);
		return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
	}
	function gregorianToJalali(gy, gm, gd) {
		var target = Date.UTC(gy, gm - 1, gd) - Date.UTC(2025, 2, 21);
		target = div(target, 86400000);
		var jy = 1404 + Math.floor(target / 365.2422), rem, m, ml;
		while (jdn(jy + 1, 1, 1) <= target) { jy += 1; }
		while (jdn(jy, 1, 1) > target) { jy -= 1; }
		rem = target - jdn(jy, 1, 1);
		for (m = 1; m <= 12; m++) {
			ml = monthLen(jy, m);
			if (rem < ml) { return [jy, m, rem + 1]; }
			rem -= ml;
		}
		return [jy, 12, monthLen(jy, 12)];
	}
	function jdn(jy, jm, jd) {
		var days = jd - 1, m, y;
		for (m = 1; m < jm; m++) { days += monthLen(jy, m); }
		if (jy >= 1404) { for (y = 1404; y < jy; y++) { days += isLeap(y) ? 366 : 365; } }
		else { for (y = jy; y < 1404; y++) { days -= isLeap(y) ? 366 : 365; } }
		return days;
	}
	function p2(n) { return n < 10 ? "0" + n : "" + n; }

	/* ISO "YYYY-MM-DD..." -> "DD/MM/YYYY" Jalali; returns original on failure. */
	function toJalaliDisplay(value) {
		if (value === null || value === undefined) { return value; }
		var s = String(value);
		var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!m) { return value; }
		var j = gregorianToJalali(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
		return p2(j[2]) + "/" + p2(j[1]) + "/" + j[0];
	}

	/* "1,000,000" IRR -> "100,000" Toman (exact for integral IRR within float safety). */
	function irrToTomanText(value, ratio) {
		var neg = String(value).indexOf("-") === 0;
		var digits = String(value).replace(/[^0-9.]/g, "");
		if (!digits) { return value; }
		var num = parseFloat(digits);
		if (!isFinite(num)) { return value; }
		var t = num / ratio;
		var text = t % 1 === 0 ? String(Math.round(t)) : String(Math.round(t * 10) / 10);
		// thousands separators
		var parts = text.split(".");
		parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		return (neg ? "-" : "") + parts.join(".");
	}

	function wrapFormatter(name, transform) {
		if (!frappe.form || !frappe.form.formatters || !frappe.form.formatters[name]) { return; }
		var orig = frappe.form.formatters[name];
		if (orig.__farda) { return; }  // never wrap twice
		var wrapped = function (value, df, options, doc) {
			var out = orig.call(this, value, df, options, doc);
			try {
				return out === null || out === undefined || out === "" ? out : transform(out, df, doc, options);
			} catch (e) {
				return out;
			}
		};
		wrapped.__farda = true;
		frappe.form.formatters[name] = wrapped;
	}

	/* Frappe's Date/Datetime formatters return the USER date format (e.g. dd-mm-yyyy),
	 * not ISO. Map a user-formatted date back to ISO before converting (UI-1). */
	function userDateToIso(s) {
		s = String(s);
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) { return s.slice(0, 10); }
		if (frappe.datetime && frappe.datetime.user_to_str) {
			var iso = frappe.datetime.user_to_str(s, false);
			if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) { return iso.slice(0, 10); }
		}
		return null;
	}

	/* Convert the date inside a formatter result (plain text or simple HTML);
	 * a Datetime keeps its time part untouched. */
	function jalaliizeOutput(out) {
		var text = String(out);
		var m = text.match(/\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}/);
		if (!m) { return out; }
		var iso = userDateToIso(m[0]);
		if (!iso) { return out; }
		return text.replace(m[0], toJalaliDisplay(iso));
	}

	/* Replace the IRR amount + unit in a formatter result with "<amount> تومان",
	 * keeping the surrounding HTML (alignment wrapper) intact (UI-2). */
	var IRR_UNIT = /(﷼|IRR|ریال|Rial)\s?/;
	function tomanizeOutput(out, ratio, options) {
		var text = String(out);
		var num = text.match(/\d[\d,]*(?:\.\d+)?/);
		if (!num) { return out; }
		var hadUnit = IRR_UNIT.test(text);
		text = text.replace(IRR_UNIT, "");
		var label = irrToTomanText(num[0], ratio);
		if (hadUnit || !(options && options.only_value)) { label += " تومان"; }
		return text.replace(num[0], label);
	}

	function inForm() {
		try { return (frappe.get_route() || [])[0] === "Form"; } catch (e) { return false; }
	}

	function rializeOutput(out, bare) {
		var text = String(out);
		if (!IRR_UNIT.test(text)) { return out; }
		var num = text.match(/-?\d[\d,]*(?:\.\d+)?/);
		text = text.replace(IRR_UNIT, "");
		if (!num || bare) { return text.trim(); }
		return text.replace(num[0], num[0] + " ریال");
	}

	function fieldCurrency(df, doc) {
		if (frappe.meta && frappe.meta.get_field_currency) {
			try { return frappe.meta.get_field_currency(df, doc); } catch (e) { /* fall through */ }
		}
		return df && (df.currency || df.options);
	}

	function apply() {
		var f = flags();

		if (f.jalali) {
			wrapFormatter("Date", function (out) { return jalaliizeOutput(out); });
			wrapFormatter("Datetime", function (out) { return jalaliizeOutput(out); });
		}

		if (f.toman) {
			wrapFormatter("Currency", function (out, df, doc, options) {
				if (fieldCurrency(df, doc) !== "IRR") { return out; }
				// UI-4: inside a document form amounts are TYPED in rial, so they are
				// also SHOWN in rial (with an explicit unit) — showing Toman next to a
				// rial input invites 10x entry errors. Toman is for lists, reports and
				// dashboards, where nothing is typed.
				// grid cells are narrow and their header already names the currency
				if (inForm()) { return rializeOutput(out, !!(doc && doc.parenttype)); }
				return tomanizeOutput(out, f.ratio, options);
			});
		}
	}

	/* Exposed for tests */
	window.FardaIR = {
		toJalaliDisplay: toJalaliDisplay,
		gregorianToJalali: gregorianToJalali,
		jalaliToGregorian: jalaliToGregorian,
		irrToTomanText: irrToTomanText,
		jalaliizeOutput: jalaliizeOutput,
		tomanizeOutput: tomanizeOutput,
		rializeOutput: rializeOutput,
		selfTest: function () {
			var checks = [
				["2026-09-15", "24/06/1405"],
				["2025-03-21", "01/01/1404"],
				["2025-03-20", "30/12/1403"],
				["1979-02-11", "22/11/1357"]
			];
			return checks.every(function (c) { return toJalaliDisplay(c[0]) === c[1]; });
		}
	};

	/* ------------------------------------------------------------------
	 * Jalali date entry (CORE-026)
	 * Date and Datetime inputs show, accept and pick Jalali dates
	 * (30/08/1405, ۱۴۰۵/۰۸/۳۰, 1405-8-30 …); the stored value stays ISO
	 * Gregorian, so reports, APIs and the database are unaffected.
	 * ------------------------------------------------------------------ */
	var FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
	var J_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
	var J_WEEK = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

	function faDigits(x) { return String(x).replace(/\d/g, function (c) { return FA_DIGITS[c]; }); }
	function asciiDigits(x) {
		return String(x).replace(/[۰-۹]/g, function (c) { return String(FA_DIGITS.indexOf(c)); })
			.replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); });
	}
	function iso(gy, gm, gd) { return gy + "-" + p2(gm) + "-" + p2(gd); }
	function jMonthLength(jy, jm) {
		if (jm <= 6) { return 31; }
		if (jm <= 11) { return 30; }
		var a = jalaliToGregorian(jy, 12, 1), b = jalaliToGregorian(jy + 1, 1, 1);
		return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 864e5);
	}
	function isoToJalaliParts(isoDate) {
		var m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!m) { return null; }
		return gregorianToJalali(+m[1], +m[2], +m[3]);
	}
	function jalaliText(j) { return p2(j[2]) + "/" + p2(j[1]) + "/" + j[0]; }

	/* "30/08/1405", "1405/8/30", "۱۴۰۵-۰۸-۳۰" (+ optional time) -> {date: ISO, time} | null */
	function parseJalaliInput(text) {
		var t = asciiDigits(String(text || "")).trim();
		var m = t.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?$/);
		if (!m) { return null; }
		var a = +m[1], b = +m[2], c = +m[3], jy, jm, jd;
		if (a >= 1200 && a < 1600) { jy = a; jm = b; jd = c; }
		else if (c >= 1200 && c < 1600) { jy = c; jm = b; jd = a; }
		else { return null; }
		if (jm < 1 || jm > 12 || jd < 1 || jd > jMonthLength(jy, jm)) { return null; }
		var g = jalaliToGregorian(jy, jm, jd);
		var time = m[4] ? (m[4].length === 5 ? m[4] + ":00" : m[4]) : null;
		if (time && time.length === 7) { time = "0" + time; }
		return { date: iso(g[0], g[1], g[2]), time: time };
	}

	function jalaliControls() {
		var C = frappe.ui && frappe.ui.form;
		if (!C || !C.ControlDate || C.ControlDate.prototype.__farda_jalali) { return; }
		var DateP = C.ControlDate.prototype, DtP = C.ControlDatetime && C.ControlDatetime.prototype;
		var orig = {
			dParse: DateP.parse, dFormat: DateP.format_for_input, dSet: DateP.set_formatted_input, dPicker: DateP.set_datepicker,
			tParse: DtP && DtP.parse, tFormat: DtP && DtP.format_for_input, tSet: DtP && DtP.set_formatted_input, tPicker: DtP && DtP.set_datepicker,
		};
		function active(ctrl) {
			return !ctrl.timepicker_only && ctrl.df && (ctrl.df.fieldtype === "Date" || ctrl.df.fieldtype === "Datetime");
		}
		function isDt(ctrl) { return ctrl.df.fieldtype === "Datetime"; }

		/* value (ISO, system tz) -> Jalali text for the input */
		function toInput(ctrl, value) {
			if (!value) { return ""; }
			if (value === "Today") { value = frappe.datetime.get_today(); }
			if (isDt(ctrl)) {
				var user = orig.tFormat.call(ctrl, value);            // user tz, user format
				var isoUser = frappe.datetime.user_to_str(user, false); // "YYYY-MM-DD HH:mm:ss"
				var j = isoToJalaliParts(isoUser);
				return j ? jalaliText(j) + " " + isoUser.slice(11, 16) : user;
			}
			var jd = isoToJalaliParts(value);
			return jd ? jalaliText(jd) : orig.dFormat.call(ctrl, value);
		}
		/* input text -> ISO value */
		function fromInput(ctrl, text) {
			var r = parseJalaliInput(text);
			if (!r) { return null; }
			if (!isDt(ctrl)) { return r.date; }
			var v = r.date + " " + (r.time || "00:00:00");
			if (!frappe.datetime.is_system_time_zone()) { v = frappe.datetime.convert_to_system_tz(v, true); }
			return v;
		}

		function patch(P, kind) {
			var oParse = kind === "d" ? orig.dParse : orig.tParse;
			var oSet = kind === "d" ? orig.dSet : orig.tSet;
			var oPicker = kind === "d" ? orig.dPicker : orig.tPicker;
			P.format_for_input = function (value) { return active(this) ? toInput(this, value) : (kind === "d" ? orig.dFormat : orig.tFormat).call(this, value); };
			P.parse = function (value) {
				if (active(this) && value) {
					var v = fromInput(this, value);
					if (v) { return v; }
					// a Jalali-looking year that did not parse (e.g. 31/07/1405) must not
					// fall through to the Gregorian parser, which would store year 1405 AD
					if (/(^|\D)1[2-5]\d\d(\D|$)/.test(asciiDigits(value))) {
						frappe.show_alert({ message: "تاریخ نامعتبر است: " + frappe.utils.escape_html(value), indicator: "red" });
						return "";
					}
				}
				return oParse.call(this, value);
			};
			P.set_formatted_input = function (value) {
				if (!active(this)) { return oSet.call(this, value); }
				this.$input && this.$input.val(this.format_for_input(value));
				if (this._fj && this._fj.isOpen()) { this._fj.render(); }
			};
			P.set_datepicker = function () {
				if (!active(this)) { return oPicker.call(this); }
				var me = this, noop = function () {};
				// stub for code that pokes the old picker (ERPNext scripts call datepicker.update)
				this.datepicker = { $datepicker: $(), opts: { timeFormat: "hh:ii:ss" }, selectedDates: [], date: null,
					clear: noop, selectDate: noop, update: noop, hide: function () { me._fj && me._fj.close(); }, show: function () { me._fj && me._fj.open(); } };
				this.$input.attr({ placeholder: isDt(this) ? "روز/ماه/سال ساعت" : "روز/ماه/سال", autocomplete: "off", dir: "ltr" })
					.addClass("farda-jdate-input");
				this._fj = new JalaliPicker(this);
				this.$input.on("focus click", function () { if (!me.df.read_only) { me._fj.open(); } });
				this.$input.on("keydown", function (e) { if (e.key === "Escape" || e.key === "Tab") { me._fj.close(); } });
			};
		}
		patch(DateP, "d");
		if (DtP) { patch(DtP, "t"); }
		DateP.__farda_jalali = true;
	}

	/* A small Jalali month-grid popover bound to one control. */
	function JalaliPicker(ctrl) {
		this.ctrl = ctrl;
		this.$el = null;
		var self = this;
		this._outside = function (e) {
			if (!self.$el) { return; }
			if (self.$el[0].contains(e.target) || ctrl.$input[0] === e.target) { return; }
			self.close();
		};
	}
	JalaliPicker.prototype.isOpen = function () { return !!this.$el; };
	JalaliPicker.prototype.current = function () {
		var v = this.ctrl.get_value ? this.ctrl.get_value() : this.ctrl.value;
		var parsed = parseJalaliInput(this.ctrl.$input.val());
		var isoDate = parsed ? parsed.date : (v ? String(v).slice(0, 10) : null);
		return isoDate ? isoToJalaliParts(isoDate) : null;
	};
	JalaliPicker.prototype.open = function () {
		if (this.$el) { return; }
		var sel = this.current(), today = isoToJalaliParts(frappe.datetime.get_today());
		this.view = sel ? [sel[0], sel[1]] : [today[0], today[1]];
		this.$el = $('<div class="farda-jpicker" dir="rtl" role="dialog" aria-label="انتخاب تاریخ"></div>').appendTo(document.body);
		this.render();
		this.position();
		var self = this;
		setTimeout(function () { $(document).on("mousedown.fj touchstart.fj", self._outside); $(window).on("resize.fj scroll.fj", function () { self.position(); }); }, 0);
	};
	JalaliPicker.prototype.close = function () {
		if (!this.$el) { return; }
		this.$el.remove();
		this.$el = null;
		$(document).off(".fj", this._outside);
		$(window).off(".fj");
	};
	JalaliPicker.prototype.position = function () {
		if (!this.$el) { return; }
		var $i = this.ctrl.$input, off = $i.offset(), h = $i.outerHeight(), w = this.$el.outerWidth(), ph = this.$el.outerHeight();
		var top = off.top + h + 6;
		if (top + ph > $(window).scrollTop() + $(window).height() && off.top - ph - 6 > $(window).scrollTop()) { top = off.top - ph - 6; }
		var left = Math.max(8, off.left + $i.outerWidth() - w);
		this.$el.css({ top: top, left: left });
	};
	JalaliPicker.prototype.render = function () {
		var self = this, jy = this.view[0], jm = this.view[1];
		var sel = this.current(), today = isoToJalaliParts(frappe.datetime.get_today());
		var g1 = jalaliToGregorian(jy, jm, 1);
		var dow = new Date(g1[0], g1[1] - 1, g1[2]).getDay(); // 0 Sunday … 6 Saturday
		var lead = (dow + 1) % 7;                              // Saturday-first week
		var days = jMonthLength(jy, jm), cells = [];
		for (var i = 0; i < lead; i++) { cells.push('<span class="fj-empty"></span>'); }
		for (var d = 1; d <= days; d++) {
			var cls = ["fj-day"];
			if (sel && sel[0] === jy && sel[1] === jm && sel[2] === d) { cls.push("is-selected"); }
			if (today[0] === jy && today[1] === jm && today[2] === d) { cls.push("is-today"); }
			if ((lead + d - 1) % 7 === 6) { cls.push("is-friday"); }
			cells.push('<button type="button" class="' + cls.join(" ") + '" data-d="' + d + '">' + faDigits(d) + "</button>");
		}
		var years = "", months = "";
		for (var y = jy - 60; y <= jy + 10; y++) { years += '<option value="' + y + '"' + (y === jy ? " selected" : "") + ">" + faDigits(y) + "</option>"; }
		J_MONTHS.forEach(function (n, k) { months += '<option value="' + (k + 1) + '"' + (k + 1 === jm ? " selected" : "") + ">" + n + "</option>"; });
		var timeRow = this.ctrl.df.fieldtype === "Datetime"
			? '<label class="fj-time">ساعت <input type="time" value="' + this.timeValue() + '"></label>' : "";
		this.$el.html(
			'<div class="fj-head">' +
				'<button type="button" class="fj-nav" data-step="-1" aria-label="ماه قبل">›</button>' +
				'<select class="fj-month" aria-label="ماه">' + months + '</select>' +
				'<select class="fj-year" aria-label="سال">' + years + '</select>' +
				'<button type="button" class="fj-nav" data-step="1" aria-label="ماه بعد">‹</button>' +
			"</div>" +
			'<div class="fj-week">' + J_WEEK.map(function (w, k) { return '<span class="' + (k === 6 ? "is-friday" : "") + '">' + w + "</span>"; }).join("") + "</div>" +
			'<div class="fj-grid">' + cells.join("") + "</div>" + timeRow +
			'<div class="fj-foot"><button type="button" class="fj-today">امروز</button><button type="button" class="fj-clear">پاک کردن</button></div>'
		);
		this.$el.find(".fj-nav").on("click", function () {
			var m = self.view[1] + (+this.dataset.step), y = self.view[0];
			if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
			self.view = [y, m]; self.render();
		});
		this.$el.find(".fj-month, .fj-year").on("change", function () {
			self.view = [+self.$el.find(".fj-year").val(), +self.$el.find(".fj-month").val()]; self.render();
		});
		this.$el.find(".fj-day").on("click", function () { self.pick([jy, jm, +this.dataset.d]); });
		this.$el.find(".fj-today").on("click", function () { self.pick(isoToJalaliParts(frappe.datetime.get_today()), true); });
		this.$el.find(".fj-clear").on("click", function () { self.ctrl.$input.val("").trigger("change"); self.close(); });
		this.$el.find(".fj-time input").on("change", function () { if (self.current()) { self.pick(self.current()); } });
	};
	JalaliPicker.prototype.timeValue = function () {
		var parsed = parseJalaliInput(this.ctrl.$input.val());
		if (parsed && parsed.time) { return parsed.time.slice(0, 5); }
		return frappe.datetime.now_time().slice(0, 5);
	};
	JalaliPicker.prototype.pick = function (j, now) {
		var text = jalaliText(j);
		if (this.ctrl.df.fieldtype === "Datetime") {
			var t = now ? frappe.datetime.now_time().slice(0, 5) : (this.$el.find(".fj-time input").val() || this.timeValue());
			text += " " + t;
		}
		this.ctrl.$input.val(text).trigger("change");
		this.close();
	};

	window.FardaIR = window.FardaIR || {};
	window.FardaIR.parseJalaliInput = parseJalaliInput;
	window.FardaIR.jMonthLength = jMonthLength;

	/* Persian home (CORE-022, CORE-040): for Persian users the bare app grid at
	 * /desk is replaced by the «سیمراکس» home every time — the grid of English
	 * module names was the most confusing screen in the product. The grid stays
	 * reachable from the home page («نمای همهٔ ماژول‌ها» sets a one-visit flag). The
	 * FardaERP workspace (whose job is the sidebar) also opens the home page. */
	function homeRouting() {
		if (!window.frappe || !frappe.router || !frappe.boot || (frappe.boot.lang || "").slice(0, 2) !== "fa") { return; }
		if (!frappe.boot.farda_iran || frappe.boot.farda_iran.home === false) { return; }
		var check = function () {
			// Decide from the real address, not frappe.get_route(): on a full page
			// load the route is still [] when this first runs, which used to send
			// every refreshed or bookmarked page (/desk/sales-invoice …) home.
			var path = (window.location.pathname || "").replace(/\/+$/, "").toLowerCase();
			var r = frappe.get_route() || [];
			var atDesktop = path === "/desk" || path === "/app";
			var atFardaWs = path === "/desk/fardaerp" || path === "/app/fardaerp" || (r[0] === "Workspaces" && r[1] === "FardaERP");
			var wantsGrid = false;
			try {
				wantsGrid = sessionStorage.getItem("farda_show_grid") === "1";
				if (wantsGrid && !atDesktop) { sessionStorage.removeItem("farda_show_grid"); }
			} catch (e) { /* private mode */ }
			if (atFardaWs || (atDesktop && !wantsGrid)) {
				frappe.set_route("farda-home");
			}
		};
		frappe.router.on("change", check);
		setTimeout(check, 0);
	}

	/* Desk caches page scripts in localStorage keyed only by metadata_version,
	 * which a rebuild does not always change — so an updated home page could
	 * keep showing the old one. Drop our cached pages once per release. */
	var FARDA_UI_RELEASE = "2026-11-23-deeplink";
	try {
		if (localStorage.getItem("farda_ui_release") !== FARDA_UI_RELEASE) {
			Object.keys(localStorage).forEach(function (k) {
				if (k.indexOf("_page:farda-") === 0) { localStorage.removeItem(k); }
			});
			localStorage.setItem("farda_ui_release", FARDA_UI_RELEASE);
		}
	} catch (e) { /* storage blocked */ }

	/* A few tooltips are hard-coded in English inside Frappe's bundles
	 * (frappe-datatable, the list filter button) and never pass through __().
	 * Rewrite just those title attributes for Persian users. */
	var TITLE_FIXES = [
		[/^Filter based on (.*)$/, "فیلتر بر اساس $1"],
		[/^1 Filter Applied$/i, "۱ فیلتر اعمال شده"],
		[/^(\d+) Filters? Applied$/i, "$1 فیلتر اعمال شده"],
	];
	function persianTooltips() {
		function fix(el) {
			var t = el.getAttribute("title");
			if (!t || !/[A-Za-z]/.test(t)) return;
			for (var i = 0; i < TITLE_FIXES.length; i++) {
				if (TITLE_FIXES[i][0].test(t)) {
					el.setAttribute("title", t.replace(TITLE_FIXES[i][0], TITLE_FIXES[i][1]));
					return;
				}
			}
		}
		document.querySelectorAll("[title]").forEach(fix);
		new MutationObserver(function (muts) {
			muts.forEach(function (m) {
				if (m.type === "attributes") { fix(m.target); return; }
				m.addedNodes.forEach(function (n) {
					if (n.nodeType !== 1) return;
					if (n.hasAttribute("title")) fix(n);
					n.querySelectorAll && n.querySelectorAll("[title]").forEach(fix);
				});
			});
		}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
	}

	/* Form fields show money labels as "Rate (IRR)" — the ISO code. Persian
	 * users read «نرخ (ریال)». Only the label text changes; values, formatting
	 * and the stored currency stay as they are. The form bundle can load after
	 * this file, so patch it once it exists. */
	var CURRENCY_FA = { IRR: "ریال", IRT: "تومان", USD: "دلار", EUR: "یورو", AED: "درهم", TRY: "لیر", CNY: "یوان" };
	function persianCurrencyLabels() {
		var tries = 0;
		var timer = setInterval(function () {
			var F = frappe.ui && frappe.ui.form && frappe.ui.form.Form;
			if (F && F.prototype.set_currency_labels && !F.prototype.__fardaCurrency) {
				var orig = F.prototype.set_currency_labels;
				F.prototype.set_currency_labels = function (fields, currency, parentfield) {
					return orig.call(this, fields, CURRENCY_FA[currency] || currency, parentfield);
				};
				F.prototype.__fardaCurrency = true;
			}
			if ((F && F.prototype.__fardaCurrency) || ++tries > 120) clearInterval(timer);
		}, 500);
	}

	if (window.frappe) {
		apply();
		if ((frappe.boot && (frappe.boot.lang || "").slice(0, 2) === "fa") && document.body) { persianTooltips(); persianCurrencyLabels(); }
		if (frappe.router) { homeRouting(); } else { $(document).on("app_ready", homeRouting); }
		if (flags().jalali && (frappe.boot && (frappe.boot.lang || "").slice(0, 2) === "fa")) { jalaliControls(); }
	} else {
		document.addEventListener("DOMContentLoaded", apply);
	}
})();
