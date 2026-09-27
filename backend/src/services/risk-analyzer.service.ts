import { NormalizedEndpoint } from '@shared/types';

export class RiskAnalyzerService {
  /**
   * Calculates a heuristic risk score (0-100) for a given endpoint.
   */
  public analyzeRisk(endpoint: NormalizedEndpoint, requiresAuth: boolean): number {
    let score = 0;

    // 1. Method Heuristics
    const method = endpoint.method.toLowerCase();
    if (method === 'post' || method === 'put' || method === 'patch') {
      score += 20;
    } else if (method === 'delete') {
      score += 40;
    } // GET adds 0

    // 2. Auth Heuristics
    if (!requiresAuth) {
      score += 30; // Unauthenticated endpoints are inherently riskier for testing
    } else {
      score += 10;
    }

    // 3. PII / Sensitive Data Heuristics (Check requests and responses)
    const sensitiveKeywords = ['email', 'password', 'ssn', 'credit_card', 'card', 'token', 'secret'];
    let hasPII = false;
    let maxDepth = 0;

    // Check parameters
    if (endpoint.parameters) {
      endpoint.parameters.forEach(p => {
        if (sensitiveKeywords.some(kw => p.name.toLowerCase().includes(kw))) {
          hasPII = true;
        }
      });
    }

    // Check request body
    if (endpoint.requestBody && endpoint.requestBody.content['application/json']) {
      const schema = endpoint.requestBody.content['application/json'].schema;
      this.analyzeSchemaDepthAndPII(schema, 1, sensitiveKeywords, (foundPii, depth) => {
        if (foundPii) hasPII = true;
        if (depth > maxDepth) maxDepth = depth;
      });
    }

    // Check responses
    if (endpoint.responses) {
      endpoint.responses.forEach(resp => {
        if (resp.content && resp.content['application/json']) {
          const schema = resp.content['application/json'].schema;
          this.analyzeSchemaDepthAndPII(schema, 1, sensitiveKeywords, (foundPii, depth) => {
            if (foundPii) hasPII = true;
            if (depth > maxDepth) maxDepth = depth;
          });
        }
      });
    }

    if (hasPII) {
      score += 30;
    }

    // 4. Depth Heuristics (Complex schemas increase testing surface area)
    if (maxDepth > 3) {
      score += 10;
    }

    return Math.min(score, 100);
  }

  private analyzeSchemaDepthAndPII(
    schema: unknown,
    currentDepth: number, 
    keywords: string[], 
    callback: (foundPii: boolean, depth: number) => void
  ) {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return;
    const schemaRecord = schema as Record<string, unknown>;

    callback(false, currentDepth);

    if (schemaRecord.properties && typeof schemaRecord.properties === 'object' && !Array.isArray(schemaRecord.properties)) {
      const properties = schemaRecord.properties as Record<string, unknown>;
      Object.keys(properties).forEach(key => {
        if (keywords.some(kw => key.toLowerCase().includes(kw))) {
          callback(true, currentDepth);
        }
        this.analyzeSchemaDepthAndPII(properties[key], currentDepth + 1, keywords, callback);
      });
    } else if (schemaRecord.items) {
      this.analyzeSchemaDepthAndPII(schemaRecord.items, currentDepth + 1, keywords, callback);
    }
  }
}
