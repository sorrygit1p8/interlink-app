# Inter-Link Edge Functions

These handlers are executable integration code. They have **not been deployed**,
scheduled, or connected to a remote Supabase/Expo account. Unit tests use
in-process repositories/providers; they do not establish database RLS, real
delivery, Storage permissions, or Auth deletion success.

## Runtime and local validation

Validated with Deno 2.5.6. `imagescript` 3.2.1 is a pinned, pure TypeScript
raster codec; its registry integrity is recorded in `deno.lock`. This avoids
native image binaries unsupported in Edge isolates. Published codec
documentation and installed type declarations were checked when implementing
decode, orientation, resize, and encode calls.

```sh
cd supabase/functions
deno task check
deno task test
```

On a corporate/proxied host whose CA is in the system trust store, use
`DENO_TLS_CA_STORE=system`. Keep TLS verification enabled. No test requires app
service credentials or network permissions.

For each handler, `supabase/config.toml` must set
`import_map = "./functions/deno.json"`. Gateway `verify_jwt = false` is
intentional: workers verify a distinct scheduler secret; image-upload verifies
the user's actual session against Supabase Auth. It does not mean anonymous
operations are authorized.

## Server-only configuration

| Variable                    | Usage                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Fixed backend origin; HTTPS except explicit local development hosts                    |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-only queue RPCs, sanitized Storage upload, Auth deletion                       |
| `SUPABASE_ANON_KEY`         | Auth session verification for image uploads; may be a supported publishable key        |
| `INTERLINK_WORKER_SECRET`   | Independent random secret of at least 32 characters; never put in app/public variables |
| `EXPO_ACCESS_TOKEN`         | Optional Expo push access token; configure when Expo enhanced push security is enabled |
| `EDGE_ALLOWED_ORIGINS`      | Exact comma-separated browser origins authorized for image upload, no wildcard         |

Do not print these values, embed them in client bundles, or commit them. Set
them securely through the deployment environment after the user authorizes
actual service connection.

## Push queue

Invoke `POST /functions/v1/push-worker` with `x-interlink-worker-secret` from
the trusted scheduler. The request body cannot select recipients, titles,
arbitrary URLs, or jobs. Configure a schedule every minute **after** deploying
the SQL and functions. Each invocation claims up to 8 due push jobs with four
concurrent processors and a database lease. The queue must reclaim expired
leases using `SKIP LOCKED`, reject stale lease acknowledgements, enforce
uniqueness per notification/device, and cap attempts at eight per phase.

One push job corresponds to one immutable device registration and server-created
notification. `interlink_push_target` checks the current account, token,
settings, blocks, and project access on every send/receipt phase. Token refresh
creates or reactivates the matching immutable token row; do not replace the
token on an existing device row that has outstanding receipt jobs.

An accepted Expo ticket is saved durably with phase `receipt`, due after 15
minutes. The same minute schedule handles due receipts; a separate public
receipt endpoint is unnecessary. An unavailable receipt is rescheduled, never
blindly resent. `DeviceNotRegistered` deactivates the device. Known permanent
provider errors fail the job. Transient/provider rate failures use exponential
backoff plus jitter. A failed receipt indicating a rejected delivery retries the
send phase. A successful send starts its receipt allowance once, even after the
eighth send attempt; pending receipt checks retain their incrementing count. The
separate database `send_attempts` budget still caps all sends at eight across
rejected-receipt/resend cycles. Failed jobs remain visible to operations for
diagnosis; an audited operator retry explicitly restarts their budgets.

Delivery is **at least once**. Expo does not support a transactional/idempotent
send shared with this database. A crash after Expo accepts a send but before the
ticket is persisted can produce a duplicate on lease recovery. `notificationId`
remains stable so the app can deduplicate its in-app notification list.
Exactly-once device presentation is not claimed.

Push text is a fixed generic notification with no message body, applicant
introduction, or identifying project text. Deep-link data contains IDs only; app
navigation must recheck access. A push accepted immediately before
logout/revocation cannot be recalled from Expo/the device; the server rechecks
before each new outbound operation.

## Account deletion

Invoke `POST /functions/v1/deletion-worker` with the same scheduler-secret
header every two minutes, matching `supabase/schedules.sql`. Only server-created
deletion jobs are claimable. The account.delete transaction first marks the
account deleting, prevents new access/uploads, deactivates tokens, and
archives/transfers owned teams according to the domain contract.

Each invocation claims at most four deletion jobs, one per processing lane, so
Storage batches fit within the 120-second database lease. The worker removes
private `avatars/<userId>/...` objects in batches using the Storage API,
starting at offset zero after each removal. It persists `phase=auth` only after
the prefix is empty. It then removes the Auth identity and calls transactional
`interlink_deletion_finalize` to scrub relational data and mark completion. Auth
404 is success when a prior attempt already removed the identity. The queue and
account tombstone must survive Auth deletion. If any service step fails, the
lease/backoff keeps work durable; a failure cannot be reported as deletion
completed.

Only flat files generated by image-upload are supported within the prefix.
Unexpected folders produce a visible failed job instead of following paths
outside the account. The initial files batch limit prevents one invocation
exceeding its lease. Repeated invocations finish remaining files. Re-test
Storage partial failures, Auth failure/recovery, concurrent upload rejection,
and SQL finalization after actual service deployment.

## Image upload

`POST /functions/v1/image-upload` accepts **raw binary bytes**, not JSON/base64
or multipart data:

- `Authorization: Bearer <user access token>`; the server calls `/auth/v1/user`
  and derives the owner from its response.
- `Content-Type: image/jpeg`, `image/png`, or `image/webp` must agree with the
  file signature.
- Maximum 5 MiB input, 4096 pixels per axis, 12 million pixels total. Stream
  limits apply even without Content-Length.
- PNG/JPEG/WebP containers and dimensions are checked before decode; animated
  PNG/WebP, SVG, HTML, malformed frames, and oversized headers are rejected.
- Decode applies orientation; output is resized to at most 1024 pixels on the
  longer axis and encoded as a fresh JPEG at quality 82.
- All JPEG APP/COM metadata segments are removed, including
  EXIF/GPS/XMP/ICC/comments. The original file is never stored.
- Path is server-generated `<verified-user-id>/<random-uuid>.jpeg` in the
  **private** `avatars` bucket. Overwrite is disabled.
- `interlink_upload_authorize` enforces account status and upload rate. A
  Storage objects trigger rejects inserts/updates for deleting or suspended
  accounts even through service-role requests, closing the authorization/upload
  race.

Success is HTTP 201 with
`{ "path": "...", "mimeType": "image/jpeg", "width": 1024, "height": 512 }`. The
app uses `profile.update` to reference the returned owned path. The app obtains
a short-lived signed URL through authenticated Storage APIs and RLS (60 seconds
recommended), or uses authenticated download; there is no public bucket URL.
Previous/unreferenced uploads remain private and are removed at account
deletion. Enforce quota/rate limits and add an operational orphan-expiry task
before opening uploads at scale.

A signed URL remains usable by anyone who has it until expiry; changing profile
visibility does not immediately revoke an issued URL. Keep the expiry short,
avoid persistent public caches, remove the object when revocation must be
immediate, and verify the operational revocation requirement before release.

## RPC wire contract

Every helper is granted to service_role only and checks that role internally.
Browser/mobile clients must never be able to claim jobs or call helper RPCs
directly.

| RPC                           | Input and result                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `interlink_worker_claim`      | `{kind,batch_size}`: kind is push (batch 8) or deletion (batch 4); returns `[{id,kind,leaseToken,attempts,phase,payload}]` |
| `interlink_worker_ack`        | `{job_id,lease_token,outcome,details}`; outcomes `done`, `retry`, `failed`, `receipt`, `auth`                              |
| `interlink_push_target`       | `{job_id,lease_token}` → null or `{token,notificationId,deviceId,projectId?}`                                              |
| `interlink_disable_device`    | `{device_id}` → result ignored                                                                                             |
| `interlink_deletion_finalize` | `{job_id,lease_token}` → result ignored                                                                                    |
| `interlink_upload_authorize`  | `{user_id}` → `{allowed:true}` or stable domain error                                                                      |

Push phases are `send` and `receipt`; deletion phases are `files` and `auth`. A
receipt acknowledgement persists `details.ticketId` into payload and
`details.delaySeconds` into the next due time. Retry preserves phase unless
details.phase explicitly says `send` (clear the old ticket). Auth
acknowledgement advances phase, releases the lease, and schedules the next
invocation. Stable safe codes, IDs, attempt counts and phase transitions can be
logged; tokens, private bodies, credentials and full provider responses must not
be logged.
