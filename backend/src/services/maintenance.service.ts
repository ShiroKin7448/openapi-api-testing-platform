import prisma from '../utils/prisma';

const envInt = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

export interface RetentionPolicy {
  /** Delete finished test runs (and their results/events) older than this many days. 0 = keep forever. */
  runRetentionDays: number;
  /** Always keep at least this many most recent runs per project, regardless of age. */
  keepRunsPerProject: number;
  /** Progress events are only needed for live streaming; trim them sooner. */
  eventRetentionDays: number;
  /** Audit log retention. 0 = keep forever. */
  auditRetentionDays: number;
  /** Expired / used OTP rows. */
  otpRetentionDays: number;
}

export function retentionPolicy(): RetentionPolicy {
  return {
    runRetentionDays: envInt('RETENTION_RUN_DAYS', 30),
    keepRunsPerProject: envInt('RETENTION_KEEP_RUNS_PER_PROJECT', 20),
    eventRetentionDays: envInt('RETENTION_EVENT_DAYS', 7),
    auditRetentionDays: envInt('RETENTION_AUDIT_DAYS', 180),
    otpRetentionDays: envInt('RETENTION_OTP_DAYS', 1),
  };
}

export interface CleanupReport {
  startedAt: string;
  durationMs: number;
  deletedRuns: number;
  deletedEvents: number;
  deletedAuditLogs: number;
  deletedOtps: number;
  deletedSpecs: number;
}

const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const BATCH = 200;

/** Periodically removes old test data so the database does not grow without bound. */
export class MaintenanceService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(intervalMs = envInt('MAINTENANCE_INTERVAL_MS', 6 * 60 * 60 * 1000)): void {
    if (this.timer || process.env.MAINTENANCE_DISABLED === 'true') return;
    // First pass a little after boot so start-up stays fast.
    const first = setTimeout(() => { void this.runCleanup(); }, 60_000);
    first.unref();
    this.timer = setInterval(() => { void this.runCleanup(); }, Math.max(60_000, intervalMs));
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runCleanup(policy: RetentionPolicy = retentionPolicy()): Promise<CleanupReport | null> {
    if (this.running) return null;
    this.running = true;
    const started = Date.now();
    const report: CleanupReport = { startedAt: new Date(started).toISOString(), durationMs: 0, deletedRuns: 0, deletedEvents: 0, deletedAuditLogs: 0, deletedOtps: 0, deletedSpecs: 0 };
    try {
      if (policy.runRetentionDays > 0) report.deletedRuns = await this.cleanupRuns(policy);
      if (policy.eventRetentionDays > 0) {
        const result = await prisma.testRunEvent.deleteMany({ where: { createdAt: { lt: daysAgo(policy.eventRetentionDays) }, testRun: { status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] } } } });
        report.deletedEvents = result.count;
      }
      if (policy.auditRetentionDays > 0) {
        const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: daysAgo(policy.auditRetentionDays) } } });
        report.deletedAuditLogs = result.count;
      }
      if (policy.otpRetentionDays > 0) {
        const otpCutoff = daysAgo(policy.otpRetentionDays);
        const result = await prisma.passwordResetOtp.deleteMany({ where: { expiresAt: { lt: otpCutoff }, OR: [{ resetGrantExpiresAt: null }, { resetGrantExpiresAt: { lt: otpCutoff } }] } });
        report.deletedOtps = result.count;
      }
      report.deletedSpecs = await this.pruneUnusedSpecs();
      // Stuck runs (process crashed mid-run) would otherwise stay RUNNING forever.
      await prisma.testRun.updateMany({
        where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
        data: { status: 'FAILED', endTime: new Date(), failureReason: 'Lượt chạy bị treo quá 6 giờ và đã được hệ thống đóng lại.' },
      });
      report.durationMs = Date.now() - started;
      console.log(JSON.stringify({ event: 'maintenance.cleanup.completed', ...report }));
      return report;
    } catch (error) {
      console.error(JSON.stringify({ event: 'maintenance.cleanup.failed', error: error instanceof Error ? error.message : String(error) }));
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Project-scoped cleanup triggered from Project Settings. */
  async cleanupProject(projectId: string, policy: RetentionPolicy = retentionPolicy()): Promise<{ deletedRuns: number }> {
    if (policy.runRetentionDays <= 0) return { deletedRuns: 0 };
    return { deletedRuns: await this.cleanupRuns(policy, projectId) };
  }

  /** How much data a project holds right now (shown next to the retention policy). */
  async projectUsage(projectId: string): Promise<{ runs: number; results: number; events: number; oldestRunAt: Date | null; eligibleRuns: number }> {
    const policy = retentionPolicy();
    const [runs, results, events, oldest, eligible] = await Promise.all([
      prisma.testRun.count({ where: { projectId } }),
      prisma.testResult.count({ where: { testRun: { projectId } } }),
      prisma.testRunEvent.count({ where: { testRun: { projectId } } }),
      prisma.testRun.findFirst({ where: { projectId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      policy.runRetentionDays > 0 ? prisma.testRun.count({ where: { projectId, createdAt: { lt: daysAgo(policy.runRetentionDays) }, status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] } } }) : Promise.resolve(0),
    ]);
    return { runs, results, events, oldestRunAt: oldest?.createdAt ?? null, eligibleRuns: Math.max(0, Math.min(eligible, runs - policy.keepRunsPerProject)) };
  }

  /** Older (inactive) specs are kept only while some test run still references their test cases. */
  private async pruneUnusedSpecs(): Promise<number> {
    const projects = await prisma.openAPISpec.groupBy({ by: ['projectId'], _count: { _all: true } });
    let deleted = 0;
    for (const { projectId, _count } of projects) {
      if (_count._all < 2) continue;
      const specs = await prisma.openAPISpec.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      for (const spec of specs.slice(1)) {
        const referenced = await prisma.testResult.count({ where: { testCase: { endpoint: { specId: spec.id } } } });
        if (referenced > 0) continue;
        await prisma.openAPISpec.delete({ where: { id: spec.id } });
        deleted += 1;
      }
    }
    return deleted;
  }

  private async cleanupRuns(policy: RetentionPolicy, onlyProjectId?: string): Promise<number> {
    const cutoff = daysAgo(policy.runRetentionDays);
    const projects = onlyProjectId
      ? [{ projectId: onlyProjectId }]
      : await prisma.testRun.groupBy({ by: ['projectId'], where: { createdAt: { lt: cutoff } } });
    let deleted = 0;
    for (const { projectId } of projects) {
      const keep = await prisma.testRun.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: policy.keepRunsPerProject, select: { id: true } });
      const keepIds = keep.map((run) => run.id);
      // Runs referenced as a schedule's "last run" stay so the schedule page can still link to them.
      const scheduleRefs = await prisma.testSchedule.findMany({ where: { projectId, lastRunId: { not: null } }, select: { lastRunId: true } });
      const protectedIds = [...keepIds, ...scheduleRefs.map((item) => item.lastRunId as string)];
      for (;;) {
        const batch = await prisma.testRun.findMany({
          where: { projectId, createdAt: { lt: cutoff }, status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] }, id: { notIn: protectedIds } },
          select: { id: true }, take: BATCH,
        });
        if (!batch.length) break;
        const ids = batch.map((run) => run.id);
        // Results and events cascade from TestRun.
        const result = await prisma.testRun.deleteMany({ where: { id: { in: ids } } });
        deleted += result.count;
        if (batch.length < BATCH) break;
      }
    }
    return deleted;
  }
}

export const maintenanceService = new MaintenanceService();
