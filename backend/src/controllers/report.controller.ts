import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { ApiTokenRequest } from '../middlewares/requireApiToken';
import { accessibleRun } from './test-run.controller';
import { compareReports, loadRunReport, RunReport, toHtmlReport, toJUnitXml, toPostmanCollection } from '../services/run-report.service';
import { requireProjectAccess } from '../utils/projectAccess';
import { AppError } from '../utils/AppError';
import prisma from '../utils/prisma';

type ExportFormat = 'junit' | 'html' | 'postman' | 'json';

function fileStem(report: RunReport): string {
  const slug = report.project.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
  return `${slug}-run-${report.run.id.slice(0, 8)}`;
}

export function sendExport(res: Response, report: RunReport, format: ExportFormat, inline = false): void {
  const stem = fileStem(report);
  const disposition = (name: string) => `${inline ? 'inline' : 'attachment'}; filename="${name}"`;
  if (format === 'junit') {
    res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': disposition(`${stem}-junit.xml`) }).send(toJUnitXml(report));
  } else if (format === 'html') {
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': disposition(`${stem}-report.html`) }).send(toHtmlReport(report));
  } else if (format === 'postman') {
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': disposition(`${stem}.postman_collection.json`) }).send(JSON.stringify(toPostmanCollection(report), null, 2));
  } else {
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': disposition(`${stem}.json`) }).send(JSON.stringify(report, null, 2));
  }
}

export const exportRun = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    await accessibleRun(req.user.id, req.params.testRunId);
    const { format, inline } = req.query as unknown as { format: ExportFormat; inline?: string };
    sendExport(res, await loadRunReport(req.params.testRunId), format, inline === 'true');
  } catch (error) { next(error); }
};

export const compareRuns = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401, true, 'UNAUTHORIZED');
    const { projectId } = req.params;
    await requireProjectAccess(req.user.id, projectId);
    const { base, head, threshold } = req.query as unknown as { base: string; head: string; threshold?: number };
    if (base === head) throw new AppError('Hãy chọn hai lượt chạy khác nhau để so sánh', 400, true, 'SAME_RUN');
    const runs = await prisma.testRun.findMany({ where: { id: { in: [base, head] } }, select: { id: true, projectId: true } });
    if (runs.length !== 2 || runs.some((run) => run.projectId !== projectId)) throw new AppError('Lượt chạy không thuộc dự án này', 404, true, 'TEST_RUN_NOT_FOUND');
    const [baseReport, headReport] = await Promise.all([loadRunReport(base), loadRunReport(head)]);
    res.status(200).json({ success: true, data: compareReports(baseReport, headReport, threshold ?? 20) });
  } catch (error) { next(error); }
};

/* ---------------- CI (project API token) ---------------- */

async function ciRun(req: ApiTokenRequest) {
  const run = await prisma.testRun.findUnique({ where: { id: req.params.testRunId }, select: { id: true, projectId: true } });
  if (!run || run.projectId !== req.apiToken!.projectId) throw new AppError('Test run not found', 404, true, 'TEST_RUN_NOT_FOUND');
  return run;
}

export const ciRunStatus = async (req: ApiTokenRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await ciRun(req);
    const report = await loadRunReport(req.params.testRunId);
    const finished = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(report.run.status);
    const success = report.run.status === 'COMPLETED' && report.summary.failed === 0 && report.summary.errors === 0 && report.summary.notRun === 0;
    res.status(200).json({ success: true, data: { runId: report.run.id, status: report.run.status, finished, passed: finished ? success : null, summary: report.summary, failureReason: report.run.failureReason } });
  } catch (error) { next(error); }
};

export const ciExportRun = async (req: ApiTokenRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await ciRun(req);
    const { format } = req.query as unknown as { format: ExportFormat };
    sendExport(res, await loadRunReport(req.params.testRunId), format);
  } catch (error) { next(error); }
};
