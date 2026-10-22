import SwaggerParser from '@readme/openapi-parser';
// @ts-ignore
import { load as parseYaml } from 'js-yaml';
import type { OpenAPI } from 'openapi-types';
import { AppError } from '../utils/AppError';

export class OpenAPIImportService {
  /**
   * Parse and validate an OpenAPI document (JSON or YAML string, or object).
   * Enforces strict limits on external reference resolution to mitigate SSRF risks.
   *
   * @param document The raw OpenAPI document or string.
   * @returns The fully dereferenced OpenAPI document.
   */
  async importAndValidate(document: string | object): Promise<unknown> {
    try {
      const parser = new SwaggerParser();
      let parsedDocument: unknown = document;
      if (typeof document === 'string') {
        parsedDocument = parseYaml(document);
      }
      if (parsedDocument === null || typeof parsedDocument !== 'object') {
        throw new AppError('The OpenAPI document must be an object', 400);
      }
      
      // Strict SSRF mitigation: disable HTTP/HTTPS and external file resolution
      const api = await parser.dereference(parsedDocument as OpenAPI.Document, {
        resolve: {
          http: false,
          external: false,
        },
        dereference: {
          circular: false, // Prevents infinite loops in circular references
        }
      });
      
      return api;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Error downloading')) {
         throw new AppError('External references are disabled for security reasons.', 400);
      }
      throw new AppError(`OpenAPI parsing error: ${message}`, 400);
    }
  }
}
