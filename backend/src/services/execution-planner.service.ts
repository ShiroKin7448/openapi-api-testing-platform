import { DependencyGraph, ExecutionPlan, CyclicComponent } from '@shared/types';

export class ExecutionPlannerService {
  /**
   * Generates an ExecutionPlan using a modified Kahn's algorithm that detects cycles explicitly.
   */
  public planExecution(graph: DependencyGraph): ExecutionPlan {
    const inDegree: Record<string, number> = {};
    const adjList: Record<string, string[]> = {};
    const nodes = graph.nodes;

    // Initialize
    nodes.forEach(node => {
      inDegree[node] = 0;
      adjList[node] = [];
    });

    graph.edges.forEach(edge => {
      // Avoid counting multiple identical edges between same nodes
      if (!adjList[edge.from].includes(edge.to)) {
        adjList[edge.from].push(edge.to);
        inDegree[edge.to]++;
      }
    });

    let queue: string[] = [];
    nodes.forEach(node => {
      if (inDegree[node] === 0) {
        queue.push(node);
      }
    });

    const levels: string[][] = [];
    let visitedCount = 0;

    // Process levels
    while (queue.length > 0) {
      const currentLevel = [...queue];
      levels.push(currentLevel);
      queue = [];

      currentLevel.forEach(node => {
        visitedCount++;
        adjList[node].forEach(neighbor => {
          inDegree[neighbor]--;
          if (inDegree[neighbor] === 0) {
            queue.push(neighbor);
          }
        });
      });
    }

    const cyclicComponents: CyclicComponent[] = [];

    // If we didn't visit all nodes, there is a cycle
    if (visitedCount < nodes.length) {
      const cycleNodes = nodes.filter(node => inDegree[node] > 0);
      cyclicComponents.push({ nodes: cycleNodes });
    }

    return {
      levels,
      cyclicComponents
    };
  }
}
