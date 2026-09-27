# Automated API Testing Tool

An API test management application that imports OpenAPI 3.0.x/3.1.x documents, builds endpoint catalogs and generated cases, runs tests through BullMQ workers, validates responses against contracts, and presents database-backed analytics.

## Architecture

```text
React UI ── REST / SSE ── Express routes + middleware ── controllers
                                                        │
                                                        ▼
                                                existing services
                                                  │           │
                                            Prisma/Postgres  Redis/BullMQ
                                                               │
                                                               ▼
                                                        execution worker
                                                               │
                                                               ▼
                                                          target API
```

The browser uses Axios and TanStack Query for server state; Zustand stores session and selection/UI state. Controllers validate the request through shared Zod middleware, call services, and return the common `{ success, data }` or `{ success: false, error }` envelope. Project access is checked against workspace membership. Workers enforce outbound URL and DNS restrictions before contacting the target. Test results and run events are persisted so polling and SSE can recover after restarts.

## Technology stack

- Frontend: React 18, TypeScript, Vite, TanStack Query, Zustand, Axios, Tailwind CSS and Recharts.
- Backend: Node.js 18+, TypeScript strict mode, Express, Zod, Prisma and PostgreSQL.
- Asynchronous execution: Redis and BullMQ, with separate API and worker processes.
- OpenAPI: JSON/YAML parsing, safe local `$ref` dereferencing, normalization and AJV response validation.

## Project structure

```text
backend/src/routes       Express route groups
backend/src/controllers  Request-to-service adapters
backend/src/services     Authentication, catalog, generation, execution, metrics
backend/src/middlewares  JWT, validation, upload, correlation and error handling
backend/prisma           Schema and migrations
backend/src/tests        Unit, API, fixture API and opt-in full-system E2E tests
frontend/src/api         Axios APIs and TanStack Query configuration
frontend/src/pages       Application pages
shared/types             Shared domain and API contract types
```

## Installation

Prerequisites: Node.js 18+, npm, Docker Desktop / Docker Compose.

Clone the repository, then run these commands from its root:

```powershell
git clone https://github.com/ShiroKin7448/openapi-api-testing-platform.git
cd openapi-api-testing-platform
npm ci
docker compose up -d postgres redis
Copy-Item backend/.env.example backend/.env
```

The compose file provides local PostgreSQL on `5432` and Redis on `6379`. Its default database credentials are for local development only; replace them for any shared deployment.

## Environment variables

Copy `backend/.env.example` to `backend/.env`, then set unique secrets. `JWT_SECRET` must contain at least 32 characters. `ENCRYPTION_KEY` must be a Base64 encoding of exactly 32 random bytes; generate one with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection used by Prisma |
| `REDIS_URL` | Redis connection used by BullMQ, progress events and context storage |
| `JWT_SECRET` | HS256 signing secret, minimum 32 characters |
| `ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256-GCM key for environment secrets |
| `PORT` | Express API port; defaults to `3000` |
| `WORKER_CONCURRENCY` | Maximum worker concurrency; defaults to `5` |
| `WORKER_REQUEST_TIMEOUT_MS` | Per-target HTTP timeout; defaults to `5000` |
| `QUEUE_OPERATION_TIMEOUT_MS` | Redis queue operation timeout |
| `SMTP_HOST` | Email server hostname; Gmail uses `smtp.gmail.com` |
| `SMTP_PORT` | Email server port; Gmail SSL uses `465` |
| `SMTP_SECURE` | Set `true` for Gmail SSL on port 465 |
| `SMTP_USER` | Gmail account used to send registration and password reset codes |
| `SMTP_PASSWORD` | Gmail App Password; never use the normal Gmail password |
| `SMTP_FROM` | Optional sender display name/address; defaults to `SMTP_USER` |
| `SAMPLE_API_PORT` | Optional port for the deterministic fixture API; defaults to `8080` |

Password reset OTP is emailed to the address entered by the user. It expires after 10 minutes, allows five verification attempts, and can be resent after 60 seconds. Gmail sending requires 2-Step Verification and a Google App Password. Keep the App Password only in `backend/.env`; do not commit it or share it in chat.

The opt-in E2E suite additionally requires isolated `E2E_DATABASE_URL` and `E2E_REDIS_URL` values and `RUN_SYSTEM_E2E=1`. The suite deletes rows in that dedicated database and clears its queue. Never point those variables at a development or production database.

## Database migration

From `backend/`:

```powershell
npm run prisma:generate
npx prisma migrate deploy
```

For a local schema change, use `npm run prisma:migrate` to create/apply a development migration. The checked-in migrations are in `backend/prisma/migrations`.

## Start the backend

In one terminal, from `backend/`:

```powershell
npm run dev
```

The API listens on `http://localhost:3000`; `GET /health` is a process health check.

## Start the worker

In another terminal, from `backend/`:

```powershell
npm run dev:worker
```

The worker must stay running for queued test runs to execute. The API and worker use the same PostgreSQL, Redis and encryption configuration.

## Start the frontend

In another terminal, from `frontend/`:

```powershell
npm run dev
```

Vite serves the UI at `http://localhost:3001` and proxies `/api` to the backend at port `3000`.

## Build, lint and test commands

From the repository root:

```powershell
npm run build --workspace backend
npm run build --workspace frontend
npm run lint --workspace frontend
npm test --workspace backend -- --runInBand
```

The backend Jest suite includes unit and mocked API/integration tests. Its one full-system E2E test is skipped by default. See [backend/src/tests/SYSTEM_E2E.md](backend/src/tests/SYSTEM_E2E.md) for the isolated PostgreSQL/Redis setup and command to run that test. Frontend currently has TypeScript/build and lint scripts but no separate frontend unit-test script.

The frontend production build currently emits a Vite warning because its main JavaScript chunk exceeds 500 kB minified; the build succeeds.

## Deterministic demo

The complete no-manual-database-edit demo is the opt-in full-system E2E journey. It starts the sample target API and worker, then creates its user/workspace/project/environment, imports [system-openapi.yaml](backend/src/tests/fixtures/system-openapi.yaml), generates and edits cases, runs jobs, persists contract-checked results and compares analytics. Follow the isolated service setup in [SYSTEM_E2E.md](backend/src/tests/SYSTEM_E2E.md); the suite deliberately refuses to start without dedicated service URLs.

The target fixture can also be started separately with `npm run dev:sample-api` from `backend/`. It serves deterministic CRUD, dependency, validation, auth, error, malformed-body, contract-violation, timeout and concurrency routes at `http://127.0.0.1:8080`. Worker loopback access is enabled only in the dedicated E2E configuration.

For API request bodies, responses, authorization and error codes, see [backend/API.md](backend/API.md). A concise manual import/run checklist is in [backend/DEMO.md](backend/DEMO.md).

## Known limitations and technical debt

- The frontend persists the bearer token in browser local storage; a same-origin script injection could read it.
- Login and registration rate limiting and a restrictive production CORS/security-header policy are not configured in this application.
- Large analytics/run pages may benefit from further pagination and chart bundle splitting. The current frontend chunk warning is noted above.
- Jest reports an open-handle warning after the opt-in PostgreSQL/Redis E2E run; queue/Redis teardown requires further investigation.
- Environment secret writes are encrypted and reads masked. Existing rows created before that policy may require a reviewed migration.

These notes describe observed limitations; this README makes no claim that the system is bug-free or production-ready.
