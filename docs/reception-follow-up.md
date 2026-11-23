# Reception follow-up

Each doctor-disruption Notification is the case; its unique appointmentRef/disruptionVersion and original slot remain the anchor. Empty recommendations never escalate. There is no recommendation checker, automatic call, retry schedule, reminder or automatic appointment transition.

Blocking captures the database wall clock after obtaining the doctor lock and persists the deadline: >48 hours remaining gives +24 elapsed hours; 24–48 inclusive gives +4; less than 24, including past, gives immediate escalation. Terminal FAILED email work also escalates at failedAt. Pending/stopped email delivery does not prevent deadline escalation. Queue GET derives eligibility without processing jobs. Scheduled deadline, earliest effective escalation, adjusted call-due time and next permitted contact instant are separate. 08:00 inclusive–20:00 exclusive daily Warsaw hours use civil dates; an overdue deadline is never reset nightly.

Receptionists/managers may operate on disrupted visits; admins read the new queue and history only (existing admin appointment permissions are unchanged). Managers cannot perform ordinary patient-requested moves or cancel unrelated confirmed visits. Existing guarded PUT cancellation checks all supplied case/calendar/version fields. Contact logging validates the exact current unresolved case after doctor/patient/appointment/notification locks, checks current phone and contact hours, and appends a server-attributed/time-stamped record. Read state, appointment version and resolution do not change. Duplicate case/key/payload/actor submissions replay; changed payload conflicts. Idempotent replay after resolution or allowed appointment/patient/doctor deletion reads the preserved case/attempt first, without requiring live relations and without writes. Current staff-role authorization, original appointment reference, case/version, actor and exact payload still must match.

REACHED_PATIENT does not resolve a case. Staff manually arrange subsequent calls during contact hours; optional 500-character plain-text notes can document arrangements. No automatic retry interval/cap, callback field or retrospective timestamps are accepted. Wrong/missing phone data remains visible; email never counts as a phone call. This app records calls and does not place them or guarantee exclusive staff calling; simultaneous real calls are not prevented by record idempotency.

Phone is optional, normalized international data in registration and the patient's own profile. Generic/nested user serialization explicitly excludes phone. Only registration, own patient profile, and authorized follow-up summaries expose it. Existing nulls remain null. The queue reads current contact information.

Contact history survives resolution and existing allowed appointment/account deletion. Notification records remain preserved; actorId detaches with SET NULL, actorRef retains the original numeric identity. Outcome, note, timestamps, case ID, calendar ID and observed version are retained. Notes can contain personal data supplied by staff: no full anonymization, retention expiry, session revocation or legal retention policy is implemented here. Existing rescheduling-history deletion restrictions still apply; no blanket new restriction is introduced.

Approved conservative legacy policy: migration 20261123000000 leaves historical followUpDeadlineAt NULL because old createdAt can be transaction-start time, not the actual post-lock recording instant. For unresolved historical cases only, it records legacyFollowUpEscalatedAt at the migration's wall clock. This is a policy activation timestamp, not an invented disruption time or historical deadline. Such cases immediately require attention; phone-contact due time is adjusted to Warsaw opening hours. The API/UI label timingBasis=LEGACY_UNKNOWN, return scheduledDeadlineAt/recordedAt as null and separately retain notificationCreatedAt. Resolved legacy cases remain resolved and receive no escalation marker. New blocking events continue to persist exact post-lock deadlines with timingBasis=EXACT_POST_LOCK. Existing terminal failure timestamps are derived from their recorded updatedAt. No historical notices, jobs or attempts are fabricated. Before authorizing deployment, check for NEEDS_RESCHEDULING appointments lacking a current notification and stop to decide how to handle unknown disruption timestamps. The earlier read-only preflight (not repeated during these review fixes) reported 0 disrupted appointments and 0 missing cases; Supabase was not migrated.

The follow-up page coordinates the rescheduling child’s pending state. Queue refresh, history filters, pagination, contact recording and cancellation cannot dismiss or overlap a submitted move before the result is known.

Verification uses disposable PostgreSQL. `bash backend/test/run-follow-ups-integration.sh` covers HTTP/locking/roles/privacy. The existing notification suite also checks SMTP with synthetic Mailpit captures. The browser check uses a strictly test-only noon clock, leaving the application's production clock unchanged:

```
MEDISLOT_PLAYWRIGHT=/path/to/playwright MEDISLOT_LIVE_API_ENTRY=backend/test/follow-ups-live-server.cjs MEDISLOT_LIVE_TEST=frontend/test/follow-ups.live.cjs bash frontend/test/run-rescheduling-live.sh
```

No Supabase email processing or real email delivery is part of verification.

## Implementation files

- [README.md](../README.md)
- [backend/src/app.module.ts](../backend/src/app.module.ts)
- [backend/src/appointments/appointments.controller.ts](../backend/src/appointments/appointments.controller.ts)
- [backend/src/appointments/appointments.dto.ts](../backend/src/appointments/appointments.dto.ts)
- [backend/src/appointments/appointments.service.ts](../backend/src/appointments/appointments.service.ts)
- [backend/src/calendars/calendars.service.ts](../backend/src/calendars/calendars.service.ts)
- [backend/src/common/patient-phone.ts](../backend/src/common/patient-phone.ts)
- [backend/src/common/serializers.ts](../backend/src/common/serializers.ts)
- [backend/src/email/worker.ts](../backend/src/email/worker.ts)
- [backend/src/follow-ups/case-guard.ts](../backend/src/follow-ups/case-guard.ts)
- [backend/src/follow-ups/follow-up-policy.ts](../backend/src/follow-ups/follow-up-policy.ts)
- [backend/src/follow-ups/follow-ups.controller.ts](../backend/src/follow-ups/follow-ups.controller.ts)
- [backend/src/follow-ups/follow-ups.dto.ts](../backend/src/follow-ups/follow-ups.dto.ts)
- [backend/src/follow-ups/follow-ups.module.ts](../backend/src/follow-ups/follow-ups.module.ts)
- [backend/src/follow-ups/follow-ups.service.ts](../backend/src/follow-ups/follow-ups.service.ts)
- [backend/src/users/users.controller.ts](../backend/src/users/users.controller.ts)
- [backend/src/users/users.dto.ts](../backend/src/users/users.dto.ts)
- [backend/src/users/users.service.ts](../backend/src/users/users.service.ts)
- [backend/test/alternatives.integration.ts](../backend/test/alternatives.integration.ts)
- [backend/test/follow-up-policy.test.ts](../backend/test/follow-up-policy.test.ts)
- [backend/test/follow-ups-live-server.cjs](../backend/test/follow-ups-live-server.cjs)
- [backend/test/follow-ups.integration.ts](../backend/test/follow-ups.integration.ts)
- [backend/test/notifications.integration.ts](../backend/test/notifications.integration.ts)
- [backend/test/rescheduling-migration.integration.cjs](../backend/test/rescheduling-migration.integration.cjs)
- [backend/test/run-follow-ups-integration.sh](../backend/test/run-follow-ups-integration.sh)
- [docs/openapi.yaml](openapi.yaml)
- [docs/reception-follow-up.md](reception-follow-up.md)
- [frontend/app/components/AppShell.tsx](../frontend/app/components/AppShell.tsx)
- [frontend/app/components/RescheduleAppointment.tsx](../frontend/app/components/RescheduleAppointment.tsx)
- [frontend/app/lib/types.ts](../frontend/app/lib/types.ts)
- [frontend/app/page.tsx](../frontend/app/page.tsx)
- [frontend/app/profile/page.tsx](../frontend/app/profile/page.tsx)
- [frontend/app/register/page.tsx](../frontend/app/register/page.tsx)
- [frontend/app/rescheduling/follow-ups/page.tsx](../frontend/app/rescheduling/follow-ups/page.tsx)
- [frontend/test/follow-ups.live.cjs](../frontend/test/follow-ups.live.cjs)
- [frontend/test/run-rescheduling-live.sh](../frontend/test/run-rescheduling-live.sh)
- [prisma/migrations/20261123000000_reception_follow_ups/migration.sql](../prisma/migrations/20261123000000_reception_follow_ups/migration.sql)
- [prisma/schema.prisma](../prisma/schema.prisma)

## Case history discovery and manager accounts

`GET /rescheduling/followUps/cases?status=ACTIVE|RESOLVED` lists real notification cases with consistent pagination. Active browsing includes unresolved cases not yet escalated; the escalation queue keeps its existing deadline rules. Resolved browsing retains detached cases. Opening history uses the row's notificationId, never an appointment ID or typed numeric guess. Empty case lists, existing cases with zero contact attempts, missing-case 404 and transient request errors have separate UI states. Tab/page/history requests reject obsolete responses. Browse controls are disabled while a submitted recovery is pending.

The admin Managers page reuses `GET /users?role=MANAGER` and displays name/email/clinic creation time only. Explicit manager filtering is admin-only; receptionist patient search remains unchanged. Successful creation refreshes to the last page so the new manager is visible, with a separate creation message and list-loading/error state. No passwords or private phones are returned in manager rows.

Read-only normal-database diagnosis for this UI change found the existing `manager1` account (ID 80). The original history request for notification 1 returned 404 NOT_FOUND because the configured normal database had zero notification cases and zero attempts; it was not a successful empty history response. No normal-database records were created, edited or recreated for these checks.
