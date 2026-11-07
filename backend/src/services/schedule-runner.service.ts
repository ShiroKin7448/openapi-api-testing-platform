import prisma from '../utils/prisma';
import { executeRun } from '../controllers/test-run.controller';
import { nextRunFrom, testScheduleService } from './test-schedule.service';

export class ScheduleRunnerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.checkSchedules(); }, 30_000);
    this.timer.unref();
    void this.checkSchedules();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Starts a schedule's run immediately (also used by the "Run now" button). */
  async trigger(scheduleId: string): Promise<{ runId?: string; error?: string }> {
    const schedule = await prisma.testSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) return { error: 'Schedule not found' };
    try {
      const result = await executeRun(
        schedule.projectId,
        schedule.environmentId,
        Array.isArray(schedule.testCaseIds) && schedule.testCaseIds.length ? schedule.testCaseIds as string[] : undefined,
        schedule.createdBy,
        'SCHEDULED',
      );
      await testScheduleService.recordRun(schedule.id, { runId: result.runId });
      return { runId: result.runId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể khởi chạy';
      await testScheduleService.recordRun(schedule.id, { error: message }).catch(() => undefined);
      return { error: message };
    }
  }

  async checkSchedules() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const dueSchedules = await prisma.testSchedule.findMany({
        where: { enabled: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] },
      });

      for (const schedule of dueSchedules) {
        try {
          let nextRunAt: Date | null = null;
          let enabled = true;
          if (schedule.interval === 'ONCE') {
            enabled = false;
          } else {
            const cron = schedule.cron || (schedule.interval === 'WEEKLY' ? '0 8 * * 1' : '0 8 * * *');
            try { nextRunAt = nextRunFrom(cron, now); }
            catch { nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); }
          }

          // Claim the slot atomically so two API instances can't fire the same schedule twice.
          const claim = await prisma.testSchedule.updateMany({
            where: { id: schedule.id, enabled: true, nextRunAt: schedule.nextRunAt },
            data: { lastRunAt: now, nextRunAt, enabled },
          });
          if (claim.count !== 1) continue;

          const outcome = await this.trigger(schedule.id);
          if (outcome.error) console.error(JSON.stringify({ event: 'schedule.run_failed', scheduleId: schedule.id, error: outcome.error }));
          else console.log(JSON.stringify({ event: 'schedule.run_started', scheduleId: schedule.id, runId: outcome.runId }));
        } catch (err) {
          console.error(`Failed to process schedule ${schedule.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[ScheduleRunner] check failed:', err instanceof Error ? err.message : err);
    } finally {
      this.running = false;
    }
  }
}

export const scheduleRunnerService = new ScheduleRunnerService();
