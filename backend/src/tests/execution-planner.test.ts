import { ExecutionPlannerService } from '../services/execution-planner.service';
import { DependencyGraph } from '@shared/types';

describe('ExecutionPlannerService', () => {
  let planner: ExecutionPlannerService;

  beforeEach(() => {
    planner = new ExecutionPlannerService();
  });

  it('Case 1: Should correctly sort a simple chain A -> B -> C', () => {
    const graph: DependencyGraph = {
      nodes: ['A', 'B', 'C'],
      edges: [
        { from: 'A', to: 'B', source: 'test', confidence: 'HIGH' },
        { from: 'B', to: 'C', source: 'test', confidence: 'HIGH' }
      ]
    };

    const plan = planner.planExecution(graph);

    expect(plan.levels).toEqual([['A'], ['B'], ['C']]);
    expect(plan.cyclicComponents.length).toBe(0);
  });

  it('Case 2: Should correctly sort fan-in dependencies A -> C, B -> C', () => {
    const graph: DependencyGraph = {
      nodes: ['A', 'B', 'C'],
      edges: [
        { from: 'A', to: 'C', source: 'test', confidence: 'HIGH' },
        { from: 'B', to: 'C', source: 'test', confidence: 'HIGH' }
      ]
    };

    const plan = planner.planExecution(graph);

    // A and B have 0 in-degree, they run first. Then C runs.
    expect(plan.levels.length).toBe(2);
    expect(plan.levels[0]).toContain('A');
    expect(plan.levels[0]).toContain('B');
    expect(plan.levels[1]).toEqual(['C']);
    expect(plan.cyclicComponents.length).toBe(0);
  });

  it('Case 3: Should explicitly detect and report cycles (A -> B -> A) and NOT silently drop them', () => {
    const graph: DependencyGraph = {
      nodes: ['A', 'B', 'C'],
      edges: [
        { from: 'A', to: 'B', source: 'test', confidence: 'HIGH' },
        { from: 'B', to: 'A', source: 'test', confidence: 'HIGH' },
        // C is independent
      ]
    };

    const plan = planner.planExecution(graph);

    // C has 0 in-degree, so it will be executed.
    expect(plan.levels).toEqual([['C']]);
    
    // A and B form a cycle and should be isolated.
    expect(plan.cyclicComponents.length).toBe(1);
    expect(plan.cyclicComponents[0].nodes).toContain('A');
    expect(plan.cyclicComponents[0].nodes).toContain('B');
  });

  it('Should handle completely independent nodes correctly', () => {
    const graph: DependencyGraph = {
      nodes: ['A', 'B', 'C'],
      edges: []
    };

    const plan = planner.planExecution(graph);

    expect(plan.levels).toEqual([['A', 'B', 'C']]);
    expect(plan.cyclicComponents.length).toBe(0);
  });
});
