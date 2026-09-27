# Full-system E2E

The full-system suite uses a real PostgreSQL database, a dedicated Redis database, the real Express API, BullMQ, and the worker. It is opt-in so a normal `npm test` never clears application data or queues.

## Prerequisites

- PostgreSQL with a dedicated empty database, for example `autotest_e2e`.
- Redis with a dedicated database number, for example `/15`.
- The database account can apply the checked-in Prisma migrations.

From `backend/` in PowerShell, set the isolated service URLs and migrate the test database:

```powershell
$env:E2E_DATABASE_URL = "postgresql://USER:PASSWORD@127.0.0.1:5432/autotest_e2e?schema=public"
$env:E2E_REDIS_URL = "redis://127.0.0.1:6379/15"
$env:DATABASE_URL = $env:E2E_DATABASE_URL
npx prisma migrate deploy
```

Run the full system journey:

```powershell
$env:RUN_SYSTEM_E2E = "1"
npm run test:e2e -- --forceExit
```

The suite clears rows in the database named by `E2E_DATABASE_URL` and the BullMQ queue in the Redis database named by `E2E_REDIS_URL`. Keep both targets dedicated to testing. The suite starts and stops the sample API and BullMQ worker itself. A 300 ms worker timeout is used to make timeout coverage deterministic and quick.
Jest currently detects a remaining open handle after the test assertions pass, so this command uses `--forceExit` to end the test process; the teardown issue remains recorded as technical debt.

Run the fast fixture contract checks and existing backend tests with:

```powershell
npm test -- --runInBand
```

Run the worker in a separate process during manual testing with:

```powershell
npm run dev:worker
```

Run the deterministic target API independently with:

```powershell
npm run dev:sample-api
```

It listens at `http://127.0.0.1:8080` by default. `SAMPLE_API_PORT` changes the port. Endpoints include `POST /login`, user create/read/update/delete, validation and auth errors, server error, malformed JSON, contract violation, slow response, and two independent concurrent endpoints.

## Assertions covered

The opted-in journey registers and logs in; creates a workspace, owner membership, project and environment; imports the YAML fixture; lists endpoints; generates and edits test cases; creates and polls runs; validates persisted responses and metrics; and checks error responses, dependency order and propagation, dependent-job suppression after a failed prerequisite, concurrent independent endpoints, timeout and unreachable-target `ERROR` records, invalid environment, invalid OpenAPI, expired JWT, unauthorized project access, and dependency-cycle failure.

## Test matrix

| Area | Scenario | Expected assertion |
| --- | --- | --- |
| API journey | Register, login, `/me`, workspace, OWNER membership, project, OpenAPI import/catalog, test case generation/edit, environment, run, results, analytics | Correct HTTP success codes and database relationships; secrets masked in API and encrypted in PostgreSQL |
| Queue and execution | POST create user then GET user by generated ID | Run reaches `COMPLETED`; two execution levels; dependent request receives prior response ID |
| Concurrency | Two independent fixture endpoints in one level | Same execution level and sample API observes overlapping requests |
| Dependency failure | Force create-user expected status mismatch before GET | Run reaches `FAILED`; dependent endpoint has no TestResult |
| HTTP failures | 400 validation, 401 unauthorized, 500 server error | Failed TestResults; no false successful run |
| Contract failures | Wrong response schema and malformed JSON response | Failed TestResults with contract validation errors |
| Network failures | 300 ms timeout and unreachable loopback port | `ERROR` TestResults and failed runs |
| Planner and validation | Dependency cycle, environment from other project, malformed OpenAPI | Cycle is persisted as failed with reason; invalid environment and document rejected |
| Authorization | Outsider accesses project; expired JWT | 403 and 401 respectively |
| Metrics | Compare project/run analytics with persisted TestRun/TestResult rows | Counts agree with the database-backed results |
