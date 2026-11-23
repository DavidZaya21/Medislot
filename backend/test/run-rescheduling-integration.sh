#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
compiled="$(mktemp -d /tmp/medislot-reschedule-js.XXXXXX)"
./node_modules/.bin/tsc --module NodeNext --target ES2022 --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --skipLibCheck --strict --rootDir backend --outDir "$compiled" backend/src/types/packages.d.ts backend/test/rescheduling.integration.ts backend/test/appointments-booking.integration.ts backend/test/calendar-block.integration.ts backend/test/schedule-publish.integration.ts backend/test/schedule-preview.integration.ts backend/test/appointment-read.integration.ts backend/test/alternatives.integration.ts backend/test/booking-alternatives.integration.ts backend/test/notifications.integration.ts backend/src/email/main.ts
container="$(docker run --rm -d -e POSTGRES_DB=medislot_reschedule_test -e POSTGRES_USER=booking_test -e POSTGRES_PASSWORD=booking_test -p 127.0.0.1::5432 postgres:16-alpine)"
mailpit=
cleanup() {
 if test -n "$mailpit"; then docker stop "$mailpit" >/dev/null || true; fi
 docker stop "$container" >/dev/null || true
}
trap cleanup EXIT
mailpit="$(docker run --rm -d -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit:v1.27.4)"
export MEDISLOT_MAILPIT_HTTP=http://127.0.0.1:8025
ready=
for ((i=0;i<30;i++)); do
 if docker exec "$container" pg_isready -h 127.0.0.1 -U booking_test >/dev/null 2>&1; then ready=1; break; fi
 sleep 1
done
test "$ready" = 1
binding="$(docker port "$container" 5432/tcp)"
for name in medislot_reschedule_test medislot_block_test medislot_booking_test medislot_publish_test medislot_preview_test medislot_appointment_read_test medislot_alternatives_test medislot_booking_alternatives_test medislot_notifications_test; do
 if test "$name" != medislot_reschedule_test; then docker exec "$container" createdb -U booking_test "$name"; fi
 export MEDISLOT_TEST_DATABASE_URL="postgresql://booking_test:booking_test@${binding}/${name}"
 DATABASE_URL="$MEDISLOT_TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy
 case "$name" in
  medislot_reschedule_test) DATABASE_URL="$MEDISLOT_TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code; node backend/test/rescheduling-migration.integration.cjs; testfile=rescheduling.integration.js ;;
  medislot_block_test) testfile=calendar-block.integration.js ;;
  medislot_booking_test) testfile=appointments-booking.integration.js ;;
  medislot_publish_test) testfile=schedule-publish.integration.js ;;
  medislot_preview_test) testfile=schedule-preview.integration.js ;;
  medislot_appointment_read_test) testfile=appointment-read.integration.js ;;
  medislot_alternatives_test) testfile=alternatives.integration.js ;;
  medislot_booking_alternatives_test) testfile=booking-alternatives.integration.js ;;
  medislot_notifications_test) testfile=notifications.integration.js ;;
 esac
 NODE_PATH="$PWD/node_modules" node --test "$compiled/test/$testfile"
done
