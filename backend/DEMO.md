# Demo walkthrough

## Full deterministic flow

The executable demo is `src/tests/system.e2e.test.ts`. It starts its own fixture target API and BullMQ worker and exercises:

1. Register, log in, and read `/auth/me`.
2. Create a workspace, owner membership, project, and environment.
3. Import `src/tests/fixtures/system-openapi.yaml` and list the normalized endpoints.
4. Generate test cases, edit one, and keep generated dependency values as context bindings.
5. Create asynchronous test runs and poll persisted progress.
6. Execute the sample API through BullMQ, validate response contracts, and persist test results.
7. Verify dependent IDs flow between execution levels, independent requests overlap, and failed dependencies stop dependent requests.
8. Compare run/project analytics with persisted result rows.

It also covers malformed OpenAPI, invalid environment, expired JWT, unauthorized workspace access, cycle failure, HTTP failures, contract violations, target timeout and unreachable target. No database rows need to be edited manually.

## Run the demo against isolated local services

Start PostgreSQL and Redis with Docker Compose from the repository root. Use a dedicated test database (example `autotest_e2e`) and a dedicated Redis DB number (example `/15`). From PowerShell in `backend/`:

```powershell
$env:E2E_DATABASE_URL = "postgresql://root:rootpassword@127.0.0.1:5432/autotest_e2e?schema=public"
$env:E2E_REDIS_URL = "redis://127.0.0.1:6379/15"
$env:DATABASE_URL = $env:E2E_DATABASE_URL
$env:REDIS_URL = $env:E2E_REDIS_URL
npx prisma migrate deploy
$env:RUN_SYSTEM_E2E = "1"
npm run test:e2e -- --forceExit
```

The suite will clear tables in `autotest_e2e` and the queue in Redis DB 15. Do not set these values to a normal development or production database.
`--forceExit` is currently required because Jest reports an open handle after the E2E assertions pass.

## Manual UI path

For a UI demo, configure the API/worker environment, apply migrations, start `npm run dev` and `npm run dev:worker` in `backend/`, then `npm run dev` in `frontend/`. Register in the UI, create a workspace/project, import the included system OpenAPI YAML, generate test cases, set an environment `BASE_URL`, and run a test. The sample API entrypoint is started separately with `npm run dev:sample-api`. Its loopback URL is only accepted by the worker in the isolated `NODE_ENV=test` E2E configuration; production SSRF protections reject local/private targets.

## Expected result

The dependency flow creates a resource and then reads it using the captured ID. A successful run reaches `COMPLETED`; failed expected status or contract validation makes the run fail, and failed prerequisite cases prevent dependent calls. The results page and analytics endpoints display persisted counts/timings. Secret environment variables remain masked in API responses.
