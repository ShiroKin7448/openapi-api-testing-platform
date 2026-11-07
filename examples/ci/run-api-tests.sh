#!/usr/bin/env bash
# Chạy kiểm thử API từ bất kỳ hệ thống CI nào (Jenkins, GitLab CI, ...) hoặc máy local.
# Cách dùng:
#   API_TEST_URL=http://localhost:3000 API_TEST_TOKEN=att_xxx API_TEST_PROJECT_ID=<uuid> ./run-api-tests.sh
# Mã thoát: 0 = tất cả đạt, 1 = có ca lỗi / lỗi hệ thống. File junit.xml được lưu ở thư mục hiện tại.
set -euo pipefail
: "${API_TEST_URL:?Thiếu API_TEST_URL}"
: "${API_TEST_TOKEN:?Thiếu API_TEST_TOKEN}"
: "${API_TEST_PROJECT_ID:?Thiếu API_TEST_PROJECT_ID}"
TIMEOUT_SECONDS="${API_TEST_TIMEOUT:-900}"
AUTH="Authorization: Bearer ${API_TEST_TOKEN}"

BODY='{}'
if [ -n "${API_TEST_ENV_ID:-}" ]; then BODY="{\"environmentId\":\"${API_TEST_ENV_ID}\"}"; fi

RUN_ID=$(curl -sS --fail-with-body -X POST -H "$AUTH" -H "Content-Type: application/json" -d "$BODY" \
  "${API_TEST_URL}/api/ci/projects/${API_TEST_PROJECT_ID}/runs" | jq -r '.data.runId')
echo "Đã tạo lượt chạy: ${RUN_ID}"

DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
while :; do
  STATUS_JSON=$(curl -sS --fail-with-body -H "$AUTH" "${API_TEST_URL}/api/ci/test-runs/${RUN_ID}")
  if [ "$(echo "$STATUS_JSON" | jq -r '.data.finished')" = "true" ]; then break; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then echo "Hết thời gian chờ" >&2; exit 1; fi
  echo "$(echo "$STATUS_JSON" | jq -r '"  \(.data.status): \(.data.summary.executed)/\(.data.summary.total) ca"')"
  sleep 5
done

curl -sS -H "$AUTH" -o junit.xml "${API_TEST_URL}/api/ci/test-runs/${RUN_ID}/export?format=junit"
echo "$STATUS_JSON" | jq '.data.summary'
if [ "$(echo "$STATUS_JSON" | jq -r '.data.passed')" = "true" ]; then
  echo "✔ Tất cả kiểm thử đều đạt"
else
  echo "✘ Có kiểm thử không đạt (xem junit.xml)" >&2
  exit 1
fi
