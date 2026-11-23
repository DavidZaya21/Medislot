#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
compiled="$(mktemp -d /tmp/medislot-followup-api.XXXXXX)"
./node_modules/.bin/tsc --module NodeNext --target ES2022 --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --skipLibCheck --strict --rootDir backend --outDir "$compiled" backend/src/types/packages.d.ts backend/test/follow-ups.integration.ts
container="$(docker run --rm -d -e POSTGRES_DB=medislot_followups_test -e POSTGRES_USER=booking_test -e POSTGRES_PASSWORD=booking_test -p 127.0.0.1::5432 postgres:16-alpine)"
trap 'docker stop "$container" >/dev/null || true' EXIT
for ((i=0;i<30;i++));do if docker exec "$container" pg_isready -U booking_test >/dev/null 2>&1;then break;fi;sleep 1;done
binding="$(docker port "$container" 5432/tcp)"
export MEDISLOT_TEST_DATABASE_URL="postgresql://booking_test:booking_test@${binding}/medislot_followups_test"
DATABASE_URL="$MEDISLOT_TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy
DATABASE_URL="$MEDISLOT_TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
NODE_PATH="$PWD/node_modules" node --test "$compiled/test/follow-ups.integration.js"
