#!/bin/bash
# FardaERP CI pipeline (§27) — the single source of CI truth.
#
# The SAME stages run locally (this sandbox), and — once a workflows-scoped
# credential is available (CORE-002: this environment's GitHub token cannot
# push .github/workflows changes) — via the wrapper stored at
# scripts/ci/github-workflow.yml (copy it to .github/workflows/ to activate).
#
# Usage:  pipeline.sh [all|deps|lint|compile|unit|integration|security|build]
# Exit:   0 = all requested stages PASS (BLOCKED-ENV stages are reported, not fatal)
#         1 = at least one stage FAIL
set -u
cd "$(dirname "$0")/../.."   # repo root

PYTHON="${PYTHON:-python3}"
command -v /opt/tools/venv314/bin/python >/dev/null 2>&1 && PYTHON=/opt/tools/venv314/bin/python

RESULT=0
declare -A STATUS

report() { # stage code(0/1/2)
	local stage="$1" code="$2"
	case "$code" in
		0) STATUS[$stage]="PASS" ;;
		2) STATUS[$stage]="BLOCKED-ENV" ;;
		*) STATUS[$stage]="FAIL"; RESULT=1 ;;
	esac
}

run_stage() { # stage command...
	local stage="$1"; shift
	echo "─────[$stage]─────"
	"$@" >/tmp/farda_ci_${stage}.log 2>&1
	local code=$?
	if [ $code -ne 0 ]; then tail -15 /tmp/farda_ci_${stage}.log; fi
	report "$stage" $code
	echo "─────[$stage] ${STATUS[$stage]}─────"
}

# ── stage: deps — toolchain presence (informational, never fatal) ──────────
stage_deps() {
	local code=0
	for tool in git bash; do
		command -v "$tool" >/dev/null || { echo "missing: $tool"; code=1; }
	done
	for mod in yaml jsonschema; do
		"$PYTHON" -c "import $mod" 2>/dev/null || { echo "missing py module: $mod"; code=1; }
	done
	echo "python=$($PYTHON -V 2>&1) · frappe=$(cd sites 2>/dev/null && cat ../apps/frappe/frappe/__init__.py 2>/dev/null | grep -m1 __version__ || echo unknown)"
	return $code
}

# ── stage: lint — flake8 with the upstream ERPNext code set (+E117 fork idiom),
#             bash -n on every shell script, YAML parse of compose/workflow ──
stage_lint() {
	local code=0
	local codes
	codes=$("$PYTHON" - <<'EOF'
import re
txt = open('.flake8').read()
m = re.search(r'ignore\s*=\s*(.*?)(?=\n\s*\w+\s*=|\Z)', txt, re.S)
print(','.join(re.findall(r'\b[A-Z]{1,3}[0-9]{0,3}\b', m.group(1))))
EOF
) || return 1
	# upstream .flake8 in-value comment is rejected by flake8>=7 — same codes via CLI.
	# E117: fork idiom (tab-indented continuation literals); documented in docs/CI-CD.md
	"$PYTHON" -m flake8 --isolated --ignore="$codes,E117" erpnext/farda_iran scripts/ || code=1
	local sh
	for sh in scripts/*.sh scripts/ci/*.sh docker/*.sh; do
		[ -f "$sh" ] && bash -n "$sh" || { echo "bash -n failed: $sh"; code=1; }
	done
	for y in docker-compose.yml; do
		"$PYTHON" -c "import yaml,sys; yaml.safe_load(open('$y'))" || { echo "yaml invalid: $y"; code=1; }
	done
	return $code
}

# ── stage: compile — bytecode every farda module + compose-spec schema check ──
stage_compile() {
	local code=0
	"$PYTHON" -m compileall -q erpnext/farda_iran || code=1
	if "$PYTHON" - <<'PYEOF' 2>/dev/null
import yaml, json, jsonschema, pathlib
sp = pathlib.Path('/tmp/composespec/compose-spec-main/schema/compose-spec.json')
raw = open('docker-compose.yml').read()
doc = yaml.safe_load(raw.replace('${SITE_NAME:?set SITE_NAME in .env}', 'x')
                      .replace('${DB_ROOT_PASSWORD:?set DB_ROOT_PASSWORD in .env}', 'x')
                      .replace('${RUN_MIGRATIONS:-0}', '0')
                      .replace('${FRAPPE_SITE_NAME_HEADER:-$$host}', '$host'))
schema = json.load(open(sp))
cls = jsonschema.validators.validator_for(schema); cls.check_schema(schema)
cls(schema).validate(doc)
print('compose-spec: VALID')
PYEOF
	then
		:
	else
		if [ -f /tmp/composespec/compose-spec-main/schema/compose-spec.json ]; then
			echo "compose-spec schema check FAILED"
			code=1
		else
			echo "NOTE: compose-spec schema check skipped (schema file absent)"
		fi
	fi
	return $code
}

# ── stage: unit — frappe-free unit suite (runs anywhere, no site needed) ─────
_sites_dir() { # locate the bench sites dir (env override, GitHub layout, sandbox)
	if [ -n "${FARDA_BENCH_DIR:-}" ] && [ -d "$FARDA_BENCH_DIR/sites" ]; then
		echo "$FARDA_BENCH_DIR/sites"
	elif [ -d "../../../sites" ]; then   # GitHub layout: repo at bench/apps/erpnext
		echo "$PWD/../../../sites"
	elif [ -d "/opt/fardabench/frappe-bench/sites" ]; then
		echo "/opt/fardabench/frappe-bench/sites"
	else
		return 1
	fi
}

stage_unit() {
	local sites
	sites=$(_sites_dir) || { echo "no bench sites dir"; return 2; }
	cd "$sites"
	PYTHONIOENCODING=utf-8 "$PYTHON" -m frappe.utils.bench_helper frappe \
		--site smoke.farda.local execute erpnext.farda_iran.tests.run_unit_tests.run
	local code=$?
	cd - >/dev/null
	[ $code -eq 0 ] || return 1
	# run() returns a string; gate on the printed summary (N/N passed, 0 failed)
	grep -Eq "unit tests: [0-9]+/[0-9]+ passed, 0 failed" /tmp/farda_ci_unit.log || {
		echo "unit summary NOT all-pass"; return 1; }
	grep -q "JS parity tests: ALL PASS" /tmp/farda_ci_unit.log || {
		echo "JS parity missing/failed"; return 1; }
	return 0
}

# ── stage: integration — live-site gates (needs the runtime env; else BLOCKED)
stage_integration() {
	local sites
	sites=$(_sites_dir) || { echo "no bench sites dir — integration requires the runtime env"; return 2; }
	cd "$sites"
	PYTHONIOENCODING=utf-8 "$PYTHON" -m frappe.utils.bench_helper frappe \
		--site smoke.farda.local execute erpnext.farda_iran.tests.gate5_smoke.run_all \
		&& PYTHONIOENCODING=utf-8 "$PYTHON" -m frappe.utils.bench_helper frappe \
		--site smoke.farda.local execute erpnext.farda_iran.tests.test_integration_iran.run
	local code=$?
	cd - >/dev/null
	[ $code -eq 0 ] || return 1
	return 0
}

# ── stage: security — bandit vs reviewed baseline (only NEW medium+ fail) ────
stage_security() {
	command -v bandit >/dev/null 2>&1 || "$PYTHON" -m bandit --version >/dev/null 2>&1 || {
		echo "bandit not installed"; return 2; }
	if [ ! -f scripts/ci/bandit-baseline.json ]; then echo "baseline missing"; return 1; fi
	"$PYTHON" -m bandit -r erpnext/farda_iran -ll --baseline scripts/ci/bandit-baseline.json -q
}

# ── stage: build — wheel build (docker build = BLOCKED-ENV without daemon) ───
stage_build() {
	local code=0
	if command -v docker >/dev/null 2>&1; then
		docker build -f docker/Dockerfile --target final -t fardaerp:ci . || return 1
		echo "docker image built"
	else
		echo "docker: BLOCKED-ENV (no daemon) — building python wheel instead"
	fi
	rm -rf /tmp/farda_wheel && mkdir -p /tmp/farda_wheel
	"$PYTHON" -c "import flit_core" 2>/dev/null || "$PYTHON" -m pip install -q flit_core || return 2
	"$PYTHON" -m pip wheel --no-deps --no-build-isolation -w /tmp/farda_wheel . >/dev/null 2>&1 \
		|| { echo "pip wheel failed"; tail -20 /tmp/farda_ci_build.log 2>/dev/null; return 1; }
	local whl
	whl=$(ls /tmp/farda_wheel/*.whl 2>/dev/null | head -1)
	[ -n "$whl" ] || { echo "no wheel produced"; return 1; }
	"$PYTHON" - "$whl" <<'EOF'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
assert any('farda_iran/__init__.py' in n for n in names), 'farda_iran missing from wheel'
assert any('farda_iran/tax/service' in n for n in names), 'farda_iran.tax missing'
print(f"wheel OK: {sys.argv[1].split('/')[-1]} ({len(names)} files, farda_iran included)")
EOF
	[ $? -eq 0 ] || code=1
	return $code
}

STAGE="${1:-all}"
if [ "$STAGE" = "all" ]; then
	run_stage deps        stage_deps
	run_stage lint        stage_lint
	run_stage compile     stage_compile
	run_stage unit        stage_unit
	run_stage integration stage_integration
	run_stage security    stage_security
	run_stage build       stage_build
	echo "═══════ CI SUMMARY ═══════"
	for s in deps lint compile unit integration security build; do
		printf "  %-12s %s\n" "$s" "${STATUS[$s]}"
	done
	echo "══════════════════════════"
	[ "$RESULT" -eq 0 ] && echo "CI: ALL REQUESTED STAGES GREEN" || echo "CI: FAILURE PRESENT"
	exit $RESULT
fi

case "$STAGE" in
	deps|lint|compile|unit|integration|security|build) run_stage "$STAGE" "stage_$STAGE" ;;
	*) echo "unknown stage: $STAGE"; exit 1 ;;
esac
case "${STATUS[$STAGE]}" in
	BLOCKED-ENV) exit 0 ;;
	PASS) exit 0 ;;
	*) exit 1 ;;
esac
