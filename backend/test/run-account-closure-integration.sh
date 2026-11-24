#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
compiled="$(mktemp -d /tmp/medislot-closure-api.XXXXXX)"
./node_modules/.bin/tsc --module NodeNext --target ES2022 --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --skipLibCheck --strict --rootDir backend --outDir "$compiled" backend/src/types/packages.d.ts backend/test/account-closure.integration.ts
container="$(docker run --rm -d -e POSTGRES_DB=medislot_closure_test -e POSTGRES_USER=booking_test -e POSTGRES_PASSWORD=booking_test -p 127.0.0.1::5432 postgres:16-alpine)"
mailpit=
trap 'if test -n "$mailpit"; then docker stop "$mailpit" >/dev/null || true; fi; docker stop "$container" >/dev/null || true' EXIT
mailpit="$(docker run --rm -d -p 127.0.0.1:1025:1025 axllent/mailpit:v1.27.4)"
for ((i=0;i<30;i++));do if docker exec "$container" pg_isready -U booking_test >/dev/null 2>&1;then break;fi;sleep 1;done
binding="$(docker port "$container" 5432/tcp)"
export MEDISLOT_TEST_DATABASE_URL="postgresql://booking_test:booking_test@${binding}/medislot_closure_test"
DATABASE_URL="$MEDISLOT_TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy
DATABASE_URL="$MEDISLOT_TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
node backend/test/account-closure-migration.cjs
NODE_PATH="$PWD/node_modules" node --test "$compiled/test/account-closure.integration.js"
