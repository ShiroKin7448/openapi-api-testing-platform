import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { NormalizedResponse } from '@shared/types';
import type { AnySchema } from 'ajv';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class ContractValidatorService {
  private ajv: Ajv;

  constructor() {
    // strict: false ignores unknown keywords (like vendor extensions x-something)
    this.ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(this.ajv);
  }

  /**
   * Validates an actual HTTP response against the OpenAPI response definitions.
   * 
   * @param actualStatus The numeric HTTP status code
   * @param actualHeaders The response headers object
   * @param actualBody The response JSON payload
   * @param expectedResponses The array of OpenAPI NormalizedResponse definitions for this endpoint
   */
  public validateResponse(
    actualStatus: number,
    actualHeaders: Record<string, string>,
    actualBody: unknown,
    expectedResponses: NormalizedResponse[]
  ): ValidationResult {
    const errors: string[] = [];

    // 1. Status Code Matching
    const statusStr = actualStatus.toString();
    let expectedDef = expectedResponses.find(r => r.statusCode === statusStr);
    
    // Fallback to 'default' if the exact code isn't defined
    if (!expectedDef) {
      expectedDef = expectedResponses.find(r => r.statusCode === 'default');
    }

    if (!expectedDef) {
      return {
        isValid: false,
        errors: [`Received status code ${actualStatus}, but it is not defined in the OpenAPI spec and no 'default' exists.`]
      };
    }

    // 2. Header Validation (Case Insensitive)
    if (expectedDef.headers) {
      const normalizedActualHeaders = this.normalizeHeaders(actualHeaders);
      
      for (const [headerName, headerSchema] of Object.entries(expectedDef.headers)) {
        const lowerName = headerName.toLowerCase();
        const headerValue = normalizedActualHeaders[lowerName];

        if (headerValue === undefined) {
          if (headerSchema.required !== false) {
            errors.push(`Missing required header: ${headerName}`);
          }
        } else {
          // Validate header schema if present
          if (headerSchema.schema) {
            const validate = this.ajv.compile(headerSchema.schema as AnySchema);
            // HTTP headers are strings. If schema expects integer, we might need coercion, but let's assume basic check.
            const valid = validate(headerValue);
            if (!valid) {
              errors.push(`Header ${headerName} invalid: ${this.ajv.errorsText(validate.errors)}`);
            }
          }
        }
      }
    }

    // 3. Body Validation & Content-Type Normalization
    if (expectedDef.content) {
      const rawContentType = actualHeaders['content-type'] || 'application/json';
      // Normalize e.g., 'application/json; charset=utf-8' -> 'application/json'
      const contentType = rawContentType.split(';')[0].trim();

      const contentDef = expectedDef.content[contentType];

      if (!contentDef) {
        errors.push(`Content-Type ${contentType} is not defined for status ${statusStr}`);
      } else if (contentDef.schema) {
        const validate = this.ajv.compile(contentDef.schema as AnySchema);
        const valid = validate(actualBody);

        if (!valid) {
          errors.push(`Response body invalid: ${this.ajv.errorsText(validate.errors)}`);
        }
      }
    } else {
      // If expectedDef.content is empty/missing, but we received a body, that might be an error,
      // but strictly speaking OpenAPI allows returning bodies even if not defined, though usually it's bad practice.
      // We will skip strict failure here to avoid false positives unless explicitly required.
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private normalizeHeaders(headers: Record<string, string>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }
}
