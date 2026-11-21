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

	/* Persian home (CORE-022): Persian users land on «فردا ERP» once per browser
	 * session instead of the bare app grid, and the FardaERP workspace (whose
	 * job is the sidebar) opens the home page. */
	function homeRouting() {
		if (!window.frappe || !frappe.router || !frappe.boot || (frappe.boot.lang || "").slice(0, 2) !== "fa") { return; }
		if (!frappe.boot.farda_iran || frappe.boot.farda_iran.home === false) { return; }
		var KEY = "farda_home_landed";
		var check = function () {
			var r = frappe.get_route() || [];
			var atDesktop = r.length === 0 || (r.length === 1 && !r[0]);
			var atFardaWs = r[0] === "Workspaces" && r[1] === "FardaERP";
			var landed = false;
			try { landed = sessionStorage.getItem(KEY) === "1"; } catch (e) { landed = true; }
			if (atFardaWs || (atDesktop && !landed)) {
				try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* private mode */ }
				frappe.set_route("farda-home");
			}
		};
		frappe.router.on("change", check);
		setTimeout(check, 0);
	}

	if (window.frappe) {
		apply();
		if (frappe.router) { homeRouting(); } else { $(document).on("app_ready", homeRouting); }
	} else {
		document.addEventListener("DOMContentLoaded", apply);
	}
})();
