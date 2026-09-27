import { NormalizedOpenAPIDocument, DependencyGraph, DependencyEdge } from '@shared/types';

export class DependencyAnalyzerService {
  /**
   * Builds a Dependency Graph from a normalized OpenAPI document.
   */
  public analyze(document: NormalizedOpenAPIDocument): DependencyGraph {
    const nodes: string[] = [];
    const edges: DependencyEdge[] = [];

    // Map to quickly find endpoints that produce specific properties in their response
    const producers: Record<string, string[]> = {};

    document.endpoints.forEach(endpoint => {
      const id = endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`;
      nodes.push(id);

      // Analyze responses to see what properties this endpoint "produces"
      if (endpoint.responses) {
        endpoint.responses.forEach(resp => {
          if (resp.content && resp.content['application/json']) {
            const schema = resp.content['application/json'].schema;
            if (schema?.properties) {
              Object.keys(schema.properties).forEach(prop => {
                if (!producers[prop]) producers[prop] = [];
                producers[prop].push(id);
              });
            }
          }
        });
      }
    });

    document.endpoints.forEach(endpoint => {
      const toId = endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`;

      // Look at required parameters for this endpoint to see what it "consumes"
      if (endpoint.parameters) {
        endpoint.parameters.forEach(param => {
          if (param.required && producers[param.name]) {
            producers[param.name].forEach(fromId => {
              if (fromId !== toId) { // Prevent self-dependency via parameters
                edges.push({
                  from: fromId,
                  to: toId,
                  source: `Parameter match: ${param.name}`,
                  confidence: 'MEDIUM'
                });
              }
            });
          }
        });
      }
    });

    return { nodes, edges };
  }
}
