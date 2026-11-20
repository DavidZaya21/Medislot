#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Requires Docker PostgreSQL and a Playwright install (MEDISLOT_PLAYWRIGHT).
for port in 3350 4450; do
 if curl --connect-timeout 1 -s "http://localhost:$port/health" >/dev/null; then
  echo "Test port $port is occupied; refusing to reuse an unknown server." >&2
  exit 1
 fi
done
compiled="$(mktemp -d /tmp/medislot-reschedule-ui-api.XXXXXX)"
web="$(mktemp -d /tmp/medislot-reschedule-ui-web.XXXXXX)"
cp -R frontend/app "$web/app"
cp frontend/package.json frontend/tsconfig.json frontend/next-env.d.ts "$web/"
ln -s "$PWD/node_modules" "$web/node_modules"
./node_modules/.bin/tsc -p backend/tsconfig.build.json --incremental false --outDir "$compiled"
container="$(docker run --rm -d -e POSTGRES_DB=medislot_frontend_reschedule_test -e POSTGRES_USER=booking_test -e POSTGRES_PASSWORD=booking_test -p 127.0.0.1::5432 postgres:16-alpine)"
backend_pid=
frontend_pid=
cleanup() {
 if test -n "$backend_pid"; then kill "$backend_pid" 2>/dev/null || true; fi
 if test -n "$frontend_pid"; then kill "$frontend_pid" 2>/dev/null || true; fi
 docker stop "$container" >/dev/null || true
}
trap cleanup EXIT
for ((i=0;i<30;i++)); do
 if docker exec "$container" pg_isready -h 127.0.0.1 -U booking_test >/dev/null 2>&1; then break; fi
 sleep 1
done
binding="$(docker port "$container" 5432/tcp)"
export DATABASE_URL="postgresql://booking_test:booking_test@${binding}/medislot_frontend_reschedule_test"
./node_modules/.bin/prisma migrate deploy
NODE_PATH="$PWD/node_modules" BACKEND_PORT=4450 JWT_SECRET=reschedule-ui-test node "$compiled/main.js" > /tmp/medislot-reschedule-ui-api.log 2>&1 &
backend_pid=$!
NEXT_PUBLIC_API_BASE_URL=http://localhost:4450 ./node_modules/.bin/next dev "$web" --port 3350 > /tmp/medislot-reschedule-ui-web.log 2>&1 &
frontend_pid=$!
ready=
for ((i=0;i<60;i++)); do
 if curl -sf http://localhost:4450/health >/dev/null && curl -sf http://localhost:3350/login >/dev/null; then ready=1; break; fi
 sleep 1
done
test "$ready" = 1
node "${MEDISLOT_LIVE_TEST:-frontend/test/rescheduling.live.cjs}"
