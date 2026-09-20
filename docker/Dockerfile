# FardaERP production image — §26 Docker stack
#
# Baseline pins (docs/VERSIONS.md):
#   ERPNext v16.34.2 (this repo, package `erpnext` + isolated farda_iran module)
#   Frappe  v16.33.1 · HRMS v16.18.1 · Python 3.14 · Node 24 · MariaDB 10.6 · Redis 7.4.1
#
# At deploy time, upgrade the tag pins below to digest pins
# (`image@sha256:…`) after verifying availability in YOUR registry.


# ============================================================
# Node 24 toolchain
# ============================================================

FROM node:24-bookworm AS nodebin


# ============================================================
# Builder
# ============================================================

FROM python:3.14-slim-bookworm AS builder

ARG FRAPPE_VERSION=v16.33.1
ARG ERPNEXT_VERSION=v16.34.2
ARG HRMS_VERSION=v16.18.1
ARG BENCH_VERSION=5.31.0


ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MYSQLCLIENT_CFLAGS="-I/usr/include/mariadb" \
    MYSQLCLIENT_LDFLAGS="-L/usr/lib/x86_64-linux-gnu -lmariadb" \
    PATH=/home/frappe/frappe-bench/env/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ------------------------------------------------------------
# Builder system dependencies
# ------------------------------------------------------------

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        git \
        adduser \
        pkg-config \
        default-libmysqlclient-dev \
        libffi-dev \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz0b \
        zlib1g-dev \
        libjpeg-dev \
        mariadb-client \
        curl \
        procps \
    && rm -rf /var/lib/apt/lists/*
# ------------------------------------------------------------
# frappe user + bench structure
# ------------------------------------------------------------

RUN adduser --uid 1000 --home /home/frappe --shell /bin/bash --disabled-password --gecos "" frappe
USER frappe

WORKDIR /home/frappe/frappe-bench

RUN python -m venv env


# ------------------------------------------------------------
# Applications
# ------------------------------------------------------------

RUN git clone --depth 1 --branch ${FRAPPE_VERSION} \
    https://github.com/frappe/frappe \
    apps/frappe

RUN git clone --depth 1 --branch ${HRMS_VERSION} \
    https://github.com/frappe/hrms \
    apps/hrms


# ERPNext = this repository
COPY --chown=frappe:frappe . \
    /home/frappe/frappe-bench/apps/erpnext


# ------------------------------------------------------------
# Python dependencies
# ------------------------------------------------------------

RUN pip install --upgrade pip wheel && \
    pip install -e apps/frappe -e apps/erpnext -e apps/hrms && \
    pip install "frappe-bench==${BENCH_VERSION}" && \
    pip install "click==8.4.1"


# ------------------------------------------------------------
# Node 24 & Corepack
# ------------------------------------------------------------

COPY --from=nodebin /usr/local/bin /usr/local/bin
COPY --from=nodebin /usr/local/lib/node_modules /usr/local/lib/node_modules


# ------------------------------------------------------------
# Yarn 1.22.22
# ------------------------------------------------------------

USER root

RUN rm -f \
        /usr/local/bin/yarn \
        /usr/local/bin/yarnpkg \
        /usr/local/bin/pnpm \
        /usr/local/bin/pnpx \
    && corepack enable \
    && corepack prepare yarn@1.22.22 --activate

USER frappe


# ============================================================
# Bench build-time structure
# ============================================================

RUN mkdir -p \
        sites/assets \
        sites/logs \
        config/pids \
        logs \
    && printf 'frappe\nerpnext\nhrms\n' > sites/apps.txt \
    && printf '%s\n' '{"webserver_port":8000}' \
        > sites/common_site_config.json


# ============================================================
# Install frontend dependencies
# ============================================================

RUN cd apps/frappe && \
        yarn install --frozen-lockfile && \
    cd ../erpnext && \
        yarn install --frozen-lockfile && \
    cd ../hrms && \
        yarn install --frozen-lockfile


# ============================================================
# Build all Frappe/ERPNext/HRMS assets through Bench
# ============================================================

RUN bench build && \
    mkdir -p /home/frappe/static-assets && \
    cp -a /home/frappe/frappe-bench/sites/assets/. /home/frappe/static-assets/ && \
    rm -f /home/frappe/static-assets/frappe \
          /home/frappe/static-assets/erpnext \
          /home/frappe/static-assets/hrms && \
    cp -a /home/frappe/frappe-bench/apps/frappe/frappe/public \
          /home/frappe/static-assets/frappe && \
    cp -a /home/frappe/frappe-bench/apps/erpnext/erpnext/public \
          /home/frappe/static-assets/erpnext && \
    cp -a /home/frappe/frappe-bench/apps/hrms/hrms/public \
          /home/frappe/static-assets/hrms


# ============================================================
# Final backend image
# ============================================================

FROM python:3.14-slim-bookworm AS final


# ------------------------------------------------------------
# Runtime environment
# ------------------------------------------------------------

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8


# ------------------------------------------------------------
# Runtime system dependencies
# ------------------------------------------------------------

RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        mariadb-client \
        libmariadb3 \
        libffi8 \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz0b \
        fontconfig \
        file \
        curl \
        procps \
        wget \
    && rm -rf /var/lib/apt/lists/*


# ------------------------------------------------------------
# Runtime user
# ------------------------------------------------------------

RUN adduser --uid 1000 --home /home/frappe --shell /bin/bash --disabled-password --gecos "" frappe

# ------------------------------------------------------------
# Copy complete Bench from builder
# ------------------------------------------------------------

COPY --from=builder --chown=frappe:frappe \
    /home/frappe/frappe-bench \
    /home/frappe/frappe-bench


# ------------------------------------------------------------
# Node runtime
# ------------------------------------------------------------

COPY --from=nodebin \
    /usr/local/bin/node \
    /usr/local/bin/node


# ------------------------------------------------------------
# Persian PDF fonts
# ------------------------------------------------------------

COPY --chown=root:root \
    erpnext/farda_iran/public/fonts/Vazirmatn-Regular.ttf \
    erpnext/farda_iran/public/fonts/Vazirmatn-Bold.ttf \
    /usr/local/share/fonts/

RUN fc-cache -f


# ------------------------------------------------------------
# Runtime PATH
# ------------------------------------------------------------

ENV PATH=/home/frappe/frappe-bench/env/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER frappe

WORKDIR /home/frappe/frappe-bench


# ------------------------------------------------------------
# Entrypoint
# ------------------------------------------------------------

COPY --chown=frappe:frappe \
    docker/entrypoint.sh \
    /usr/local/bin/farda-entrypoint.sh

USER root

RUN chmod +x /usr/local/bin/farda-entrypoint.sh

USER frappe


# ------------------------------------------------------------
# Ports
# ------------------------------------------------------------

EXPOSE 8000 9000


# ------------------------------------------------------------
# Backend healthcheck
# ------------------------------------------------------------

HEALTHCHECK \
    --interval=30s \
    --timeout=10s \
    --start-period=30s \
    --retries=5 \
    CMD wget -q \
        -O /dev/null \
        --header="Host: ${FRAPPE_SITE_NAME_HEADER:-erp.farda.local}" \
        http://127.0.0.1:8000/ \
        || exit 1


# ------------------------------------------------------------
# Production backend
# ------------------------------------------------------------

ENTRYPOINT ["/usr/local/bin/farda-entrypoint.sh"]

CMD ["gunicorn", \
    "--chdir=/home/frappe/frappe-bench/sites", \
    "--bind=0.0.0.0:8000", \
    "--threads=4", \
    "--workers=2", \
    "--timeout=120", \
    "--preload", \
    "frappe.app:application"]


# ============================================================
# Frontend image
# ============================================================

FROM nginx:1.27-alpine AS frontend


# ------------------------------------------------------------
# Static assets produced by Bench
# ------------------------------------------------------------

COPY --from=builder \
    /home/frappe/static-assets \
    /usr/share/nginx/html/assets


# ------------------------------------------------------------
# Nginx configuration
# ------------------------------------------------------------
COPY docker/nginx/default.conf.template \
    /etc/nginx/conf.d/default.conf

# ------------------------------------------------------------
# Frontend port
# ------------------------------------------------------------

EXPOSE 8080


# ------------------------------------------------------------
# Frontend healthcheck
# ------------------------------------------------------------

HEALTHCHECK \
    --interval=30s \
    --timeout=10s \
    --start-period=30s \
    --retries=5 \
    CMD wget -q \
        -O /dev/null \
        --header="Host: ${FRAPPE_SITE_NAME_HEADER:-erp.farda.local}" \
        http://127.0.0.1:8080/ \
        || exit 1


# ------------------------------------------------------------
# Nginx
# ------------------------------------------------------------

CMD ["nginx", "-g", "daemon off;"]