# Isolated PostgreSQL tests

`run.py` runs the same migrations, RPC, RLS, worker-state and concurrency scenarios
against PostgreSQL 17. It never connects to a configured application database.

With Docker installed:

```sh
python3 supabase/tests/run.py
```

Without Docker, install or extract PostgreSQL 17 binaries in a local directory,
then point the harness at the directory containing `postgres`, `initdb`, `pg_ctl`,
`createdb` and `psql` (the matching `lib` and `share` directories must remain
available). Windows portable binaries are published by
[EDB](https://www.enterprisedb.com/download-postgresql-binaries), linked from the
[PostgreSQL Windows downloads page](https://www.postgresql.org/download/windows/).
Verify the archive against the publisher's `.sha256` file before extraction.

```powershell
$env:INTERLINK_PG_BIN = 'C:\tools\postgresql-17\pgsql\bin'
$env:PYTHONUTF8 = '1'
python supabase\tests\run.py
```

The native runner checks the PostgreSQL major version and creates a new cluster
under `artifacts/native-postgres/run-*`. It uses a random password, SCRAM
authentication and a free loopback port. It does not register a Windows service,
change PATH, use remote connection variables or reuse existing databases. It
stops the cluster and deletes only that invocation's directory on completion or
failure; if shutdown fails, it preserves the directory and reports its path.

These tests include real concurrent PostgreSQL sessions. The bootstrap provides
minimal local Auth/Storage schema fixtures and test JWT claims. Passing results
do **not** prove Supabase Auth, PostgREST, live Realtime sockets, remote Storage,
Expo push delivery or physical-device behavior. Follow `docs/INTEGRATION_TEST_PLAN.md`
for checks requiring the later connected environment.

Edge checks require Deno 2.5.6 and run separately:

```sh
cd supabase/functions
deno check --frozen push-worker/index.ts deletion-worker/index.ts image-upload/index.ts
deno lint
deno fmt --check
deno test --frozen _shared/*.test.ts
```

Deno installation and version checks are described in the
[official installation guide](https://docs.deno.com/runtime/getting_started/installation/).
