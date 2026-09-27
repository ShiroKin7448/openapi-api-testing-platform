import cronParser from 'cron-parser';
import prisma from '../utils/prisma';
import { executeRun } from '../controllers/test-run.controller';

export class ScheduleRunnerService {
  private timer: NodeJS.Timeout | null = null;

  start() {
    if (this.timer) return;
    // Check every minute
    this.timer = setInterval(() => this.checkSchedules(), 60000);
    // Run immediately on start
    void this.checkSchedules();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkSchedules() {
    const now = new Date();
    
    // Find active schedules that are due
    const dueSchedules = await prisma.testSchedule.findMany({
      where: {
        enabled: true,
        OR: [
          { nextRunAt: { lte: now } },
          { nextRunAt: null, lastRunAt: null } // Never run before
        ]
      } as any
    });

    for (const schedule of dueSchedules) {
      try {
        // Prepare to calculate next run
        let nextRunAt: Date | null = null;
        
        if (schedule.interval === 'ONCE') {
          // Will not run again, disable it
          await prisma.testSchedule.update({
            where: { id: schedule.id },
            data: { lastRunAt: now, enabled: false } as any
          });
        } else {
          // Calculate nextRunAt based on interval
          const intervalMap: Record<string, string> = {
            'DAILY': '0 0 * * *',
            'WEEKLY': '0 0 * * 0'
          };
          const cronExpr = schedule.interval === 'CUSTOM' ? (schedule.cron || '* * * * *') : intervalMap[schedule.interval] || '0 0 * * *';
          
          try {
            const interval = cronParser.parseExpression(cronExpr);
            nextRunAt = interval.next().toDate();
          } catch (e) {
            console.error(`Invalid cron expression for schedule ${schedule.id}: ${cronExpr}`);
            // Fallback: 1 day later
            nextRunAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          }

          await prisma.testSchedule.update({
            where: { id: schedule.id },
            data: { lastRunAt: now, nextRunAt } as any
          });
        }

        // Trigger the test run
        await executeRun(
          schedule.projectId,
          schedule.environmentId,
          schedule.testCaseIds as string[] | undefined,
          schedule.createdBy,
          'SCHEDULED'
        ).catch((err) => {
          console.error(`Failed to start scheduled run for schedule ${schedule.id}:`, err);
        });

      } catch (err) {
        console.error(`Failed to process schedule ${schedule.id}:`, err);
      }
    }
  }
}

export const scheduleRunnerService = new ScheduleRunnerService();
