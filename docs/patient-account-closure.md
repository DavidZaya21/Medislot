# Patient account closure

Implemented locally after b68bff1. This is account closure and restricted history
retention, **not anonymization or full erasure**. No retention expiry or erasure
policy is invented here.

## API and confirmation

`POST /users/me/close` accepts `currentPassword`, `confirmed: true` and a v4 UUID
`requestId`. Only the authenticated PATIENT can close their own account; there is
no target user ID. The UI explains cancellations, unchanged in-progress/ended
visits, retained reasons/notes and the email no-recall limitation before requiring
password and explicit checkbox confirmation. Wrong password gives 401, invalid
confirmation/input 400, other roles 403, missing authentication 401. Success is
200 `{ "closed": true }`.

A synchronous pending guard prevents duplicate submissions. Identical request IDs
replay the committed success with no writes, including concurrent retries. The
closure-only guard accepts the original signed token after closure solely when
its previous auth version and the stored receipt ID match. That token is rejected
by every other endpoint, and other receipt IDs are rejected. Receipt replay still
requires the original token to be unexpired. The stored receipt
is private and never serialized. Replay does not recheck a removed password;
it only acknowledges the already committed operation and returns no personal data.
The UUID and originating browser session ID are stored in per-tab sessionStorage
so a lost success response can be retried after reload in that same session. Passwords are never persisted there. An uncommitted
request after reload requires the actual password again. Browser success clears
authentication, displays confirmation and propagates logout through storage events
across tabs (plus a same-tab event for all auth-hook instances).

## Transaction and retained records

One Read Committed transaction locks existing doctor rows in ascending ID order,
then the patient row, matching the established rare administrative deletion order.
Mutable patient state/password is rechecked under the lock. The shared server clock
read after lock waits establishes the boundary:

- CONFIRMED with start > now: CANCELLED, version incremented.
- CONFIRMED with start <= now < end: completely unchanged.
- CONFIRMED with end <= now, and terminal statuses: completely unchanged.
- Every NEEDS_RESCHEDULING appointment, past or future: CANCELLED, version incremented.

Visit reasons and appointment IDs remain. Reservation release checks for other
active reservations and updates only isBooked, never isBlocked. Notices resolve,
unsent jobs stop, obsolete inbox/deep links detach, and contact/rescheduling history
remains. No new rescheduling history is fabricated by closure. The user ID and all
appointment/history relations remain; name becomes Closed patient, email becomes
a unique address under account.invalid, phone/specialization are cleared, and
password becomes an unusable sentinel. The old email can register a distinct new
user ID, without restoring or attaching old records.

Patient row locking rechecks closedAt for booking (including staff booking), moves,
review/cancellation, appointment deletion and contact recording. Profile updates
use a conditional closedAt:null write so an already-authenticated request cannot
restore contact details. Blocking is serialized by doctor locks and excludes closed
patients from new disruptions. Administrative patient hard deletion is rejected;
doctor deletion also cannot erase closed-patient appointments. History remains
readable through existing authorized staff routes; this does not expand roles.

## Authentication

User.authVersion starts at 1; JWTs carry that version. Every authenticated request
checks account existence, current role, closedAt and matching authVersion. Closure
increments the version; login rejects closed accounts. Previously issued tokens
without a version intentionally require a new sign-in. There are no refresh tokens
or server session rows. Revocation does not retract data already returned by an
in-flight request; mutations independently check closed state under their locks.

## Email and retention limits

The worker checks closedAt during final preparation as well as live disruption
identity. Closure fences tokens/leases for all remaining processing jobs and stops
retries. For prepared work, sendingAt is retained with
ACCOUNT_CLOSED_DELIVERY_UNCERTAIN and SKIPPED status: this means further work was
suppressed, **not proof that delivery did not occur**. An already prepared message
can race with closure outside the database; external acceptance or delivery cannot
reliably be recalled. Stale completion/renewal cannot change the fenced job.

Remaining appointment reasons, linked patient IDs, rescheduling doctor/time/actor
snapshots, notification doctor/time/reference snapshots, staff contact notes,
contact outcomes and actor references may still identify the patient. Jobs retain
delivery timestamps, attempts, sanitized error categories and provider message IDs.
Detachment is not anonymization. Captured/sent email, logs and backups are separate
copies and are not erased by this flow. Access remains restricted, but retention
duration and a full erasure/anonymization process remain unfinished policy work.

## Disposable verification

- backend/test/run-account-closure-integration.sh: new migration preservation,
  PostgreSQL schema diff, HTTP permissions/password/confirmation, rollback at final
  write, time boundaries after a lock wait, history/block preservation, no-write
  replay, old-token rejection, isolated re-registration, ordered races with booking,
  move, blocking and contact logging, claimed-email suppression and synthetic SMTP
  acceptance illustrating the in-flight limit.
- frontend/test/account-closure.live.cjs through run-rescheduling-live.sh: actual
  sign-in, confirmation/cancellation/errors, delayed-response duplicate protection,
  cross-tab logout and lost-response recovery (including reload).

No Supabase access or deployment is part of these scripts. Mailpit only accepts
synthetic example.test/example.invalid recipients. Deployment of the pending
migration must precede use of the updated backend in the normal environment.

## Account-closure review fixes and fresh evidence

Two review defects were reproduced before the fixes:

1. DELETE /doctors/:doctorId bypassed the closed-patient check in DELETE /users/:userId.
   An ended legacy/manual visit without move history was deleted with HTTP 200.
2. A delayed successful closure response for A cleared a newly signed-in B session
   in both tabs because its continuation unconditionally logged out and redirected.

Deletion now uses the shared assertAppointmentDeletionAllowed policy in both
account/doctor services and direct appointment deletion, inside their transactions
after acquiring the relevant doctor locks. Closure holds those same doctor locks.
User deletion uses Read Committed so the closedAt check sees closure committed while
waiting, rather than retaining a pre-wait Serializable snapshot. Other history,
disruption and patient-hard-deletion restrictions remain enforced.

Browser sign-in assigns a new client session UUID, including when the same account
receives an identical JWT within the same second. This is UI context fencing, not
a replacement for server authentication. Closure receipt recovery requires the
originating session ID. Context changes reset form, password/payload refs, pending
and recovery state. Each async continuation checks its mount/context generation and
current stored account, JWT and session ID before any logout, redirect, error or
pending-state effects. Unmount invalidates the generation. Normal successful closure
still clears shared authentication and broadcasts logout to the original account's
tabs. Receipt IDs are not passwords; no password is persisted.

Fresh verification for these fixes (separate from earlier implementation reports):

- Disposable PostgreSQL/Mailpit closure suite: every doctor/user/patient/appointment/
  calendar deletion route returns 409 for the closed patient's ended manual visit,
  with complete before/after snapshots unchanged. Both doctor deletion routes also
  reject after real PostgreSQL lock waits behind concurrent closure. The remaining
  closure/password/token/boundary/rollback/re-registration/worker scenarios pass.
- Live isolated browser suite: deliberately delayed A success, 401 and network
  outcomes do not alter B's authentication in either tab, redirect B, or restore
  obsolete recovery state. Same-account new-session receipt isolation and unmount
  fencing pass. Normal confirmation, duplicate protection, cross-tab logout and
  lost-response recovery (including reload) pass.
- Fresh existing booking, rescheduling, blocking, schedule, appointment-read,
  recommendation, notification/email and follow-up PostgreSQL regressions; 55
  backend tests; backend/frontend type checks; frontend production build; schema
  diff in the closure database and git diff checks.

All write tests use disposable PostgreSQL and synthetic Mailpit. No Supabase access,
real emails or deployment is part of this evidence. Retention and external-email
limitations above are unchanged; these checks do not prove every possible process
or browser interleaving.

The [appointment lifecycle](appointment-lifecycle.md) now allows authorized staff outcomes for retained closed-patient visits, records closure status audits atomically, and protects all appointments/status audit actors from deletion. These rules supersede earlier appointment-deletion behavior described above.
