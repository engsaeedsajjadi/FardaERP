#!/usr/bin/env node
/* JS parity tests for farda_iran/public/js/farda_ui.js — run by run_js_tests.py
 * (real JS execution via node; no faking).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const JS_PATH = path.join(__dirname, "..", "..", "public", "js", "farda_ui.js");
const VECTORS_PATH = path.join(__dirname, "jalali_vectors.json");

function loadFardaIR() {
	const code = fs.readFileSync(JS_PATH, "utf8");
	const sandbox = { window: {}, document: { addEventListener() {} }, Date, Math, parseInt, parseFloat, String, Number, isFinite };
	sandbox.window = sandbox; // window === global like a browser global scope
	vm.createContext(sandbox);
	vm.runInContext(code, sandbox);
	return sandbox.FardaIR;
}

let failures = 0;
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		failures += 1;
		console.error(`FAIL ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
	}
	return ok;
}

const F = loadFardaIR();
const pad2 = (n) => String(n).padStart(2, "0");

// 1) anchors (must match farda_iran/jalali tests)
check("selfTest anchors", F.selfTest(), true);
check("1405/06/24", F.toJalaliDisplay("2026-09-15"), "24/06/1405");
check("1404/01/01", F.toJalaliDisplay("2025-03-21"), "01/01/1404");
check("1403 kabiseh end", F.toJalaliDisplay("2025-03-20"), "30/12/1403");
check("1357/11/22", F.toJalaliDisplay("1979-02-11"), "22/11/1357");

// 2) exhaustive-ish parity vs Python vectors (generated from farda_iran.jalali.service)
const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));
for (const [gregISO, jalaliISO] of vectors.dates) {
	const gy = gregISO.slice(0, 4), gm = gregISO.slice(5, 7), gd = gregISO.slice(8, 10);
	const jy = jalaliISO.slice(0, jalaliISO.indexOf("-"));
	const rest = jalaliISO.slice(jalaliISO.indexOf("-") + 1);
	const jm = rest.slice(0, rest.indexOf("-"));
	const jd = rest.slice(rest.indexOf("-") + 1);
	const js = F.gregorianToJalali(parseInt(gy, 10), parseInt(gm, 10), parseInt(gd, 10));
	check(`parity ${gregISO}`, `${js[0]}-${pad2(js[1])}-${pad2(js[2])}`, jalaliISO);
	const back = F.jalaliToGregorian(parseInt(jy, 10), parseInt(jm, 10), parseInt(jd, 10));
	check(`roundtrip ${jalaliISO}`, `${back[0]}-${pad2(back[1])}-${pad2(back[2])}`, gregISO);
}

// 3) currency display (IRR -> Toman)
check("toman 1,000,000", F.irrToTomanText("1,000,000", 10), "100,000");
check("toman 1234567.5 irr", F.irrToTomanText("12345675", 10), "1,234,567.5");
check("toman negative", F.irrToTomanText("-500,000", 10), "-50,000");
check("toman zero", F.irrToTomanText("0", 10), "0");

if (failures > 0) {
	console.error(`JS parity tests: ${failures} FAILURES`);
	process.exit(1);
}
console.log("JS parity tests: ALL PASS");
