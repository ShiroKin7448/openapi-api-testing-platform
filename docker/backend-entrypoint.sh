#!/bin/sh
set -e
# Apply pending database migrations before starting (safe to run on every boot).
if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "[entrypoint] Applying database migrations..."
  npx prisma migrate deploy --schema prisma/schema.prisma
fi
exec "$@"
