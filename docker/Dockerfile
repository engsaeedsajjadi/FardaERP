# FardaERP production image — §26 Docker stack
#
# Baseline pins (docs/VERSIONS.md):
#   ERPNext v16.34.2 (this repo, package `erpnext` + isolated farda_iran module)
#   Frappe  v16.33.1 · HRMS v16.18.1 · Python 3.14 · Node 24 · MariaDB 10.6 · Redis 7.4.1
#
# At deploy time, upgrade the tag pins below to digest pins
# (`image@sha256:…`) after verifying availability in YOUR registry.

# ---------- node binary (runtime for socketio; build tool below) ----------
FROM node:24-bookworm AS nodebin

# ---------- builder ----------
FROM python:3.14-slim-bookworm AS builder

ARG FRAPPE_VERSION=v16.33.1
ARG ERPNEXT_VERSION=v16.34.2
ARG HRMS_VERSION=v16.18.1
ARG BENCH_VERSION=5.31.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git pkg-config \
        default-libmysqlclient-dev libffi-dev \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b \
        zlib1g-dev libjpeg-dev \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash -u 1000 frappe
USER frappe
WORKDIR /home/frappe/frappe-bench
RUN python -m venv env
ENV PATH=/home/frappe/frappe-bench/env/bin:$PATH

# apps: frappe + hrms from pinned upstream tags, erpnext from this repo
RUN git clone --depth 1 --branch ${FRAPPE_VERSION} https://github.com/frappe/frappe apps/frappe
RUN git clone --depth 1 --branch ${HRMS_VERSION} https://github.com/frappe/hrms apps/hrms
COPY --chown=frappe:frappe . /home/frappe/frappe-bench/apps/erpnext

RUN pip install --upgrade pip wheel && \
    pip install -e apps/frappe -e apps/erpnext -e apps/hrms && \
    # frappe-bench 5.31 pins click~=8.2 but frappe v16 needs click~=8.4 —
    # install bench normally, then re-pin click to frappe's requirement
    # (verified working: bench loads frappe commands under click 8.4)
    pip install "frappe-bench==${BENCH_VERSION}" && \
    pip install "click==8.4.1"

# Node + yarn/npm (build) — merged COPY keeps python entrypoints intact
COPY --from=nodebin /usr/local/bin /usr/local/bin
COPY --from=nodebin /usr/local/lib/node_modules /usr/local/lib/node_modules
# node:24 bundles yarn 1.x at /opt/yarn-v1.22.x with only a SYMLINK in
# /usr/local/bin — the selective COPY leaves that symlink dangling, so
# drop the dead shims and reinstall yarn classic from the npm registry
# (npm itself survives the COPY: real files under /usr/local/lib/node_modules).
USER root
RUN rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && npm install -g --silent yarn@1.22.22
USER frappe

# build-time site config: erpnext's banking/ (vite) reads webserver_port
# from sites/common_site_config.json during `yarn build` — absent in the
# builder stage it dies with ENOENT (found by the first real image build).
RUN mkdir -p sites && printf '{\n  "webserver_port": 8000\n}\n' > sites/common_site_config.json

# node deps for ALL apps BEFORE any build: bench/esbuild resolves imports
# across app trees (frappe's build bundles erpnext/hrms entry points), so
# building an app before its deps are installed yields unresolved imports
# (onscan.js / html2canvas) in the bundle.
RUN cd apps/frappe && yarn install --frozen-lockfile && \
    cd ../erpnext && yarn install --frozen-lockfile && \
    cd ../hrms && yarn install --frozen-lockfile

# assets build (output lands in sites/assets, copied by the frontend target)
RUN cd apps/frappe && yarn build && \
    cd ../erpnext && yarn build && \
    cd ../hrms && yarn build

# ---------- final (backend / workers / scheduler / websocket) ----------
FROM python:3.14-slim-bookworm AS final

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8

# runtime libs: mariadb client lib (mysqlclient), pango stack (weasyprint PDF),
# file(1) (frappe restore type-sniff — see docs/BACKUP-RESTORE.md §8),
# procps (worker healthchecks), fontconfig + bundled Vazirmatn for PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libmariadb3 libffi8 \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b \
        fontconfig file curl procps \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash -u 1000 frappe
COPY --from=builder --chown=frappe:frappe /home/frappe/frappe-bench /home/frappe/frappe-bench
COPY --from=builder --chown=root:root /usr/local/bin/node /usr/local/bin/node

# Persian PDF fonts (OFL, bundled in this repo; context-relative paths)
COPY --chown=root:root \
    erpnext/farda_iran/public/fonts/Vazirmatn-Regular.ttf \
    erpnext/farda_iran/public/fonts/Vazirmatn-Bold.ttf \
    /usr/local/share/fonts/
RUN fc-cache -f

ENV PATH=/home/frappe/frappe-bench/env/bin:$PATH
USER frappe
WORKDIR /home/frappe/frappe-bench

COPY --chown=frappe:frappe docker/entrypoint.sh /usr/local/bin/farda-entrypoint.sh
RUN chmod +x /usr/local/bin/farda-entrypoint.sh

EXPOSE 8000 9000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
    CMD curl -fsS http://localhost:8000/api/method/ping || exit 1

# gunicorn prod server (same invocation as frappe_docker)
CMD ["gunicorn", "--chdir=/home/frappe/frappe-bench/sites", \
     "--bind=0.0.0.0:8000", "--threads=4", "--workers=2", \
     "--timeout=120", "--preload", "frappe.app:application"]

# ---------- frontend (nginx static assets + reverse proxy) ----------
FROM nginx:1.27-alpine AS frontend

# bench build output (JS/CSS bundles) — immutable, baked into the image
COPY --from=builder /home/frappe/frappe-bench/sites/assets /usr/share/nginx/html/assets
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
    CMD wget -q -O /dev/null http://localhost:8080/api/method/ping || exit 1

CMD ["nginx", "-g", "daemon off;"]

