import {
  NormalizedOpenAPIDocument,
  NormalizedEndpoint,
  NormalizedParameter,
  NormalizedRequestBody,
  NormalizedResponse,
  JsonSchema,
} from '@shared/types';
import { AppError } from '../utils/AppError';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function recordList(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((record): record is UnknownRecord => record !== undefined) : [];
}

function schemaRecord(value: unknown): JsonSchema {
  return asRecord(value) as JsonSchema | undefined ?? {};
}

function isParameterLocation(value: unknown): value is NormalizedParameter['in'] {
  return value === 'query' || value === 'header' || value === 'path' || value === 'cookie';
}

export class OpenAPINormalizerService {
  /** Normalize a dereferenced OpenAPI 3.0.x or 3.1.x document. */
  normalize(api: unknown): NormalizedOpenAPIDocument {
    const document = asRecord(api);
    if (!document) throw new AppError('Invalid OpenAPI document for normalization', 400);

    const info = asRecord(document.info);
    const title = typeof info?.title === 'string' ? info.title : 'Untitled API';
    const version = typeof info?.version === 'string' ? info.version : '1.0.0';
    const description = typeof info?.description === 'string' ? info.description : undefined;
    const endpoints: NormalizedEndpoint[] = [];
    const paths = asRecord(document.paths);

    if (paths) {
      for (const [path, pathValue] of Object.entries(paths)) {
        const pathItem = asRecord(pathValue);
        if (!pathItem) continue;
        const pathParams = recordList(pathItem.parameters);
        const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
        for (const method of methods) {
          const operation = asRecord(pathItem[method]);
          if (operation) endpoints.push(this.normalizeEndpoint(path, method, operation, pathParams));
        }
      }
    }

    return { info: { title, version, description }, endpoints };
  }

  private normalizeEndpoint(
    path: string,
    method: string,
    operation: UnknownRecord,
    pathParams: UnknownRecord[],
  ): NormalizedEndpoint {
    const allParams = [...pathParams, ...recordList(operation.parameters)];
    const parameters = allParams.map((parameter) => this.normalizeParameter(parameter));

    let requestBody: NormalizedRequestBody | undefined;
    const requestBodyValue = asRecord(operation.requestBody);
    if (requestBodyValue && asRecord(requestBodyValue.content)) {
      requestBody = this.normalizeRequestBody(requestBodyValue);
    }

    const responses: NormalizedResponse[] = [];
    const responseMap = asRecord(operation.responses);
    if (responseMap) {
      for (const [statusCode, responseValue] of Object.entries(responseMap)) {
        const response = asRecord(responseValue);
        if (response) responses.push(this.normalizeResponse(statusCode, response));
      }
    }

    return {
      path,
      method,
      operationId: typeof operation.operationId === 'string' ? operation.operationId : undefined,
      parameters,
      requestBody,
      responses,
    };
  }

  private normalizeParameter(parameter: UnknownRecord): NormalizedParameter {
    return {
      name: typeof parameter.name === 'string' ? parameter.name : '',
      in: isParameterLocation(parameter.in) ? parameter.in : 'query',
      required: parameter.required === true,
      schema: schemaRecord(parameter.schema ?? (typeof parameter.type === 'string' ? { type: parameter.type } : undefined)),
    };
  }

  private normalizeRequestBody(requestBody: UnknownRecord): NormalizedRequestBody {
    const content: NormalizedRequestBody['content'] = {};
    const rawContent = asRecord(requestBody.content);
    if (rawContent) {
      for (const [mediaType, mediaValue] of Object.entries(rawContent)) {
        const media = asRecord(mediaValue);
        if (media && Object.prototype.hasOwnProperty.call(media, 'schema')) {
          content[mediaType] = { schema: schemaRecord(media.schema) };
        }
      }
    }
    return { required: requestBody.required === true, content };
  }

  private normalizeResponse(statusCode: string, response: UnknownRecord): NormalizedResponse {
    let headers: NonNullable<NormalizedResponse['headers']> | undefined;
    const rawHeaders = asRecord(response.headers);
    if (rawHeaders) {
      headers = {};
      for (const [headerName, headerValue] of Object.entries(rawHeaders)) {
        const header = asRecord(headerValue);
        if (!header) continue;
        headers[headerName] = {
          schema: schemaRecord(header.schema ?? (typeof header.type === 'string' ? { type: header.type } : undefined)),
          ...(typeof header.required === 'boolean' ? { required: header.required } : {}),
        };
      }
    }

    let content: NonNullable<NormalizedResponse['content']> | undefined;
    const rawContent = asRecord(response.content);
    if (rawContent) {
      content = {};
      for (const [mediaType, mediaValue] of Object.entries(rawContent)) {
        const media = asRecord(mediaValue);
        if (media && Object.prototype.hasOwnProperty.call(media, 'schema')) {
          content[mediaType] = { schema: schemaRecord(media.schema) };
        }
      }
    }

    return {
      statusCode,
      description: typeof response.description === 'string' ? response.description : undefined,
      headers,
      content,
    };
  }
}
