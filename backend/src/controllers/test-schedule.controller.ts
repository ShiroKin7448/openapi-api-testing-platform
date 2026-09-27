import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { testScheduleService } from '../services/test-schedule.service';
import { ProjectService } from '../services/project.service';

const projectService = new ProjectService();

export class TestScheduleController {
  private user(req: AuthRequest): string {
    return req.user?.id as string;
  }

  createSchedule = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await projectService.get(this.user(req), req.params.projectId);
      const schedule = await testScheduleService.create(req.params.projectId, req.body, this.user(req));
      res.status(201).json({ success: true, data: schedule });
    } catch (error) { next(error); }
  };

  listProjectSchedules = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await projectService.get(this.user(req), req.params.projectId);
      const schedules = await testScheduleService.listByProject(req.params.projectId);
      res.status(200).json({ success: true, data: schedules });
    } catch (error) { next(error); }
  };

  updateSchedule = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schedule = await testScheduleService.get(req.params.scheduleId);
      await projectService.get(this.user(req), schedule.projectId);
      const updated = await testScheduleService.update(req.params.scheduleId, req.body);
      res.status(200).json({ success: true, data: updated });
    } catch (error) { next(error); }
  };

  deleteSchedule = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const schedule = await testScheduleService.get(req.params.scheduleId);
      await projectService.get(this.user(req), schedule.projectId);
      await testScheduleService.delete(req.params.scheduleId);
      res.status(200).json({ success: true });
    } catch (error) { next(error); }
  };
}
