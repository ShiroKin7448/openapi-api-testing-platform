import { OpenAPIImportService } from '../services/openapi-import.service';
import { OpenAPINormalizerService } from '../services/openapi-normalizer.service';
import { AppError } from '../utils/AppError';
import SwaggerParser from '@readme/openapi-parser';

jest.mock('@readme/openapi-parser');

describe('OpenAPI Import and Normalizer', () => {
  let importService: OpenAPIImportService;
  let normalizerService: OpenAPINormalizerService;

  beforeEach(() => {
    importService = new OpenAPIImportService();
    normalizerService = new OpenAPINormalizerService();
    jest.clearAllMocks();
  });

  describe('OpenAPIImportService', () => {
    it('should throw AppError if SwaggerParser fails with a generic error', async () => {
      const mockDereference = jest.fn().mockRejectedValue(new Error('Syntax Error'));
      (SwaggerParser as unknown as jest.Mock).mockImplementation(() => ({
        dereference: mockDereference,
      }));

      await expect(importService.importAndValidate({ openapi: '3.0.0' })).rejects.toThrow(AppError);
      await expect(importService.importAndValidate({ openapi: '3.0.0' })).rejects.toThrow('OpenAPI parsing error: Syntax Error');
    });

    it('should catch SSRF attempts when parsing external refs fails', async () => {
      // Typically, SwaggerParser throws "Error downloading <url>" when it fails to fetch
      // But because we set { resolve: { external: false } }, if it tries to resolve, it might throw a specific error,
      // or we handle the custom message catching "Error downloading".
      const mockDereference = jest.fn().mockRejectedValue(new Error('Error downloading http://malicious.com'));
      (SwaggerParser as unknown as jest.Mock).mockImplementation(() => ({
        dereference: mockDereference,
      }));

      await expect(importService.importAndValidate({ openapi: '3.0.0' })).rejects.toThrow(
        'External references are disabled for security reasons.'
      );
    });

    it('should return dereferenced api if successful', async () => {
      const mockApi = { info: { title: 'Test API' } };
      const mockDereference = jest.fn().mockResolvedValue(mockApi);
      (SwaggerParser as unknown as jest.Mock).mockImplementation(() => ({
        dereference: mockDereference,
      }));

      const result = await importService.importAndValidate({ openapi: '3.0.0' });
      expect(result).toEqual(mockApi);
      
      // Ensure it was called with SSRF protections
      expect(mockDereference).toHaveBeenCalledWith(
        { openapi: '3.0.0' },
        expect.objectContaining({
          resolve: { http: false, external: false },
          dereference: { circular: false }
        })
      );
    });
  });

  describe('OpenAPINormalizerService', () => {
    it('should normalize a fully dereferenced OpenAPI document correctly', () => {
      const rawApi = {
        info: { title: 'Test API', version: '2.0.0', description: 'desc' },
        paths: {
          '/users': {
            parameters: [
              { name: 'workspaceId', in: 'header', required: true, schema: { type: 'string' } }
            ],
            post: {
              operationId: 'createUser',
              parameters: [
                { name: 'role', in: 'query', required: false, schema: { type: 'string' } }
              ],
              requestBody: {
                required: true,
                content: {
                  'application/json': { schema: { type: 'object' } }
                }
              },
              responses: {
                '201': {
                  description: 'Created',
                  headers: {
                    'X-RateLimit': { schema: { type: 'integer' } }
                  },
                  content: {
                    'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } },
                    'application/xml': { schema: { type: 'object' } } // testing multiple media types
                  }
                }
              }
            }
          }
        }
      };

      const normalized = normalizerService.normalize(rawApi);

      expect(normalized.info.title).toBe('Test API');
      expect(normalized.endpoints.length).toBe(1);

      const endpoint = normalized.endpoints[0];
      expect(endpoint.path).toBe('/users');
      expect(endpoint.method).toBe('post');
      expect(endpoint.operationId).toBe('createUser');

      // Parameters merged (path level + operation level)
      expect(endpoint.parameters.length).toBe(2);
      expect(endpoint.parameters[0].name).toBe('workspaceId');
      expect(endpoint.parameters[1].name).toBe('role');

      // Request Body
      expect(endpoint.requestBody?.required).toBe(true);
      expect(endpoint.requestBody?.content['application/json'].schema.type).toBe('object');

      // Responses
      expect(endpoint.responses.length).toBe(1);
      expect(endpoint.responses[0].statusCode).toBe('201');
      expect(endpoint.responses[0].headers?.['X-RateLimit'].schema.type).toBe('integer');
      
      // Multiple Media Types
      expect(endpoint.responses[0].content?.['application/json'].schema.properties?.id.type).toBe('string');
      expect(endpoint.responses[0].content?.['application/xml'].schema.type).toBe('object');
    });

    it('should handle documents with missing optional fields gracefully', () => {
      const rawApi = {
        info: { title: 'Minimal API', version: '1.0.0' },
        paths: {
          '/health': {
            get: {
              responses: {
                '200': { description: 'OK' }
              }
            }
          }
        }
      };

      const normalized = normalizerService.normalize(rawApi);
      expect(normalized.endpoints[0].method).toBe('get');
      expect(normalized.endpoints[0].requestBody).toBeUndefined();
      expect(normalized.endpoints[0].responses[0].content).toBeUndefined();
      expect(normalized.endpoints[0].responses[0].headers).toBeUndefined();
    });
  });
});
