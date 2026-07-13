#!/usr/bin/env bash
set -euo pipefail

SERVICE_TO_STOP="${1:-noma-backend-3001.service}"
REQUESTS="${REQUESTS:-6}"
TARGET_HOST="${TARGET_HOST:-noma.ovh}"
TARGET_IP="${TARGET_IP:-127.0.0.1}"
ENDPOINT="${ENDPOINT:-/api/lb-check}"

cleanup() {
    sudo systemctl start "${SERVICE_TO_STOP}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

sudo systemctl stop "${SERVICE_TO_STOP}"
sleep 2

for i in $(seq 1 "${REQUESTS}"); do
    response="$(curl -sk --resolve "${TARGET_HOST}:443:${TARGET_IP}" "https://${TARGET_HOST}${ENDPOINT}")"
    summary="$(printf '%s' "${response}" | node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(`${data.instance}\tport=${data.port}\tpid=${data.pid}`);')"
    printf '%02d %s\n' "${i}" "${summary}"
done
