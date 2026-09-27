import {
  AuthResponse,
  DependencyEdge,
  Endpoint,
  EndpointRegression,
  Environment,
  NormalizedEndpoint,
  OpenAPISpec,
  Project,
  RunMetrics,
  TestCase,
  TestResult,
  TestRun,
  User,
  Workspace,
} from './index';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateWorkspaceRequest { name: string; }
export interface CreateProjectRequest { name: string; description?: string | null; }
export interface UpdateProjectRequest { name?: string; description?: string | null; }
export interface CreateEnvironmentRequest { name: string; variables?: JsonValue; }
export interface UpdateEnvironmentRequest { name?: string; variables?: JsonValue; }
export interface ImportSpecRequest { version: string; content: JsonValue | string; }
export interface GenerateTestCasesRequest {
  normalizedEndpoint: NormalizedEndpoint;
  incomingEdges?: DependencyEdge[];
}
export interface UpdateTestCaseRequest {
  name?: string;
  description?: string | null;
  requestBody?: JsonValue | null;
  queryParams?: JsonValue | null;
  pathParams?: JsonValue | null;
  headers?: JsonValue | null;
  expectedResponse?: JsonValue | null;
}
export interface CreateTestRunRequest { environmentId: string; specId?: string; }

export interface EndpointCatalogItem extends Pick<Endpoint, 'id' | 'specId' | 'path' | 'method' | 'operationId' | 'riskScore' | 'blockedByCycle' | 'createdAt' | 'updatedAt'> {
  tags: string[];
}

export interface ImportSpecResult {
  specId: string;
  version: string;
  endpointCount: number;
  endpoints: EndpointCatalogItem[];
}

export interface TestRunProgress {
  testRunId: string;
  status: TestRun['status'];
  total: number;
  completed: number;
  passed: number;
  failed: number;
  pending: number;
}

export interface ProjectAnalytics {
  runs: Array<{
    id: string;
    status: TestRun['status'];
    startTime: TestRun['startTime'];
    endTime: TestRun['endTime'];
    createdAt: TestRun['createdAt'];
    environment: string;
    totalResults: number;
    metrics: RunMetrics | null;
  }>;
}

export interface TestRunAnalytics {
  metrics: RunMetrics;
  regression: EndpointRegression[];
}

export interface ApiContractTypes {
  auth: { register: RegisterRequest; login: LoginRequest; me: User; authResult: AuthResponse };
  workspace: { create: CreateWorkspaceRequest; item: Workspace };
  project: { create: CreateProjectRequest; update: UpdateProjectRequest; item: Project };
  environment: { create: CreateEnvironmentRequest; update: UpdateEnvironmentRequest; item: Environment };
  specs: { import: ImportSpecRequest; importResult: ImportSpecResult; item: OpenAPISpec };
  testCases: { generate: GenerateTestCasesRequest; update: UpdateTestCaseRequest; item: TestCase };
  testRuns: { create: CreateTestRunRequest; item: TestRun; result: TestResult; progress: TestRunProgress };
  analytics: { project: ProjectAnalytics; run: TestRunAnalytics };
}
