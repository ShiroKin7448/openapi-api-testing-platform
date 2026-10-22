import { NormalizedOpenAPIDocument, DependencyGraph, DependencyEdge } from '@shared/types';

function extractResource(path: string): string {
  const segments = path.split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startsWith('{')) {
      if (i > 0) return segments[i - 1].toLowerCase().replace(/s$/, '');
    }
  }
  const last = segments[segments.length - 1];
  return last ? last.toLowerCase().replace(/s$/, '') : '';
}

export class DependencyAnalyzerService {
  /**
   * Builds a Dependency Graph from a normalized OpenAPI document.
   */
  public analyze(document: NormalizedOpenAPIDocument): DependencyGraph {
    const nodes: string[] = [];
    const edges: DependencyEdge[] = [];
    const edgeKeySet = new Set<string>();

    // Map to quickly find endpoints that produce specific properties in their response
    // producers[propName] = [fromId1, fromId2, ...]
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
                // If this endpoint itself already requires 'prop' as a parameter, it cannot be the original producer of 'prop'
                const alreadyConsumes = endpoint.parameters?.some(p => p.name.toLowerCase() === prop.toLowerCase() && (p.required || p.in === 'path'));
                if (alreadyConsumes) return;

                if (!producers[prop]) producers[prop] = [];
                if (!producers[prop].includes(id)) {
                  producers[prop].push(id);
                }
              });
            }
          }
        });
      }
    });

    document.endpoints.forEach(endpoint => {
      const toId = endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`;
      const toResource = extractResource(endpoint.path);

      // Look at parameters for this endpoint to see what it "consumes"
      if (endpoint.parameters) {
        endpoint.parameters.forEach(param => {
          // Consider required parameters or any path parameter
          if (!param.required && param.in !== 'path') return;

          const paramName = param.name;
          const candidateProps = new Set<string>([paramName]);

          // Heuristic 1: If param ends with 'Id' or '_id' (e.g. userId, orderId, user_id), it can come from property 'id'
          const m = paramName.match(/^([a-zA-Z0-9]+?)(?:Id|_id)$/i);
          if (m) {
            candidateProps.add('id');
            candidateProps.add(`${m[1].toLowerCase()}Id`);
            candidateProps.add(`${m[1].toLowerCase()}_id`);
          }

          // Heuristic 2: If param is simply 'id', it can come from 'userId' or 'id' on parent resource
          if (paramName.toLowerCase() === 'id' && toResource) {
            candidateProps.add('id');
            candidateProps.add(`${toResource}Id`);
            candidateProps.add(`${toResource}_id`);
          }

          // Match producers
          for (const prop of candidateProps) {
            const matchingProducers = producers[prop] ?? [];
            for (const fromId of matchingProducers) {
              if (fromId === toId) continue; // Prevent self-dependency

              const fromResource = extractResource(fromId.replace(/^[A-Z]+\s+/, ''));
              // If resource matches (e.g. POST /users and GET /users/{userId}), it's high confidence
              const isResourceMatch = Boolean(toResource && fromResource && (toResource === fromResource || fromId.toLowerCase().includes(toResource)));
              const isExactName = prop === paramName;
              const confidence = isExactName || isResourceMatch ? 'HIGH' : 'MEDIUM';
              const sourceLabel = isExactName 
                ? `Parameter match: ${paramName}` 
                : `Resource heuristic: ${prop} -> ${paramName}`;

              const key = `${fromId}->${toId}:${paramName}`;
              if (!edgeKeySet.has(key)) {
                edgeKeySet.add(key);
                edges.push({
                  from: fromId,
                  to: toId,
                  source: sourceLabel,
                  confidence
                });
              }
            }
          }
        });
      }
    });

    return { nodes, edges };
  }
}
