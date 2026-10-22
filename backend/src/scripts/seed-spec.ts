import prisma from '../utils/prisma';
import { TestCaseService } from '../services/test-case.service';
import { DependencyAnalyzerService } from '../services/dependency-analyzer.service';
import { NormalizedOpenAPIDocument } from '@shared/types';

async function main() {
  const projectId = '3ddea7f7-3905-44eb-ba7c-2e3efce8ca8c';
  
  // 1. Delete all old specs except the newest one
  const specs = await prisma.openAPISpec.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Found ${specs.length} specs for project.`);

  if (specs.length === 0) {
    console.log('No specs found.');
    return;
  }

  const latestSpec = specs[0];
  if (specs.length > 1) {
    const oldSpecIds = specs.slice(1).map((s) => s.id);
    console.log('Deleting older specs:', oldSpecIds);
    await prisma.openAPISpec.deleteMany({
      where: { id: { in: oldSpecIds } },
    });
  }

  // 2. Fetch latest spec with endpoints
  const spec = await prisma.openAPISpec.findUnique({
    where: { id: latestSpec.id },
    include: { endpoints: true },
  });
  if (!spec) return;

  const normDoc = spec.normalizedContent as unknown as NormalizedOpenAPIDocument;
  const depAnalyzer = new DependencyAnalyzerService();
  const graph = depAnalyzer.analyze(normDoc);
  const testCaseService = new TestCaseService();

  console.log(`Generating test cases for ${spec.endpoints.length} endpoints...`);
  let totalCases = 0;
  for (const ep of spec.endpoints) {
    const norm = normDoc.endpoints.find(
      (e) => e.path === ep.path && e.method.toLowerCase() === ep.method.toLowerCase()
    );
    if (norm) {
      const nodeId = norm.operationId || `${norm.method.toUpperCase()} ${norm.path}`;
      const incomingEdges = graph.edges.filter((e) => e.to === nodeId);
      const generated = await testCaseService.generateForEndpoint(ep.id, norm, incomingEdges);
      totalCases += generated.length;
      console.log(`Endpoint ${nodeId}: generated ${generated.length} test cases.`);
    }
  }

  console.log(`SUCCESS: Total ${totalCases} test cases generated for spec ${spec.id}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
