"""Whitelisted endpoints for the in-app help assistant (دستیار سیمراکس).

ask()             answer a "how do I…" question with steps + buttons
context()         panel bootstrap: enabled flag + starter questions for the page
test_connection() System Manager check of the configured AI service

Buttons only ever come from the built-in guides and are filtered by the
asking user's own permissions, so the AI can never invent a link or reveal a
page the user cannot open. The assistant reads no business data.
"""

from __future__ import annotations

import json

import frappe
from frappe import _

from erpnext.farda_iran.api.limiter import is_allowed
from erpnext.farda_iran.assistant import guides as G
from erpnext.farda_iran.assistant import llm

SETTINGS = "Farda Assistant Settings"
MAX_ACTIONS = 4


def _settings() -> frappe._dict:
	if not frappe.db.exists("DocType", SETTINGS):
		return frappe._dict(enabled=1, use_ai=0, per_user_hourly_limit=30)
	doc = frappe.get_cached_doc(SETTINGS)
	s = frappe._dict(doc.as_dict())
	s.api_key = doc.get_password("api_key", raise_exception=False) if s.use_ai else None
	return s


def _ai_ready(s) -> bool:
	return bool(s.use_ai and s.api_base_url and s.model)


def _route_doctype(route) -> str | None:
	if isinstance(route, str):
		try:
			route = json.loads(route)
		except ValueError:
			route = [route]
	if not isinstance(route, list) or len(route) < 2:
		return None
	if str(route[0]).lower() not in ("form", "list", "tree", "report", "view"):
		return None
	name = str(route[1])[:140]
	return name if frappe.db.exists("DocType", name) else None


def _allowed(go) -> bool:
	try:
		kind, name = go[0], go[1]
		if kind in ("new", "list", "form", "tree"):
			if not frappe.db.exists("DocType", name):
				return False
			return bool(frappe.has_permission(name, "create" if kind == "new" else "read"))
		if kind == "report":
			return bool(frappe.db.exists("Report", name)) and frappe.get_cached_doc("Report", name).is_permitted()
		if kind == "route":
			return bool(frappe.db.exists("Page", name)) and frappe.get_cached_doc("Page", name).is_permitted()
	except Exception:
		return False
	return False


def _actions(guide_list) -> list[dict]:
	out, seen = [], set()
	for g in guide_list:
		for a in g.get("actions", ()):
			key = tuple(a["go"])
			if key in seen or not _allowed(a["go"]):
				continue
			seen.add(key)
			out.append({"label": a["label"], "go": list(a["go"])})
			if len(out) >= MAX_ACTIONS:
				return out
	return out


def _related(guide_list, exclude) -> list[str]:
	return [g["title"] for g in guide_list if g["id"] not in exclude][:3]


def _local_answer(question: str, doctype: str | None, matches: list[dict]) -> dict:
	if matches:
		top = matches[0]
		return {
			"answer": f"برای «{top['title']}» این مراحل را انجام دهید:",
			"steps": list(top["steps"]),
			"tips": list(top.get("tips", ())),
			"actions": _actions([top]),
			"related": _related(matches[1:], {top["id"]}),
		}
	page_guides = [g for g in G.GUIDES if doctype and doctype in g.get("doctypes", ())]
	if page_guides:
		return {
			"answer": "سؤال را دقیق متوجه نشدم. در همین صفحه معمولاً این کارها انجام می‌شود؛ یکی را انتخاب کنید یا سؤالتان را با جزئیات بیشتر بنویسید:",
			"steps": [],
			"tips": [],
			"actions": [],
			"related": [g["title"] for g in page_guides][:4],
		}
	return {
		"answer": "برای این سؤال راهنمایی پیدا نکردم. لطفاً کاری را که می‌خواهید انجام دهید ساده‌تر بنویسید؛ مثلاً «فاکتور فروش صادر کنم» یا «چک دریافتی ثبت کنم». اگر باز هم پیدا نشد، با مدیر سیستم تماس بگیرید.",
		"steps": [],
		"tips": [],
		"actions": [],
		"related": G.suggestions_for(None)[:3],
	}


@frappe.whitelist()
def context(route=None) -> dict:
	s = _settings()
	doctype = _route_doctype(route)
	return {
		"enabled": bool(s.enabled),
		"ai": _ai_ready(s),
		"suggestions": G.suggestions_for(doctype),
	}


@frappe.whitelist(methods=["POST"])
def ask(question=None, route=None, history=None) -> dict:
	s = _settings()
	if not s.enabled:
		frappe.throw(_("دستیار توسط مدیر سیستم غیرفعال شده است."))
	question = llm.clean_question(question)
	if not question:
		frappe.throw(_("سؤال خود را بنویسید."))
	limit = int(s.per_user_hourly_limit or 0)
	if limit and not is_allowed("assistant", frappe.session.user, limit, 3600):
		return {
			"answer": "تعداد سؤال‌های شما در این ساعت به سقف رسیده است. کمی بعد دوباره امتحان کنید.",
			"steps": [], "tips": [], "actions": [], "related": [], "source": "limit",
		}

	if isinstance(history, str):
		try:
			history = json.loads(history)
		except ValueError:
			history = None
	doctype = _route_doctype(route)
	matches = G.search(question, doctype)

	if _ai_ready(s):
		page = _(doctype) if doctype else None
		messages = llm.build_messages(
			question,
			[(g["id"], G.guide_as_text(g)) for g in matches],
			page,
			history=history,
			extra=s.extra_instructions,
		)
		try:
			content = llm.call_chat(s.api_base_url, s.api_key, s.model, messages, timeout=int(s.timeout or 30))
			reply = llm.parse_reply(content, G.GUIDES_BY_ID.keys())
			if reply["answer"] or reply["steps"]:
				used = [G.GUIDES_BY_ID[i] for i in reply["guide_ids"]] or matches[:1]
				return {
					"answer": reply["answer"],
					"steps": reply["steps"],
					"tips": [],
					"actions": _actions(used),
					"related": _related(matches, {g["id"] for g in used}),
					"source": "ai",
				}
		except RuntimeError as e:
			frappe.log_error(title="Farda Assistant: AI call failed", message=str(e))
			out = _local_answer(question, doctype, matches)
			out["source"] = "guide"
			out["notice"] = "دستیار هوشمند الان در دسترس نیست؛ این پاسخ از راهنمای داخلی است."
			return out

	out = _local_answer(question, doctype, matches)
	out["source"] = "guide"
	return out


@frappe.whitelist(methods=["POST"])
def test_connection() -> dict:
	frappe.only_for("System Manager")
	s = _settings()
	if not _ai_ready(s):
		return {"ok": False, "message": "آدرس سرویس و نام مدل را وارد و ذخیره کنید."}
	try:
		content = llm.call_chat(
			s.api_base_url,
			s.api_key,
			s.model,
			[{"role": "user", "content": "فقط بنویس: سلام"}],
			timeout=int(s.timeout or 30),
		)
	except RuntimeError as e:
		return {"ok": False, "message": str(e)}
	return {"ok": True, "message": "پاسخ سرویس: " + (content or "").strip()[:200]}
