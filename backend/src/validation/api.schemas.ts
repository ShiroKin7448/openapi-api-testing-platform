import { z } from 'zod';

export const idSchema = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const email = z.string().trim().email().max(254);
const password = z.string().min(8).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'must not exceed bcrypt’s 72-byte input limit');
const jsonObject = z.record(z.string(), z.string());
export const noQueryParams = z.object({});

export const registerBody = z.object({ email, password, name }).strict();
export const loginBody = z.object({ email, password }).strict();
export const passwordResetRequestBody = z.object({ email }).strict();
export const emailVerificationRequestBody = z.object({ email }).strict();
export const emailVerificationBody = z.object({ email, code: z.string().regex(/^\d{6}$/) }).strict();
export const passwordResetBody = z.object({
  email,
  code: z.string().regex(/^\d{6}$/),
  newPassword: password,
}).strict();
export const passwordResetCodeBody = z.object({ email, code: z.string().regex(/^\d{6}$/) }).strict();
export const passwordResetCompletionBody = z.object({
  resetToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  newPassword: password,
}).strict();
export const workspaceParams = z.object({ workspaceId: idSchema });
export const workspaceBody = z.object({ name }).strict();
export const workspaceMemberBody = z.object({
  email: z.string().trim().email().max(254).optional(),
  userId: idSchema.optional(),
  role: z.enum(['OWNER', 'ADMIN', 'TESTER', 'DEVELOPER', 'VIEWER']),
}).strict().refine(
  (data) => data.email || data.userId,
  { message: 'Either email or userId is required' }
);
export const workspaceMemberUpdateBody = z.object({ role: z.enum(['OWNER', 'ADMIN', 'TESTER', 'DEVELOPER', 'VIEWER']) }).strict();
export const workspaceMemberParams = workspaceParams.extend({ memberId: idSchema });
export const workspaceMemberIdParams = workspaceParams.extend({ memberId: idSchema });
export const projectParams = z.object({ projectId: idSchema });
export const projectBody = z.object({ name, description: z.string().max(2000).nullable().optional() }).strict();
export const projectPatchBody = z.object({
  name: name.optional(),
  description: z.string().max(2000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const projectPathParams = z.object({ workspaceId: idSchema, projectId: idSchema });
export const environmentProjectParams = z.object({ projectId: idSchema });
export const environmentParams = z.object({ environmentId: idSchema });
export const environmentBody = z.object({ name, variables: jsonObject.default({}) }).strict();
export const environmentPatchBody = z.object({
  name: name.optional(),
  variables: jsonObject.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const endpointIdParams = z.object({ endpointId: idSchema });
export const testCaseIdParams = z.object({ testCaseId: idSchema });
export const testCasePatchBody = z.object({
  name: name.optional(),
  description: z.string().nullable().optional(),
  requestBody: z.unknown().optional(),
  queryParams: z.unknown().optional(),
  pathParams: z.unknown().optional(),
  headers: z.unknown().optional(),
  expectedResponse: z.unknown().optional(),
  payload: z.unknown().optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  enabled: z.boolean().optional(),
  status: z.enum(['DRAFT', 'READY', 'DISABLED', 'ARCHIVED']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const testCaseBulkStatusBody = z.object({
  ids: z.array(idSchema).min(1),
  status: z.enum(['DRAFT', 'READY', 'DISABLED', 'ARCHIVED']),
}).strict();
export const createTestRunBody = z.object({ environmentId: idSchema.optional().or(z.literal('')), testCaseIds: z.array(idSchema).min(1).optional() }).strict();
export const testRunParams = z.object({ testRunId: idSchema });
export const testRunResultsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'ERROR']).optional(),
  endpointId: idSchema.optional(),
  type: z.enum(['VALID', 'BOUNDARY', 'NEGATIVE']).optional(),
}).strict();
export const analyticsQuery = z.object({
  lastRuns: z.coerce.number().int().refine((value): value is 10 | 30 => value === 10 || value === 30).default(10),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, { message: 'from must be before or equal to to' });

export const scheduleIdParams = z.object({ scheduleId: idSchema });
export const createTestScheduleBody = z.object({
  environmentId: idSchema,
  testCaseIds: z.array(idSchema).optional(),
  interval: z.enum(['ONCE', 'DAILY', 'WEEKLY', 'CUSTOM']).optional(),
  cron: z.string().optional(),
  enabled: z.boolean().optional(),
}).strict();
export const updateTestScheduleBody = z.object({
  enabled: z.boolean().optional(),
  cron: z.string().optional(),
  interval: z.enum(['ONCE', 'DAILY', 'WEEKLY', 'CUSTOM']).optional(),
  testCaseIds: z.array(idSchema).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
