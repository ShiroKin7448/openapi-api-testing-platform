# REST API reference

Base URL: `http://localhost:3000/api`. JSON routes use `Content-Type: application/json`. Protected routes require `Authorization: Bearer <JWT>`. All JSON success bodies use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "code": "...", "message": "..." } }`. Stack traces are not returned. A successful delete returns `204 No Content`.

Path IDs are UUIDs. Unknown body/query keys are rejected. Request validation errors use HTTP 400 and `VALIDATION_ERROR`; missing/invalid bearer tokens use 401, membership/role failures use 403, missing resources use 404, controlled service/infrastructure errors use their documented status/code, and unhandled failures return generic 500 `INTERNAL_ERROR`.

## Authentication

| Method / URL | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /auth/register` | No | `{ "email": "person@example.com", "password": "at-least-8-chars", "name": "Person" }` | 202; `{ email, message }`; creates an unverified account and sends a 6-digit OTP | 400 `VALIDATION_ERROR`; 409 `EMAIL_ALREADY_EXISTS`; 503 email configuration/delivery failure |
| `POST /auth/verification/request` | No | `{ "email": "person@example.com" }` | 202; generic response; sends/re-sends OTP for an unverified account | 400 `VALIDATION_ERROR`; 409 `EMAIL_ALREADY_VERIFIED`; 503 `EMAIL_NOT_CONFIGURED` / `EMAIL_DELIVERY_FAILED` |
| `POST /auth/verification/verify` | No | `{ "email": "person@example.com", "code": "123456" }` | 200; verifies the email; the account can now sign in | 400 `VALIDATION_ERROR` / `INVALID_OTP`; 500 persistence failure |
| `POST /auth/login` | No | `{ "email": "person@example.com", "password": "..." }` | 200; `{ token, user }` for verified accounts | 400 `VALIDATION_ERROR`; 401 `INVALID_CREDENTIALS`; 403 `EMAIL_NOT_VERIFIED`; 500 `AUTH_CONFIGURATION_ERROR` / generic 500 |
| `POST /auth/password-reset/request` | No | `{ "email": "person@example.com" }` | 202; generic message that does not reveal whether the account exists; configured SMTP sends a 6-digit OTP | 400 `VALIDATION_ERROR`; 503 `EMAIL_NOT_CONFIGURED` / `EMAIL_DELIVERY_FAILED` |
| `POST /auth/password-reset/verify-code` | No | `{ "email": "person@example.com", "code": "123456" }` | 200; `{ resetToken, expiresInSeconds }` after successful OTP verification | 400 `VALIDATION_ERROR` / `INVALID_OTP` |
| `POST /auth/password-reset/complete` | No | `{ "resetToken": "<one-time-token>", "newPassword": "new-password" }` | 200; password reset confirmation; token is single-use and expires after 10 minutes | 400 `VALIDATION_ERROR` / `INVALID_RESET_TOKEN` |
| `POST /auth/password-reset/verify` | No | `{ "email": "person@example.com", "code": "123456", "newPassword": "new-password" }` | 200; compatibility endpoint that verifies and resets in one call | 400 `VALIDATION_ERROR` / `INVALID_OTP`; 500 persistence failure |
| `GET /auth/me` | Bearer | No body/query | 200; authenticated user DTO, no password hash | 401 `UNAUTHENTICATED`; 404 `USER_NOT_FOUND` |

Passwords are 8–128 characters and at most 72 UTF-8 bytes for bcrypt. Email is validated and limited to 254 characters.
Registration and reset OTPs expire after 10 minutes, allow at most five verification attempts, have a 60-second resend cooldown, are stored as keyed hashes, and can be used once. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD` in `backend/.env`, then restart the backend. For Gmail, use `smtp.gmail.com`, port `465`, secure transport, and a Google App Password.

## Workspaces and members

| Method / URL | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /workspaces` | Bearer | `{ "name": "Team" }` | 201; workspace plus automatically-created OWNER membership | 400 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR` |
| `GET /workspaces` | Bearer | No body/query | 200; current user's workspace list | 401; 500 |
| `GET /workspaces/:workspaceId` | Bearer + membership | No body/query | 200; workspace | 400 invalid UUID; 403 `FORBIDDEN`; 404 `WORKSPACE_NOT_FOUND` |
| `PATCH /workspaces/:workspaceId` | OWNER | `{ "name": "Renamed" }` | 200; workspace | 400; 403; 404 |
| `DELETE /workspaces/:workspaceId` | OWNER | No body/query | 204 | 400; 403; 404 |
| `GET /workspaces/:workspaceId/members` | Workspace member | No body/query | 200; member list | 400; 403; 404 |
| `POST /workspaces/:workspaceId/members` | OWNER | `{ "userId": "<uuid>", "role": "ADMIN" }` | 201; member | 400; 403; 404 `USER_NOT_FOUND`; 409 duplicate membership |
| `DELETE /workspaces/:workspaceId/members/:userId` | OWNER | No body/query | 204 | 400; 403; 404 |

Roles enforced by the service layer: OWNER manages the workspace/members and can delete projects; ADMIN manages project/environment/run operations; MEMBER can read project data, manage permitted test cases and run tests. A route's exact service authorization remains authoritative.

## Projects

| Method / URL | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /workspaces/:workspaceId/projects` | Workspace member; service role check | `{ "name": "Orders", "description": "Optional" }` | 201; project | 400; 403; 404 `WORKSPACE_NOT_FOUND` |
| `GET /workspaces/:workspaceId/projects` | Workspace member | No body/query | 200; project list | 400; 403; 404 |
| `GET /projects/:projectId` | Project member | No body/query | 200; project | 400; 403; 404 `PROJECT_NOT_FOUND` |
| `PATCH /projects/:projectId` | Project member; service role check | `{ "name": "Orders v2" }` and/or `description` (at least one field) | 200; project | 400; 403; 404 |
| `DELETE /projects/:projectId` | OWNER | No body/query | 204 | 400; 403; 404 |

## Environments

`variables` is a string-to-string object. Supply public `BASE_URL` and optional credentials such as `API_TOKEN`. The API masks secret values on reads and writes; decrypted values are only used inside worker execution.

| Method / URL | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /projects/:projectId/environments` | Project member; service role check | `{ "name": "development", "variables": { "BASE_URL": "https://api.example.com", "API_TOKEN": "secret" } }` | 201; environment with secret values masked | 400; 403; 404 `PROJECT_NOT_FOUND` |
| `GET /projects/:projectId/environments` | Project member | No body/query | 200; environment list with masked variables | 400; 403; 404 |
| `PATCH /environments/:environmentId` | Project member; service role check | `{ "name": "staging" }` and/or `variables` | 200; masked environment | 400; 403; 404 `ENVIRONMENT_NOT_FOUND` |
| `DELETE /environments/:environmentId` | Project member; service role check | No body/query | 204 | 400; 403; 404 |

## OpenAPI specifications and endpoint catalog

Import accepts multipart field `file` with `.json`, `.yaml`, or `.yml` extension, up to 5 MiB. The API also accepts a raw JSON object or raw JSON/YAML text body where the content type is supported. Only OpenAPI 3.0.x and 3.1.x are accepted. External HTTP/file references are disabled.

| Method / URL | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /projects/:projectId/specs/import` | OWNER or ADMIN of project workspace | Multipart `file`, or raw OpenAPI body | 201 new / 200 duplicate; `{ specId, version, endpointCount, endpoints }` | 400 `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `INVALID_JSON`, `INVALID_YAML`, `UNSUPPORTED_OPENAPI_VERSION`, `INVALID_OPENAPI_DOCUMENT`, `NORMALIZATION_FAILED`; 403; 404 project; 500 `PERSISTENCE_FAILED` |
| `GET /projects/:projectId/specs` | Project member | No body/query | 200; spec summaries with count | 400; 403; 404 project |
| `GET /specs/:specId` | Project member | No body/query | 200; spec metadata (raw document omitted) | 400; 403; 404 `SPEC_NOT_FOUND` |
| `GET /specs/:specId/endpoints` | Project member | Optional query: `method`, `tag`, `minRiskScore`, `maxRiskScore`, `search` | 200; endpoint catalog; filters are combined | 400 invalid filter/range; 403; 404 |
| `DELETE /projects/:projectId/specs/:specId` | OWNER | No body/query | 204 | 400; 403; 404 |

Endpoint method filter accepts `get`, `post`, `put`, `patch`, `delete`, `options`, and `head`. `search` matches path and operationId case-insensitively.

## Test cases

| Method / URL | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /endpoints/:endpointId/test-cases` | Project member | No body/query | 200; endpoint's persisted test case DTOs | 400; 403; 404 `ENDPOINT_NOT_FOUND` |
| `POST /endpoints/:endpointId/test-cases/generate` | Project member | Empty JSON object or no content | 200; persisted VALID, BOUNDARY and NEGATIVE cases (existing cases are returned without automatic regeneration) | 400; 403; 404; 422 `NORMALIZED_ENDPOINT_NOT_FOUND` |
| `GET /projects/:projectId/test-cases` | Project member | No body/query | 200; project test cases | 400; 403; 404 |
| `GET /test-cases/:testCaseId` | Project member | No body/query | 200; test case DTO | 400; 403; 404 `TEST_CASE_NOT_FOUND` |
| `PATCH /test-cases/:testCaseId` | Project member | One or more of `{ "name": "...", "payload": {}, "expectedStatus": 200, "enabled": false }` | 200; updated DTO; negative mutation metadata remains on the record | 400; 403; 404 |
| `DELETE /test-cases/:testCaseId` | Project member | No body/query | 204 | 400; 403; 404 |

## Test runs and execution

| Method / URL | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /projects/:projectId/test-runs` | Project member (ADMIN/MEMBER/OWNER) | `{ "environmentId": "<uuid>", "testCaseIds": ["<uuid>"] }`; `testCaseIds` optional | 201 immediately; `{ runId, status: "RUNNING", totalTests }` | 400 invalid input/test cases; 401; 403; 404 project/environment; 422 `NO_ENABLED_TEST_CASES`, `EXECUTION_PLAN_CYCLE`, or invalid plan; 503 queue failure |
| `GET /projects/:projectId/test-runs` | Project member | No body/query | 200; project run list | 400; 403; 404 project |
| `GET /test-runs/:testRunId` | Project member | No body/query | 200; run summary including status, counts, times, current level and percentage | 400; 403; 404 `TEST_RUN_NOT_FOUND` |
| `GET /test-runs/:testRunId/results` | Project member | Query: `page` (default 1), `pageSize` (default 20, max 100), `status`, `endpointId`, `type` | 200; `{ results, page, pageSize }` | 400 invalid filter; 403; 404 |
| `GET /test-runs/:testRunId/progress` | Project member | No body/query | 200; `{ runId, status, total, completed, passed, failed, percentage, currentLevel, updatedAt }` | 400; 403; 404 |
| `GET /test-runs/:testRunId/events` | Project member | Optional `Last-Event-ID` header | 200 `text/event-stream`; persisted/replayed `run.started`, `job.waiting`, `job.active`, `job.progress`, `job.completed`, `job.failed`, `run.completed`, `run.failed`; keep-alive comments | 400; 403 before stream headers; 404 |

Run statuses are `CREATED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`. Progress polling remains available if an SSE connection is unavailable. Event payloads contain run/job progress metadata and no secrets.

## Analytics

| Method / URL | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /projects/:projectId/analytics` | Project member | Optional `lastRuns=10` or `30`, `from` and `to` ISO timestamps | 200; summary, coverage, median/p95/delta and regression values calculated from persisted run/result data | 400 invalid query/range; 403; 404 project |
| `GET /test-runs/:testRunId/analytics` | Project member | No body/query | 200; pass/fail, contract, endpoint/type coverage, response-time distribution, regression and failed-result summaries | 400; 403; 404 `TEST_RUN_NOT_FOUND` |

## Example error

```json
{
  "success": false,
  "error": { "code": "UNAUTHENTICATED", "message": "Invalid or expired token" }
}
```
