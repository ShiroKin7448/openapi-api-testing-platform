import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { ScheduleInput, testScheduleService } from '../services/test-schedule.service';
import { scheduleRunnerService } from '../services/schedule-runner.service';
import { requireProjectAccess } from '../utils/projectAccess';
import { auditLogService } from '../services/audit-log.service';
import { AppError } from '../utils/AppError';

export class TestScheduleController {
  private user(req: AuthRequest): string {
    return req.user?.id as string;
  }

  createSchedule = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = await requireProjectAccess(this.user(req), req.params.projectId, true);
      const schedule = await testScheduleService.create(req.params.projectId, req.body as ScheduleInput, this.user(req));
      await auditLogService.record(workspaceId, this.user(req), 'SCHEDULE_CREATED', 'TestSchedule', schedule.id, { interval: schedule.interval, cron: schedule.cron });
      res.status(201).json({ success: true, data: schedule });
    } catch (error) { next(error); }
  };

  listProjectSchedules = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await requireProjectAccess(this.user(req), req.params.projectId);
      const schedules = await testScheduleService.listByProject(req.params.projectId);
      res.status(200).json({ success: true, data: schedules });
    } catch (error) { next(error); }
  };

  updateSchedule = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schedule = await testScheduleService.get(req.params.scheduleId);
      await requireProjectAccess(this.user(req), schedule.projectId, true);
      const updated = await testScheduleService.update(req.params.scheduleId, req.body as ScheduleInput);
      res.status(200).json({ success: true, data: updated });
    } catch (error) { next(error); }
  };

  runNow = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schedule = await testScheduleService.get(req.params.scheduleId);
      await requireProjectAccess(this.user(req), schedule.projectId, true);
      const outcome = await scheduleRunnerService.trigger(schedule.id);
      if (outcome.error || !outcome.runId) throw new AppError(outcome.error ?? 'Không thể khởi chạy lịch', 422, true, 'SCHEDULE_RUN_FAILED');
      res.status(201).json({ success: true, data: { runId: outcome.runId } });
    } catch (error) { next(error); }
  };

  deleteSchedule = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schedule = await testScheduleService.get(req.params.scheduleId);
      const workspaceId = await requireProjectAccess(this.user(req), schedule.projectId, true);
      await testScheduleService.delete(req.params.scheduleId);
      await auditLogService.record(workspaceId, this.user(req), 'SCHEDULE_DELETED', 'TestSchedule', schedule.id, {});
      res.status(200).json({ success: true });
    } catch (error) { next(error); }
  };
}
