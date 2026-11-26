# Appointment lifecycle after 07071f4

## Problems addressed

Status PUT previously accepted reason edits, did not require the displayed version,
allowed unassigned doctors to update appointments, allowed future no-shows and late
cancellation, and prevented outcome recording for retained closed-patient visits.
Blocking also affected started/ended visits. Hard deletion could remove legacy
appointments instead of applying cancellation rules. Status changes had no audit.

## Implemented decisions

The stored enum stays CONFIRMED, NEEDS_RESCHEDULING, CANCELLED, COMPLETED, NO_SHOW.
Patient Upcoming/Past/In progress categories remain display-only.

- Booking starts CONFIRMED at version 1; it is not a historical transition event.
- CONFIRMED -> CANCELLED requires server now strictly before start.
- NEEDS_RESCHEDULING -> CANCELLED has no original-time cutoff. Every role supplies
  currentCalendarId and expectedVersion. Notification-backed cases also require exact
  notificationId/disruptionVersion; genuine legacy cases use explicit legacyDisruption=true.
- CONFIRMED -> COMPLETED / NO_SHOW requires server now >= scheduled end.
- NEEDS_RESCHEDULING -> CONFIRMED uses the existing transactional recovery endpoint.
- CONFIRMED -> CONFIRMED moves preserve existing cutoff/replacement rules and move
  history, but are not status changes. Generic same-status PUT is no longer accepted.
- Terminal statuses cannot be edited, reopened or deleted. No correction workflow
  or automatic completion/no-show job is introduced.

Doctors list/read/update assigned appointments only. Patients cancel only their
own visits. Admin/receptionist may perform valid cancellations/outcomes; assigned
doctors retain their existing cancellation permission within the same time rules.
Managers only recover/cancel current disruptions; no ordinary cancellation/outcomes.
Patients cannot record outcomes. Existing rescheduling role permissions and cutoffs
are unchanged (including admin not gaining the reschedule endpoint).

Closure still cancels future confirmed and every disrupted visit, preserving
in-progress/ended/terminal records. Authorized staff can subsequently record outcomes
for those retained confirmed visits. The patient lock allows closed accounts only
for this status path; booking, moves, contact writes and deletion remain protected.
Closed patients cannot regain authentication or have contact details restored.

## Transaction and audit method

Existing doctor-first (sorted for multiple doctors), then patient, then appointment,
notification and job ordering is preserved. Decisions use fresh locked state. The
shared server clock is read after locks (and after any current-case wait), so a
request crossing start/end while waiting uses the correct side of the boundary.
Blocking only considers published slots whose start is strictly after post-lock
server time. Started and ended slots/appointments are unchanged, including their
block flags and versions. Repeated blocking remains safe.

Every genuine status change increments appointment.version and appends one
AppointmentStatusTransition with appointment/version, old/new status, actor and
server timestamp in the same transaction. This includes blocking, account closure
and disrupted recovery. Same-status rescheduling still appends only move history.
Status changes do not increase rescheduleCount. Status requests preserve the stored
visit reason; the optional legacy reason field is ignored.

The migration adds an empty table and restrictive foreign keys; no historical
status events or actors are inferred/backfilled. Application APIs append events;
there is no new audit-edit/delete endpoint. Patient IDs/history relations remain
preserved. Audit actors cannot be hard-deleted. Doctor/user deletion is rejected
when it would erase any appointment, including legacy visits without audit/move
history. Direct appointment deletion is rejected: cancel eligible visits instead.
Other existing history/account restrictions remain.

Cancellation resolves disruptions, retains notices/contact history, skips unsent
email work, and releases isBooked only when no other active reservation remains.
isBlocked is independent and never cleared. Completed/no-show slots remain
historically reserved. Existing closure fencing and email in-flight limitations
remain; already accepted/prepared email cannot reliably be recalled.

## API and UI

PUT /appointments/:id requires status, displayed expectedVersion and currentCalendarId.
Missing/invalid fields return 400. Wrong role/ownership returns 403. Stale/ABA state,
invalid transitions/timing/case identity return 409 with an explicit reload instruction.
The response exposes the current unresolved disruption identity (or null), enabling
patient and ordinary staff cancellation without guessing a notification ID. Doctors'
list queries are server-scoped; caller-supplied filters cannot expand assignment.

AppointmentStatusActions is shared by appointment tables and follow-up cancellation.
It freezes the selected appointment snapshot for confirmation, has a synchronous
submission guard, hides ineligible actions and offers Complete and No-show after end.
A conflict removes confirmation and requires explicit reload and a new confirmation.
Appointment filters/navigation within the list are disabled during a submitted status
request. Shared queue busy/stale handling remains in effect. Context/mount generations
and stored account/token/session checks suppress obsolete response effects after an
account/session change or unmount. The appointment list also fences delayed reads;
shared recovery confirmation receives the same session protection.

## Fresh verification for this implementation

- backend/test/run-appointment-lifecycle-integration.sh: disposable PostgreSQL and
  synthetic Mailpit. Exact start/end boundaries (including +/-1ms), role/ownership,
  missing/stale/ABA identities, all-role case requirements, immutable terminals,
  closed-patient outcomes, future-only/repeat blocking, version/reason preservation,
  reservations/blocks, audit actors/timestamps, empty-audit migration preservation
  and Prisma schema diff. Real doctor-row lock waiters cross both cancellation and
  blocking start boundaries. Concurrent outcomes and cancel/block races serialize.
  Forced audit insertion failure rolls back status cancellation, blocking, closure
  and recovery. Forced move-history failure rolls back the recovery status audit too.
- Existing PostgreSQL regression runner: rescheduling, blocking, concurrent booking,
  publication/preview, appointment-read privacy, both recommendation flows and
  notification/email worker leases/retries/Mailpit. Existing fixtures now send a
  displayed identity, reject removed same-status edits and retain appointments
  instead of expecting deletion. Dedicated lifecycle tests do not auto-fill identities.
- Fresh account-closure and follow-up PostgreSQL regressions pass.
- frontend/test/appointment-lifecycle.live.cjs: real disposable API/PostgreSQL.
  Patient cancellation confirmation/Keep, no writes before confirmation, delayed
  response duplicate guard, frozen filters, 409 explicit reload/reconfirmation,
  disrupted cancellation, doctor assigned-only No-show, terminal action hiding and
  account-switch response fencing. SQL fixture timestamps are explicitly kept as
  UTC instants rather than relying on pg's local timestamp parsing.
- Existing follow-up live browser regression: contact/history, stale cancellation,
  manager past recovery/cancellation, pending move protection, admin read-only and
  pagination. Its strictly isolated test server uses a historical lifecycle clock
  so existing past-disruption fixtures were blocked before their scheduled starts.
- Backend unit tests, frontend/backend type checks, production frontend build,
  Prisma validation/client generation, OpenAPI parsing/references and diff checks.

All of the above are fresh runs for this change, not claims based on prior task
reports. They are focused tests, not an exhaustive proof of every interleaving.
No Supabase access/deployment or real email is included. The new migration must be
separately deployed before the updated backend is used with the normal database.
Legacy disrupted appointments without a notification for their current version can
explicitly cancel with legacyDisruption=true and locked version/calendar checks.
Recovery and closure remain unchanged. No notices or historical events are fabricated.
An audit browsing/correction/retention-expiry workflow is outside this step.

## Lifecycle review fixes: legacy cancellation and pending coordination

The review freshly reproduced two defects: no-notice legacy visits could not cancel
when replacement availability was absent, and a staff booking/list refresh could
unmount a pending status child and leave the parent controls permanently disabled.

Cancellation now reads the unique Notification(appointmentRef, disruptionVersion)
inside the existing doctor/patient/appointment locks. If any current-version row
exists (even resolved/detached), the exact normal case checks remain mandatory and
legacyDisruption=true is rejected. Otherwise an explicit legacyDisruption=true with
no notification fields permits cancellation. Ownership, assignment, manager-only
NEEDS_RESCHEDULING access, expectedVersion/currentCalendarId, open-account checks,
reservation release and independent blocks remain enforced. The only new event is
the real cancellation status audit at current server time. No replacement lookup,
notification, email job or reconstructed historical disruption is needed.

The normal appointment lists show Cancel for these visits. A scoped paginated
GET /rescheduling/followUps/legacyAppointments lets receptionists/managers/admins
discover genuine current no-notice disruptions; patients/doctors remain denied this
clinic-wide discovery endpoint and use existing own/assigned appointment lists.
The follow-up page has a separate legacy section; managers/receptionists can cancel
there, and admin follow-up remains read-only. Ordinary appointment permissions do
not expand. The list uses the same absence test as cancellation and writes nothing.

useAppointmentOperations gives the parent a synchronous, session-bound operation
lease, identified by a fresh UUID. Staff booking and status submission cannot claim
the lease simultaneously, including programmatic submit attempts before React
updates disabled controls. List refreshes are coalesced/deferred until settlement.
Booking/status finally blocks release only their original operation token, even
if the submitting child has unmounted. The parent ignores wrong-token, wrong-session
and unmounted callbacks. Business messages/redirects/recovery effects remain guarded
by mount/context and stored authentication. A 409 discards an implicit queued refresh
so it cannot unmount the stale confirmation and silently clear the explicit reload
requirement. A subsequent user reload obtains a fresh snapshot and confirmation.

Fresh verification for these fixes (not reused prior reports):

- Expanded disposable PostgreSQL/Mailpit lifecycle suite: legacy cancellation without
  any replacement for patient/admin/receptionist/assigned doctor/manager; denied
  ownership/assignment/unauthenticated calls; missing/stale version/calendar; strict
  current-notification and resolved/detached-row bypass prevention; a notice committed
  during a real lock wait; two concurrent cancellations; recovery versus cancellation
  in both lock orders. Exactly one current audit is written, no earlier notice/job/
  history is fabricated, reservation release keeps blocks. Scoped legacy discovery
  role/validation checks also pass. The existing exact boundaries/rollback tests remain.
- Real disposable browser: patient and manager legacy cancellation/discovery; the
  reproduced pending-cancellation/staff-booking scenario now blocks the competing
  submit, defers refresh, then completes with enabled controls and no duplicate.
  The reverse pending-booking/status scenario is protected too. Delayed old A cleanup
  cannot clear newer pending B in the same parent. A queued refresh during a 409
  does not remove the explicit reload/fresh-confirmation requirement.
- Fresh existing PostgreSQL regression suites and follow-up API suite; 55 backend
  unit tests; follow-up live browser regression; patient/receptionist initial-booking
  alternative browser regression (including delayed responses/context changes and
  duplicate submissions); type checks, frontend build, Prisma validation/schema diff,
  OpenAPI parsing/reference checks and git diff checks.

No additional schema migration is needed for these review fixes. The previously
pending lifecycle audit migration remains undeployed to Supabase. All writes and
synthetic SMTP acceptance in verification are disposable. Real database legacy-data
coverage is unknown because Supabase was not accessed. Tests are focused evidence,
not a proof of every possible browser/process interleaving.

Final-run coverage note: the core legacy/manager and mutual-exclusion browser
scenarios above ran successfully against real disposable PostgreSQL. A subsequent
repeat hit local ENOSPC; generated temporary Next build caches were removed and
the production build then passed. Docker later stopped responding, so the final
queued-refresh-on-409 safeguard was additionally verified with the real frontend
and a mocked API (no database), not claimed as a completed final PostgreSQL rerun.
That check confirms deferred reads stay deferred during submission, are discarded
on 409, and explicit reload plus a fresh confirmation succeeds with released
controls. The earlier fresh PostgreSQL/Mailpit, follow-up and booking-alternative
runs remain their own evidence. Docker was not reset or pruned.

### Manager appointment browsing and navigation

Managers can read the clinic-wide appointment list (including exact status filters),
individual appointments and the existing schedule page. This is read access, not
ordinary reception/account-management authority. POST /appointments, ordinary
CONFIRMED cancellation/rescheduling, Complete/No-show, appointment/calendar deletion
and account management remain forbidden. Existing schedule preview/publish/block
permissions and follow-up permissions are unchanged.

From appointment rows, managers may recover or cancel NEEDS_RESCHEDULING visits.
Cancellation retains the exact notification identity check, or explicit legacyDisruption
fallback only when no current notification exists, plus expectedVersion/currentCalendarId
under the existing locks. Reload and fresh confirmation are required on stale state.
Manager appointment payloads retain visit reason, identities, times, status, version,
move count and disruption identity. Nested patients expose id/name/closedAt only;
doctors expose id/userId/specialization and user id/name. Credentials, contact details
and unrelated profile metadata are excluded. Other roles retain their existing payloads.

Manager navigation now starts at Appointments, groups existing scheduling destinations,
and offers Profile/Logout in Account. Validated login-return paths retain priority.
The shared menu retains the WebKit pointer fix (actual outside focus, not null-target
blur dismissal), keyboard navigation, Escape, outside-click and mobile behavior.

Fresh verification for manager browsing (2026-11-26):
- Disposable PostgreSQL manager HTTP suite: clinic-wide list/detail, populated exact
  status filters, invalid filter 400, no-token 401, minimal nested payloads, schedule
  list/detail, patient ownership and assigned-doctor isolation. Eighteen direct
  forbidden mutations returned 403 with unchanged appointment contents.
- Current-notification cancellation rejects missing/wrong legacy identity and stale
  versions; genuine legacy cancellation and disrupted recovery succeed. A recovered
  CONFIRMED visit cannot be moved again by a manager. Blocks, reservations, move
  count and history remained consistent.
- Existing lifecycle and follow-up PostgreSQL suites plus all nine existing
  rescheduling-related suites passed, including appointment reads, concurrent booking,
  blocking, schedule preview/publish, both alternatives paths and notification/email
  integration. Only synthetic Mailpit was used where those regressions require SMTP.
- 55 backend unit tests passed. Backend/frontend type checks and OpenAPI parsing /
  all 256 internal references passed.
- Playwright WebKit and Chromium with mocked APIs: manager row actions (ordinary
  actions absent; notification-backed and legacy cancellation confirmations and
  recovery open/close), every scheduling/account destination by pointer click with
  URL/page checks at desktop/mobile widths, Appointments/Follow-up links, keyboard,
  Tab-away/Escape/outside-click, active states, Logout, normal manager landing,
  dashboard redirect and validated recovery login-return path. The admin pointer
  regression passed in both engines too, including every People menu item.
  Safari's standalone app was not automated. These browser runs did not use PostgreSQL;
  mutation authority/atomicity was verified separately through real PostgreSQL HTTP tests.

No new migration is required. Supabase was not accessed and no real email was sent.
Final manager run: frontend production build and git diff checks passed. The
manager test containers and temporary browser server were confirmed stopped.

### Admin appointment creation removed (2026-11-26)

POST /appointments now permits only PATIENT and RECEPTIONIST. The route allowlist
and service entry guard reject ADMIN, MANAGER and DOCTOR before booking reads or
writes. Every alternative booking uses this same endpoint and permission check;
read-only alternative retrieval does not grant booking permission. Admin appointment
list/detail/filter access and existing cancellation/Complete/No-show permissions
are unchanged. The appointment creation form and its alternative-booking UI now
render for receptionists only. Patients retain the existing Book appointment flow.
No account-management, manager, lifecycle or navigation permission was expanded.

Fresh evidence:
- Disposable PostgreSQL booking-role HTTP suite: ADMIN/MANAGER/DOCTOR 403 and
  unauthenticated 401; rejected admin requests to available/taken/suggested slots
  preserve the full appointment/calendar/audit/move-history/notification/job snapshot.
  Patient self-booking and receptionist booking return 201, including alternatives;
  supplied patientId cannot change patient self-booking identity. Admin list/detail/
  filters return 200; cancellation and both ended-visit outcomes return 200 and append
  only their expected three status audits. No email jobs are created or processed.
- Existing concurrent-booking (verified overlapping reads), appointment-read,
  initial-booking-alternatives and manager PostgreSQL regressions passed. Those tests
  used disposable databases only, with no email worker or SMTP service.
- All 56 backend unit tests and backend/frontend type checks passed, including a
  service-level denial test that cannot reach database methods for denied roles.
- Chromium browser checks with mocked APIs: admin/manager/doctor creation forms
  absent; receptionist creation submits once and shows success; patient selection,
  review and explicit confirmation submit one own booking. These UI tests do not
  claim a real PostgreSQL browser flow; database authority was tested separately.

No schema migration was added. Supabase was not accessed; no email was sent.

### Receptionist navigation and collapsible booking (2026-11-26)

Receptionists now land on Appointments after normal login and when visiting the
old home route; validated return paths retain priority. Navigation is Appointments,
Follow-up, and the shared corrected Account menu (Profile/Logout). Other roles'
landing/navigation rules and all backend permissions remain unchanged.

Booking starts collapsed. The Create appointment/Close form toggle controls a
labelled panel. Close is disabled and synchronously guarded by bookingRef and the
shared operation lease during booking/status submission; form fields remain mounted
and disabled, so a close cannot discard an in-flight request. Errors and taken-slot
recovery keep the form and entered context. Success resets the controlled values,
reason, suggestions and confirmation, closes the panel and refreshes the list via
the existing deferred-refresh mechanism. Close/reset/session changes invalidate
outstanding patient/slot reads so late responses cannot restore cleared choices.
Existing alternatives, explicit alternative confirmation, duplicate submission and
status/rescheduling coordination remain in place.

Fresh verification: Playwright WebKit and Chromium with mocked APIs passed open/
close without mutation requests, delayed search after closure, delayed status and
booking with queued refresh, disabled close and duplicate protection, validation
errors preserving fields, taken-slot review/explicit confirmation, successful list
refresh and form reset, normal/home login redirects, validated recovery deep link,
and desktop/mobile Account item clicks, keyboard/Escape/outside-click and Logout.
The Chromium booking-role UI regression passed for admin/manager/doctor form absence,
receptionist booking and patient self-booking. Existing live PostgreSQL browser
scripts were updated to open the form first, but were not rerun in this frontend-only
step. No real API/database result is claimed for these mock browser runs.
Frontend type checking, production build, JavaScript syntax and diff checks passed.
No Supabase access, migration, email processing or sends occurred.
