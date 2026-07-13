#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-noma.ovh}"
TARGET_IP="${TARGET_IP:-127.0.0.1}"
ENDPOINT="${ENDPOINT:-/api/lb-check}"
REQUESTS="${REQUESTS:-8}"

for i in $(seq 1 "${REQUESTS}"); do
    response="$(curl -sk --resolve "${TARGET_HOST}:443:${TARGET_IP}" "https://${TARGET_HOST}${ENDPOINT}")"
    summary="$(printf '%s' "${response}" | node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(`${data.instance}\tport=${data.port}\tpid=${data.pid}`);')"
    printf '%02d %s\n' "${i}" "${summary}"
done
