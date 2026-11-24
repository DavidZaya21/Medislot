# Disruption notices and local email capture

This milestone supports **Mailpit capture only**, with synthetic `@example.test` or
`@example.invalid` recipients. It has no real-provider delivery, credential fallback,
SMTP relay, follow-up UI, requeue endpoint or contact-hours policy. Never point the
verification worker at Supabase or real patient data. The API can queue jobs while
the worker is stopped; it never connects to SMTP during blocking.

## Disposable local setup

Use a separate terminal and this explicit disposable URL. Do not substitute the
normal `.env` database. The compose file publishes only localhost ports and uses
an internal container network with no relay/forwarder configuration.

```sh
docker compose -f compose.notifications-test.yml up -d
export DATABASE_URL='postgresql://booking_test:booking_test@127.0.0.1:55432/medislot_notifications_local'
npx prisma migrate deploy
npx prisma generate
npm run dev:backend
```

Seed synthetic accounts/appointments only, using `@example.test` email addresses.
Run the worker in a second terminal with the **same explicit disposable URL**:

```sh
export DATABASE_URL='postgresql://booking_test:booking_test@127.0.0.1:55432/medislot_notifications_local'
MAIL_MODE=mailpit SMTP_HOST=127.0.0.1 SMTP_PORT=1025 APP_BASE_URL=http://localhost:3000 npm --workspace backend run worker:email
```

Open the capture inbox at http://localhost:8025. No external messages are sent.
The transport allows only local Mailpit hosts (`127.0.0.1`, `localhost`, `::1`, or
Docker service `mailpit`) on port 1025, rejects non-synthetic recipient domains,
and reads no real-provider credentials. Both capture mode and application origin
must be explicitly configured. The SMTP transport can later be replaced through
`EmailTransport`; real-provider support is not implemented.

Stop the disposable setup with `docker compose -f compose.notifications-test.yml down`.
The compose database is disposable; there is no production cleanup/reset operation.

## Guarantees and delivery semantics

- Each **new** CONFIRMED-to-NEEDS_RESCHEDULING transition increments the version and
  inserts one Notification and EmailJob in the blocking transaction. Unique event
  identity is `(appointmentRef, disruptionVersion)`; each notification has one job.
- Original doctor/start/end snapshots are retained, **never the visit reason**.
  No backfill or fabricated notices/jobs are added for pre-existing disruptions.
- Read status only changes `readAt`; resolution is separate. Successful recovery
  and cancellation resolve that disruption in their appointment transaction.
- Pending and claimed-but-not-prepared work is skipped on resolution. An attempt
  becomes in-flight at its final transactional preparation (`sendingAt`), which
  resolves the CURRENT recipient email and rechecks the exact disruption/version.
- Three total claimed attempts, including the initial attempt. A crash after claim
  consumes its reserved attempt even if SMTP had not started; restart never resets
  that limit. First attempt is immediately eligible. Temporary/ambiguous failures
  retry 1 minute after failure one, then 5 minutes after failure two. Definite
  permanent RCPT rejection fails after that attempt. Capture-safety rejection is
  terminal too. FAILED rows persist for later authorized follow-up integration.
- Jobs are claimed atomically using PostgreSQL SKIP LOCKED. Claim tokens fence
  completion; leases last 60 seconds and are renewed every 20 seconds while active.
  No doctor/appointment locks are held during SMTP. Expired claims become ambiguous
  failures, scheduled from lease expiry using the same delays/attempt budget.
- SENT means SMTP/provider acceptance, **not receipt or read**. There is no bounce
  or delivery-webhook processing in this milestone.
- SMTP cannot guarantee exactly once: acceptance followed by lost response or lost
  completion can produce a duplicate on retry, even with a stable Message-ID.
  There is no provider idempotency guarantee. Tests reproduce this in Mailpit.
- Resolution, deletion or email changes after the final check can race with an
  already in-flight SMTP attempt. It cannot be recalled; acceptance is recorded,
  and the link always loads current appointment state. No stale job can reactivate
  for a later disruption because event identity and resolved state are checked.

## Approved deletion handling and retained data

Existing account/doctor/appointment deletion paths explicitly resolve related
notices, skip unsent work, and detach nullable foreign keys atomically before
existing deletes. Notification and EmailJob rows are preserved; no blanket
notification-history deletion block and no cascade-delete of notices/jobs is added.
The patient link disappears when `appointmentId` is detached. Existing NEEDS_RESCHEDULING
and rescheduling-history deletion restrictions remain unchanged.

Retained fields include the doctor's original name and appointment times, original
appointment/calendar numeric references, disruption version, read/resolution/event
and job timestamps, delivery status, attempt counts, sanitized error category,
claim metadata and provider message ID. A recipient user reference remains while
that account exists; it is cleared when that recipient is deleted. Raw recipient
email addresses, visit reasons, raw SMTP responses and credentials are **not stored
in notification/job rows or worker logs**. Mailpit captures necessarily contain the
synthetic recipient email and rendered body until the capture data is removed.

The notification milestone alone was **not full account closure or anonymization**.
Patient hard deletion is now replaced by [patient account closure](patient-account-closure.md),
which retains the account/history relations, cancels the agreed visits, removes
login/contact details and invalidates versioned JWTs. It also fences prepared email
claims, with an explicit delivery-uncertain marker. The notification-only deletion
behavior described above remains applicable to other permitted deletion paths.
Detached records, retained snapshots and capture data are not automatically erased;
full erasure and retention-expiry policy remain unfinished.

## Verification

`bash backend/test/run-rescheduling-integration.sh` creates isolated PostgreSQL
and Mailpit containers, migrates only disposable databases, and runs HTTP/worker,
rollback, retry, lease, crash, detachment and existing regression tests. Requires
Docker and free localhost Mailpit ports 1025/8025; it stops its containers afterward.

```sh
MEDISLOT_PLAYWRIGHT=/path/to/playwright MEDISLOT_LIVE_TEST=frontend/test/notifications.live.cjs bash frontend/test/run-rescheduling-live.sh
```

The browser runner uses its own disposable PostgreSQL and ports 3350/4450. Fake
transport tests advance a controlled clock rather than sleeping through retries.
