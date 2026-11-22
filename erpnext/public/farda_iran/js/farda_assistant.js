/* FardaERP — in-app help assistant panel (دستیار سیمراکس).
 * Loaded via app_include_js. Talks only to
 *   erpnext.farda_iran.assistant.service.{context,ask}
 * Buttons come from the server (built-in guides, permission-filtered);
 * all text is inserted escaped.
 */
(function () {
	"use strict";

	var API = "erpnext.farda_iran.assistant.service.";
	var STORE = "farda_assistant_chat";
	var state = { ready: false, open: false, busy: false, history: [], ctx: null, $root: null };

	function esc(s) {
		return frappe.utils.escape_html(String(s == null ? "" : s));
	}

	function load() {
		try {
			var raw = sessionStorage.getItem(STORE);
			var data = raw ? JSON.parse(raw) : null;
			if (data && Array.isArray(data.items)) return data.items.slice(-30);
		} catch (e) { /* storage unavailable */ }
		return [];
	}
	function save(items) {
		try { sessionStorage.setItem(STORE, JSON.stringify({ items: items.slice(-30) })); } catch (e) { /* ignore */ }
	}

	var CSS = [
		".fa-ast-fab{position:fixed;bottom:20px;inset-inline-end:20px;z-index:1030;display:flex;align-items:center;gap:8px;height:44px;padding:0 16px 0 18px;border:0;border-radius:22px;background:#2a3650;color:#fff;font:inherit;font-size:14px;font-weight:600;box-shadow:0 4px 14px rgba(11,20,38,.25);cursor:pointer}",
		".fa-ast-fab:hover{background:#1e2840}",
		".fa-ast-fab:focus-visible,.fa-ast button:focus-visible,.fa-ast textarea:focus-visible{outline:2px solid #a8843f;outline-offset:2px}",
		".fa-ast{position:fixed;bottom:76px;inset-inline-end:20px;z-index:1031;width:380px;max-width:calc(100vw - 32px);height:min(600px,calc(100vh - 110px));display:flex;flex-direction:column;background:var(--card-bg,#fff);color:var(--text-color,#1c2333);border:1px solid var(--border-color,#e3e5eb);border-radius:14px;box-shadow:0 12px 40px rgba(11,20,38,.22);overflow:hidden;direction:rtl}",
		".fa-ast[hidden]{display:none}",
		".fa-ast-hd{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#2a3650;color:#fff}",
		".fa-ast-hd b{flex:1;font-size:15px}",
		".fa-ast-hd small{display:block;font-weight:400;font-size:11.5px;opacity:.8}",
		".fa-ast-hd button{border:0;background:transparent;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px}",
		".fa-ast-hd button:hover{background:rgba(255,255,255,.12)}",
		".fa-ast-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;font-size:13.5px;line-height:1.75}",
		".fa-ast-msg{max-width:92%;padding:10px 12px;border-radius:12px}",
		".fa-ast-u{align-self:flex-start;background:#2a3650;color:#fff;border-end-start-radius:4px}",
		".fa-ast-a{align-self:flex-end;background:var(--subtle-fg,#f2f4f8);border:1px solid var(--border-color,#e3e5eb);border-end-end-radius:4px;width:92%}",
		".fa-ast-a ol{margin:6px 0 0;padding-inline-start:22px;list-style-type:persian}",
		".fa-ast-a li{margin:3px 0}",
		".fa-ast-tip{margin-top:8px;padding:6px 10px;border-inline-start:3px solid #a8843f;background:rgba(168,132,63,.08);border-radius:4px;font-size:12.5px}",
		".fa-ast-note{margin-bottom:6px;font-size:12px;color:#8a5a00}",
		".fa-ast-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}",
		".fa-ast-act{border:0;background:#2a3650;color:#fff;border-radius:8px;padding:6px 12px;font:inherit;font-size:12.5px;cursor:pointer}",
		".fa-ast-act:hover{background:#1e2840}",
		".fa-ast-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}",
		".fa-ast-chip{border:1px solid var(--border-color,#d5d9e2);background:var(--card-bg,#fff);color:inherit;border-radius:16px;padding:4px 12px;font:inherit;font-size:12.5px;cursor:pointer;text-align:start}",
		".fa-ast-chip:hover{border-color:#2a3650}",
		".fa-ast-intro{color:var(--text-muted,#6b7387)}",
		".fa-ast-typing{align-self:flex-end;color:var(--text-muted,#6b7387);font-size:12.5px}",
		".fa-ast-ft{display:flex;gap:8px;padding:10px;border-top:1px solid var(--border-color,#e3e5eb)}",
		".fa-ast-ft textarea{flex:1;resize:none;height:42px;max-height:110px;border:1px solid var(--border-color,#d5d9e2);border-radius:10px;padding:9px 12px;font:inherit;font-size:13.5px;background:var(--control-bg,#fff);color:inherit}",
		".fa-ast-ft button{border:0;border-radius:10px;background:#2a3650;color:#fff;padding:0 14px;font:inherit;font-weight:600;cursor:pointer}",
		".fa-ast-ft button[disabled]{opacity:.5;cursor:default}",
		"[data-theme=dark] .fa-ast-u,[data-theme=dark] .fa-ast-act,[data-theme=dark] .fa-ast-ft button{background:#3a4868}",
		"@media print{.fa-ast,.fa-ast-fab{display:none!important}}",
		"@media (prefers-reduced-motion:no-preference){.fa-ast:not([hidden]){animation:faAstIn .16s ease-out}@keyframes faAstIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}",
	].join("\n");

	function go(target) {
		var kind = target[0], a = target[1];
		if (kind === "new") return frappe.new_doc(a);
		if (kind === "list") return frappe.set_route("List", a);
		if (kind === "report") return frappe.set_route("query-report", a);
		if (kind === "form") return frappe.set_route("Form", a, a);
		if (kind === "tree") return frappe.set_route("Tree", a);
		if (kind === "route") return frappe.set_route(a);
	}

	function build() {
		$("<style>").text(CSS).appendTo(document.head);
		var $fab = $(
			'<button type="button" class="fa-ast-fab" aria-haspopup="dialog" aria-expanded="false">' +
				'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4M12 16h.01"/></svg>' +
				"<span>دستیار</span></button>"
		);
		var $panel = $(
			'<section class="fa-ast" role="dialog" aria-label="دستیار سیمراکس" hidden>' +
				'<div class="fa-ast-hd"><b>دستیار سیمراکس<small>بپرسید هر کار را چطور انجام دهید</small></b>' +
				'<button type="button" class="fa-ast-clear" title="گفتگوی تازه" aria-label="گفتگوی تازه">⟲</button>' +
				'<button type="button" class="fa-ast-close" title="بستن" aria-label="بستن">✕</button></div>' +
				'<div class="fa-ast-body" aria-live="polite"></div>' +
				'<form class="fa-ast-ft"><label class="sr-only" for="fa-ast-q">سؤال شما</label>' +
				'<textarea id="fa-ast-q" rows="1" maxlength="600" placeholder="مثلاً: چک دریافتی را چطور ثبت کنم؟"></textarea>' +
				'<button type="submit">بپرس</button></form>' +
				"</section>"
		);
		$("body").append($fab, $panel);
		state.$fab = $fab;
		state.$root = $panel;
		state.$body = $panel.find(".fa-ast-body");
		state.$q = $panel.find("textarea");

		$fab.on("click", toggle);
		$panel.find(".fa-ast-close").on("click", close);
		$panel.find(".fa-ast-clear").on("click", function () {
			state.items = [];
			state.history = [];
			save([]);
			render();
			state.$q.trigger("focus");
		});
		$panel.find("form").on("submit", function (e) {
			e.preventDefault();
			send(state.$q.val());
		});
		state.$q.on("keydown", function (e) {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				send(state.$q.val());
			}
		});
		$panel.on("keydown", function (e) {
			if (e.key === "Escape") close();
		});
		$panel.on("click", ".fa-ast-chip", function () {
			send($(this).text());
		});
		$panel.on("click", ".fa-ast-act", function () {
			var t = $(this).data("go");
			if (Array.isArray(t)) go(t);
		});
		state.items = load();
		state.history = historyFrom(state.items);
	}

	function historyFrom(items) {
		return items.map(function (m) {
			if (m.role === "user") return { role: "user", content: m.text };
			var r = m.reply || {};
			var txt = [r.answer || ""].concat((r.steps || []).map(function (s, i) { return i + 1 + ". " + s; })).join("\n");
			return { role: "assistant", content: txt };
		}).slice(-6);
	}

	function toggle() {
		state.open ? close() : open();
	}
	function open(question) {
		state.open = true;
		state.$root.prop("hidden", false);
		state.$fab.attr("aria-expanded", "true");
		frappe.call({ method: API + "context", args: { route: JSON.stringify(frappe.get_route() || []) } }).then(function (r) {
			state.ctx = r.message || {};
			render();
		});
		render();
		state.$q.trigger("focus");
		if (question) send(question);
	}
	function close() {
		state.open = false;
		state.$root.prop("hidden", true);
		state.$fab.attr("aria-expanded", "false").trigger("focus");
	}

	function chips(list) {
		if (!list || !list.length) return "";
		return '<div class="fa-ast-chips">' + list.map(function (t) {
			return '<button type="button" class="fa-ast-chip">' + esc(t) + "</button>";
		}).join("") + "</div>";
	}

	function replyHtml(r) {
		var h = "";
		if (r.notice) h += '<div class="fa-ast-note">' + esc(r.notice) + "</div>";
		if (r.answer) h += "<div>" + esc(r.answer).replace(/\n/g, "<br>") + "</div>";
		if (r.steps && r.steps.length) {
			h += "<ol>" + r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
		}
		(r.tips || []).forEach(function (t) { h += '<div class="fa-ast-tip">' + esc(t) + "</div>"; });
		if (r.actions && r.actions.length) {
			h += '<div class="fa-ast-acts">' + r.actions.map(function (a) {
				return "<button type=\"button\" class=\"fa-ast-act\" data-go='" + esc(JSON.stringify(a.go)) + "'>" + esc(a.label) + "</button>";
			}).join("") + "</div>";
		}
		if (r.related && r.related.length) h += chips(r.related);
		return h;
	}

	function render() {
		var h = "";
		if (!state.items.length) {
			var sug = (state.ctx && state.ctx.suggestions) || [];
			h += '<div class="fa-ast-msg fa-ast-a"><div>سلام! هر جا در کار با برنامه گیر کردید، بپرسید تا مرحله‌به‌مرحله راهنمایی‌تان کنم.</div>' +
				'<div class="fa-ast-intro" style="margin-top:6px;font-size:12.5px">چند نمونه سؤال:</div>' + chips(sug) + "</div>";
		}
		state.items.forEach(function (m) {
			if (m.role === "user") h += '<div class="fa-ast-msg fa-ast-u">' + esc(m.text) + "</div>";
			else h += '<div class="fa-ast-msg fa-ast-a">' + replyHtml(m.reply || {}) + "</div>";
		});
		if (state.busy) h += '<div class="fa-ast-typing">در حال آماده کردن پاسخ…</div>';
		state.$body.html(h);
		state.$body.scrollTop(state.$body[0].scrollHeight);
		state.$root.find(".fa-ast-ft button").prop("disabled", state.busy);
	}

	function send(text) {
		text = String(text || "").trim();
		if (!text || state.busy) return;
		state.$q.val("");
		var history = state.history.slice();
		state.items.push({ role: "user", text: text });
		state.busy = true;
		render();
		frappe.call({
			method: API + "ask",
			type: "POST",
			args: { question: text, route: JSON.stringify(frappe.get_route() || []), history: JSON.stringify(history) },
			callback: function (r) {
				if (r && r.message) state.items.push({ role: "assistant", reply: r.message });
			},
			error: function () {
				state.items.push({ role: "assistant", reply: { answer: "پاسخ دریافت نشد. اتصال را بررسی کنید و دوباره بپرسید." } });
			},
			always: function () {
				state.busy = false;
				state.history = historyFrom(state.items);
				save(state.items);
				render();
			},
		});
	}

	function init() {
		if (!window.frappe || !frappe.boot || !frappe.session || frappe.session.user === "Guest") return;
		if (state.ready) return;
		state.ready = true;
		frappe.call({ method: API + "context", args: { route: "[]" } }).then(function (r) {
			var c = r.message || {};
			if (!c.enabled) return;
			state.ctx = c;
			build();
			window.FardaAssistant = { open: open, close: close, ask: function (q) { open(q); } };
		});
	}

	$(document).on("app_ready", init);
	$(function () { setTimeout(init, 1500); });
})();
