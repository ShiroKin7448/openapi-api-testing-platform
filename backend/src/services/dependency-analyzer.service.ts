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
    // Each node's own resource, keyed by node id — computed once from its real path, since the node id
    // itself may be an operationId (e.g. "createUser") that extractResource cannot parse as a path.
    const nodeResource: Record<string, string> = {};

    document.endpoints.forEach(endpoint => {
      const id = endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`;
      nodes.push(id);
      const ownResource = extractResource(endpoint.path);
      nodeResource[id] = ownResource;

      // Identifier aliases this endpoint already "consumes" as a reference to an EXISTING resource
      // (a required/path parameter named 'id', '<resource>Id', or '<resource>_id'), expanded to the
      // full alias set for that same resource. An endpoint that reads/updates/deletes a resource by id
      // is never the original producer of that id — even though it typically echoes the id back in its
      // own response — so it must be excluded from `producers` the same way for all of its aliases, or
      // endpoints like GET/PATCH/DELETE /users/{id} end up pointing at each other in a cycle.
      const consumedIdentifierAliases = new Set<string>();
      endpoint.parameters?.forEach((p) => {
        if (!(p.required || p.in === 'path')) return;
        const name = p.name.toLowerCase();
        if (name === 'id' || name === `${ownResource}id` || name === `${ownResource}_id`) {
          consumedIdentifierAliases.add('id');
          consumedIdentifierAliases.add(`${ownResource}id`);
          consumedIdentifierAliases.add(`${ownResource}_id`);
        } else {
          consumedIdentifierAliases.add(name);
        }
      });

      // Analyze responses to see what properties this endpoint "produces"
      if (endpoint.responses) {
        endpoint.responses.forEach(resp => {
          if (resp.content && resp.content['application/json']) {
            const schema = resp.content['application/json'].schema;
            if (schema?.properties) {
              Object.keys(schema.properties).forEach(prop => {
                if (consumedIdentifierAliases.has(prop.toLowerCase())) return;

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

      const addEdge = (fromId: string, prop: string, fieldName: string, confidence: 'HIGH' | 'MEDIUM', sourceLabel: string) => {
        if (fromId === toId) return; // Prevent self-dependency
        const key = `${fromId}->${toId}:${fieldName}`;
        if (edgeKeySet.has(key)) return;
        edgeKeySet.add(key);
        edges.push({ from: fromId, to: toId, source: sourceLabel, confidence });
      };

      const matchField = (fieldName: string) => {
        // Exact name match (e.g. consumer needs 'userId', producer's schema literally has 'userId'):
        // the field name is already resource-qualified by its own spelling, so this is safe without
        // further filtering and is always HIGH confidence. A bare 'id' is NOT resource-qualified
        // (many resources have a generic 'id'), so it is deliberately excluded here and handled by
        // the resource-scoped heuristic below instead.
        if (fieldName.toLowerCase() !== 'id') {
          for (const fromId of producers[fieldName] ?? []) {
            addEdge(fromId, fieldName, fieldName, 'HIGH', `Parameter match: ${fieldName}`);
          }
        }

        // Heuristic matches below are ambiguous (many resources can have a generic "id" field), so they
        // are only accepted when the producer's own resource matches the resource implied by the field —
        // otherwise an unrelated endpoint that happens to also return an "id" would be wrongly linked in.
        const m = fieldName.match(/^([a-zA-Z0-9]+?)(?:Id|_id)$/i);
        if (m) {
          // e.g. fieldName 'userId' -> only accept a bare 'id' producer whose own resource is 'user'
          const impliedResource = m[1].toLowerCase();
          for (const fromId of producers.id ?? []) {
            const fromResource = nodeResource[fromId];
            if (fromResource !== impliedResource) continue;
            addEdge(fromId, 'id', fieldName, 'MEDIUM', `Resource heuristic: id -> ${fieldName}`);
          }
        }

        if (fieldName.toLowerCase() === 'id' && toResource) {
          // e.g. fieldName 'id' on /orders/{id} -> only accept producers from the SAME resource ('order'),
          // via a bare 'id', an 'orderId', or an 'order_id' property on their response.
          for (const candidateName of ['id', `${toResource}Id`, `${toResource}_id`]) {
            for (const fromId of producers[candidateName] ?? []) {
              const fromResource = nodeResource[fromId];
              if (fromResource !== toResource) continue;
              const isExact = candidateName === 'id';
              addEdge(fromId, candidateName, fieldName, isExact ? 'HIGH' : 'MEDIUM', isExact ? 'Parameter match: id' : `Resource heuristic: ${candidateName} -> id`);
            }
          }
        }
      };

      // Look at parameters (path/query/header) for this endpoint to see what it "consumes"
      if (endpoint.parameters) {
        endpoint.parameters.forEach(param => {
          // Consider required parameters or any path parameter
          if (!param.required && param.in !== 'path') return;
          matchField(param.name);
        });
      }

      // Also look at required top-level request body fields that look like foreign keys (e.g. { userId,
      // productId } in a POST body) — most REST APIs pass foreign keys in the body rather than as
      // path/query parameters. Other body fields (email, name, price, ...) are fresh input data, not
      // values fetched from another endpoint, so they are deliberately NOT matched here.
      const bodySchema = endpoint.requestBody?.content?.['application/json']?.schema;
      const bodyProperties = bodySchema?.properties;
      const requiredBodyFields = Array.isArray(bodySchema?.required) ? bodySchema.required : [];
      if (bodyProperties) {
        requiredBodyFields.forEach(fieldName => {
          if (typeof fieldName !== 'string' || !bodyProperties[fieldName]) return;
          const looksLikeForeignKey = fieldName.toLowerCase() === 'id' || /^[a-zA-Z0-9]+?(?:Id|_id)$/i.test(fieldName);
          if (looksLikeForeignKey) matchField(fieldName);
        });
      }
    });

    return { nodes, edges };
  }
}
