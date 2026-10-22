// Shared Types and Interfaces

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [keyword: string]: unknown;
}

export enum WorkspaceRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  TESTER = 'TESTER',
  DEVELOPER = 'DEVELOPER',
  VIEWER = 'VIEWER'
}

export enum MemberStatus {
  ACTIVE = 'ACTIVE',
  INVITED = 'INVITED'
}

export enum TestRunStatus {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum TestResultStatus {
  PENDING = 'PENDING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  ERROR = 'ERROR'
}

export enum TestCaseStatus {
  DRAFT = 'DRAFT',
  READY = 'READY',
  DISABLED = 'DISABLED',
  ARCHIVED = 'ARCHIVED'
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  // passwordHash is omitted for security
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  status: MemberStatus;
  invitedEmail?: string | null;
  invitedAt?: Date | string | null;
  joinedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  user?: { id: string; name: string; email: string };
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface OpenAPISpec {
  id: string;
  projectId: string;
  version: string;
  content: JsonValue; // JSON representation of the spec
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface Endpoint {
  id: string;
  specId: string;
  path: string;
  method: string;
  operationId?: string | null;
  riskScore?: number | null;
  blockedByCycle: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// Graph and Execution Planner Types

export interface DependencyEdge {
  from: string; // operationId or path+method
  to: string; // operationId or path+method
  source: string; // reason for dependency
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface DependencyGraph {
  nodes: string[]; // Endpoint identifiers
  edges: DependencyEdge[];
}

export interface CyclicComponent {
  nodes: string[]; // Endpoints involved in the cycle
}

export interface ExecutionPlan {
  levels: string[][]; // Array of arrays of endpoint identifiers
  cyclicComponents: CyclicComponent[];
}

export interface TestExecutionJob {
  id: string;
  testRunId: string;
  testCaseId: string;
  endpointId: string;
  levelIndex: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  payload: unknown; // The fully resolved payload
  pathParams?: unknown;
  queryParams?: unknown;
  headers?: Record<string, unknown>;
  contextNodeId?: string;
}

// Data Generation & Mutation Types

export interface ContextBinding {
  _type: 'CONTEXT_BINDING';
  sourceNodeId: string;
  sourcePath: string; // e.g. 'body.id', 'headers.authorization'
  fallbackValue?: unknown;
}

export type GeneratedValue = JsonPrimitive | ContextBinding | GeneratedValue[] | { [key: string]: GeneratedValue };

export enum MutationType {
  BOUNDARY = 'BOUNDARY',
  TYPE_MISMATCH = 'TYPE_MISMATCH',
  NULL_VIOLATION = 'NULL_VIOLATION',
  MISSING_REQUIRED = 'MISSING_REQUIRED',
  FORMAT_VIOLATION = 'FORMAT_VIOLATION',
  ENUM_VIOLATION = 'ENUM_VIOLATION'
}

export interface Mutation {
  type: MutationType;
  targetPath: string;
  originalValue: unknown;
  mutatedValue: unknown;
  expectedFailure: string; // e.g. '400 Bad Request'
}

export interface RunMetrics {
  endpointCoverage: number; // percentage
  positiveTestCount: number;
  negativeTestCount: number;
  contractValidationCoverage: number; // percentage of successful contract validates
}

export interface EndpointRegression {
  endpointId: string;
  sampleCount: number;
  historicalMedian: number;
  currentMedian: number;
  historicalP95: number;
  currentP95: number;
  deltaPercent: number;
  regressionFlag: boolean;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  variables: JsonValue; // Key-value pairs
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface TestCase {
  id: string;
  endpointId: string;
  name: string;
  description?: string | null;
  requestBody?: JsonValue | null;
  queryParams?: JsonValue | null;
  pathParams?: JsonValue | null;
  headers?: JsonValue | null;
  expectedResponse?: JsonValue | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface TestRun {
  id: string;
  projectId: string;
  environmentId: string;
  status: TestRunStatus;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface TestRunProgress {
  runId: string;
  status: TestRunStatus;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  percentage: number;
  currentLevel: number;
  updatedAt: string;
}

export type TestRunEventName = 'run.started' | 'job.waiting' | 'job.active' | 'job.progress' | 'job.completed' | 'job.failed' | 'run.completed' | 'run.failed';

export interface TestRunEvent {
  sequence: string;
  runId: string;
  name: TestRunEventName;
  jobId?: string;
  levelIndex?: number;
  percentage?: number;
  progress?: TestRunProgress;
  message?: string;
  createdAt: string;
}

export interface TestResult {
  id: string;
  testRunId: string;
  testCaseId: string;
  status: TestResultStatus;
  actualResponse?: JsonValue | null;
  executionTimeMs?: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// Custom types for API responses and requests
export interface AuthResponse {
  token: string;
  user: User;
}

export interface ErrorResponse {
  status: string;
  message: string;
}

// Normalized OpenAPI Interfaces

export interface NormalizedOpenAPIDocument {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  endpoints: NormalizedEndpoint[];
}

export interface NormalizedEndpoint {
  path: string;
  method: string;
  operationId?: string;
  parameters: NormalizedParameter[];
  requestBody?: NormalizedRequestBody;
  responses: NormalizedResponse[];
}

export interface NormalizedParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required: boolean;
  schema: JsonSchema; // JSON Schema representation
}

export interface NormalizedRequestBody {
  required: boolean;
  content: {
    [mediaType: string]: {
      schema: JsonSchema;
    };
  };
}

export interface NormalizedResponse {
  statusCode: string;
  description?: string;
  headers?: {
    [headerName: string]: {
      schema: JsonSchema;
      required?: boolean;
    };
  };
  content?: {
    [mediaType: string]: {
      schema: JsonSchema;
    };
  };
}

export * from './api';
