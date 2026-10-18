# Inter-Link backend

This directory is executable backend source for subsequent user-owned Supabase integration. It does not connect the app to a remote project. The demo uses a separate local data adapter and never invokes these functions.

## Reproduce the isolated database tests

```sh
python3 supabase/tests/run.py
```

Docker runs a disposable PostgreSQL 17 image pinned by digest. The runner applies all migrations and fictional fixtures, exercises authenticated/anonymous/service roles, and removes its container. `tests/bootstrap.sql` substitutes only the Supabase `auth.uid`, `auth.jwt`, role and Storage catalog interfaces. **Do not deploy that bootstrap file to Supabase.** SQL authorization and concurrent transactions are real PostgreSQL operations; the harness does not validate Auth provider email/session behavior, Storage HTTP behavior or realtime websocket authorization. All fixture emails use `example.invalid`; no email is sent.

When Docker is unavailable, the same suite supports a local PostgreSQL 17 binary directory through `INTERLINK_PG_BIN`. It creates a new password-protected, loopback-only disposable cluster and removes it after shutdown; it never uses an existing database. Windows setup and exact commands are in [tests/README.md](tests/README.md). This changes only the database launcher, preserving the same migrations, SQL assertions, roles and concurrent sessions.

For a complete local Supabase instance, install the official Supabase CLI and run `supabase start`, then `supabase db reset --local`. Seed application data only when desired: `config.toml` disables automatic seeds, and `seed.sql` requires the session setting `interlink.allow_test_seed = 'on'`. The SQL fixtures have no password identities and are not demo login accounts.

Edge Function checks (validated and pinned in CI to Deno 2.5.6):

```sh
cd supabase/functions
deno task check
deno task test
deno lint
deno fmt --check
```

The separate `.github/workflows/backend.yml` runs these backend checks on pushes
and pull requests without external service keys. Its database job uses Python
3.12.11 and the PostgreSQL image digest pinned in `tests/run.py`. Its Edge job
uses the strict lockfile variants below, followed by lint/format validation and
`git diff --exit-code -- deno.lock`:

```sh
cd supabase/functions
deno check --frozen push-worker/index.ts deletion-worker/index.ts image-upload/index.ts
deno test --frozen _shared/*.test.ts
```

The GitHub runner provides Docker; fixture image contents and the ImageScript
3.2.1 dependency are integrity-pinned. The workflow does not deploy migrations,
connect a hosted project, enable schedules, or send emails/push notifications.

## Database security and transactions

- Application tables live in the unexposed `interlink` schema, with RLS enabled and no `anon`/`authenticated` table or helper grants. PostgREST exposes `public.interlink_query(operation,payload)` and `public.interlink_command(operation,payload,idempotency_key)`. The latter takes an actor-scoped UUID key; the same intent replays the committed result, while changed intent with a reused key fails `CONFLICT`. Successful keys are retained for 30 days. Message `clientId` also has a permanent author-scoped unique constraint.
- Both dispatchers derive identity from `auth.uid()`. Mutation commands lock the actor account until commit and recheck status. Deletion takes its exclusive account lock before data cleanup. Candidate account locks precede project locks for approval and ownership transfer, preventing a deletion race from admitting or transferring ownership to a deleted account.
- Signup creates only a private account and non-discoverable profile. An approved, active community membership is required for project/people access. Hashed high-entropy invite codes are locked during redemption and enforce expiration and usage limits. `admin.invite` returns the new code in `response.id`; copy it at creation. It is never shown in audit logs.
- Capacity includes the owner. A project row lock serializes creation of memberships, and a trigger enforces the capacity constraint even for privileged SQL inserts. Approval/acceptance updates status, membership, chat entitlement, notifications and jobs in one transaction. Pending invitation/application crossover is rejected, expired invites do not reserve seats, and sending an invite alone never grants membership.
- Application and invitation status changes have private transactional metadata history: request ID, previous/next status, actor from authenticated claims and time. Triggers also cover implicit closure, blocking, admission and scheduled expiry; no-op/idempotent requests add no duplicate history. Existing rows receive an explicitly labeled observed baseline, never invented historical transitions. The history has no client grant, query or realtime publication and stores no introductions, messages or contact details. Account deletion erases related history and removes actor attribution from unrelated retained transitions. Maintenance applies a provisional 30-day cap; duration/legal basis must be reviewed before launch.
- Owners can transfer to an active approved member; owners must transfer or archive before leaving. Completed/archived teams retain authorized read access, but messages can only be sent in recruiting/active teams. Closing recruitment resolves pending requests and invites.
- `teams.history` returns a paginated record of the caller's actual memberships,
  including teams they left, so they can choose a project when recording an
  experience. Current approved community scope, hidden-project and block checks
  still apply. History includes only project metadata; descriptions, goals,
  member counts, unread counts and tag arrays are blanked. It grants no member
  list or chat access. All `Page` queries accept `cursor`/`limit`, including
  operational job/community lists, so older failed jobs remain reviewable.
- `bootstrap.messageUnreadCount` aggregates every accessible active membership,
  independently of the loaded team page. It uses the same `(createdAt,id)` read
  cursor and excludes self-authored, deleted, hidden and blocked-author messages;
  closed communities and revoked/hidden team access contribute no unread count.
- All discovery filters and cursor pagination execute in PostgreSQL with a maximum page size of 50. Default project discovery is recruiting, unexpired and not full. `recommended`, `newest`, and ascending `deadline` sorting are deterministic with an opaque cursor. Recommendation reasons name actual shared tags; no synthetic percentages are generated.
- Blocking removes discovery, new requests/invites and related notification delivery. In an existing shared team, membership remains, but blocked-authored message text is redacted and excluded from unread counts; blocking is not a removal from the team. The user can leave or report. A report can preserve only the reported content, never unrelated chat history.
- Every admin operation requires a row in `interlink.admin_roles` and the provider-issued JWT `aal2`. An admin is not automatically a chat member. Evidence reads are audited and limited to a specific report. The bootstrap does not grant admin to a first signup or an email address. A verified operator must explicitly grant a known Auth user an admin role through privileged database administration after enrollment and MFA setup.
- Server validation enforces lengths, enum values, JSON types, immutable actor ownership, safe profile links, state transitions, timestamps and relationship permissions. Stable domain errors are returned to the client; raw SQL exceptions are mapped to `UNAVAILABLE`. SQL rate buckets limit successful searches and writes, and the upload worker authorizes limited upload requests. Rejected transactions roll back their SQL bucket increments; production also needs provider/gateway request limits for failed requests and OTP attempts. Authentication email and verification limits are specified in `config.toml` and must be verified in the deployed provider.

## Realtime and Storage

Only the content-free `public.change_events` table is included in the realtime publication. The adapter subscribes to INSERTs for its own authenticated `user_id` and then refetches RPC data. Event rows contain scope, project ID and time, never a message body or private profile/account record. RLS always checks recipient identity and active account status. Own application/invitation/team/membership/notification/save invalidations remain readable when the user is not yet a member or visibility has just been revoked, so stale caches can be cleared; message invalidations and all content RPCs retain their current membership checks. Status triggers emit request changes even for project closure, blocking and scheduled expiry, independently of notification preferences. No `REPLICA IDENTITY FULL` is enabled for private messages. SQL tests verify row-policy revocation; testing an already-open websocket after revocation remains a real Supabase integration check.

The `avatars` bucket is private. Direct client upload, overwrite and delete have no policies. The authenticated `image-upload` function decodes and validates input and writes a new immutable JPEG path using its server credential. A Storage table trigger rechecks account status under a row lock and closes an upload/deletion race. Owners can read their objects; other users can read only the current published avatar of a discoverable profile in an approved common community. Unpublished and historical objects are not readable by peers. Signed URLs retain access until their short expiry even after a profile becomes private; use short lifetimes and clear cached URLs on invalidation. Storage HTTP and signed URL behavior need subsequent provider tests.

## Durable jobs and deletion

`interlink_worker_claim` uses `FOR UPDATE SKIP LOCKED` and a 120-second random lease. Claims increment the current phase's attempts; 8 unsuccessful attempts exhaust that phase to a visible failed state. `interlink_worker_ack` requires the current lease and schedules bounded retries. Push jobs are unique per notification and device. An accepted send starts a fresh receipt budget, including when the eighth send succeeds; pending receipt polls never reset it. A separate `send_attempts` counter limits all sends for the job to 8 even if a rejected receipt returns it to sending. An explicitly reviewed and audited operator retry resets the budgets. Accepted provider ticket IDs persist to `push_receipts`; receipt checks are scheduled for at least 15 minutes after sends. Device/account/block/preference/current project entitlement is checked at processing time. Receipt failures disable invalid devices. Push text is generic and carries only IDs; no private message body reaches a lock screen. External provider delivery is at least once: a process crash between HTTP delivery and ticket persistence can duplicate a push. The in-app notification is canonical and deduplicated.

Account deletion requires a provider authentication event in the JWT `amr` within the last 15 minutes, plus explicit `DELETE`/archive intent. Refreshing a token is not reauthentication. A stale session gets `UNAUTHENTICATED` and must complete another provider login. The request immediately marks the account deleting, hides discovery, archives owned teams, revokes active memberships, resolves pending participation, and disables devices. The durable worker deletes every avatar object in pages, checkpoints to Auth deletion, treats an already-absent Auth user as success, and finalizes database erasure. Finalize refuses completion while Auth or Storage rows remain. Failed phases preserve their checkpoint and are shown to admins for reviewed retry. Suspension/deletion still permits the narrow `device.unregister` command so logout can complete.

Finalization erases profile fields, experiences, saves, tokens, preferences, blocks, read cursors, invitation text, application text, report evidence and personal report/audit text related to the deleted content. Messages become empty deletion placeholders. Owned projects become archived placeholders. Non-identifying UUID tombstones, relational history, operational job status and audit action names remain for referential integrity. No legal retention exception is presumed; a retention/legal-basis review is required before a launch policy changes this default. The SQL harness simulates removal from the Auth catalog; real provider account/file cleanup and retry recovery remain integration tests.

## Subsequent deployment order

1. Create separate user-owned development/staging/production projects when explicitly authorized. Confirm backup, billing and recovery policies.
2. Apply only `migrations/*.sql` through the Supabase migration tool. Keep `interlink` out of exposed API schemas; do not grant clients direct tables. Check function ownership, grants and RLS using ordinary user sessions.
3. Configure email OTP templates (`{{ .Token }}`), verified mail transport, resend/verification limits, redirect allowlists and the app's final deep-link scheme. Email verification is not student/age verification. Auth signup does not grant community access. Grant approved community access through controlled invite codes.
4. Verify the private `avatars` bucket, migration-installed policies/guard, and the realtime publication. Confirm only content-free events are exposed, including an existing socket after removal/suspension.
5. Deploy `image-upload`, `push-worker` and `deletion-worker`. Keep their `verify_jwt=false` configuration only with the implemented manual verification: upload verifies with Auth, workers require a constant-time checked private worker secret. Set only server-side secrets; see `functions/README.md` for exact names.
6. Securely add the functions base URL and worker secret to Vault, then explicitly apply `schedules.sql`. It registers push every minute, deletion every two minutes, and maintenance hourly. This file has **not** been applied to any remote environment. Verify cron responses and the job queue; a cron HTTP request is not a successful delivery receipt.
7. Inject the public project URL/publishable key into mobile/web, set `supabase` mode explicitly, and use a separately held server key only where documented. Never include the service key/worker secret in mobile or browser variables.
8. Run real A/B/C Auth sessions, direct REST/RPC adversarial tests, capacity races, existing websocket revocation, Storage HTTP cross-user tests, upload decoding, real Expo receipt/invalid-token handling, recent reauthentication and partial account-deletion retries. Validate device foreground/background/deep links separately.
9. Complete policy/retention/support/age/safety review, real device builds and operating approval before a separately authorized public launch.

`config.toml` is a local default, not proof of hosted provider settings. `schedules.sql`, mail, Vault secrets, initial admin grant, provider push credentials, native push project IDs, final app identifiers and policies all require explicit follow-up configuration.
