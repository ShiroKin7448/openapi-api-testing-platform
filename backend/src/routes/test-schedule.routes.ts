import { Router } from 'express';
import { TestScheduleController } from '../controllers/test-schedule.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { noQueryParams, projectParams, scheduleIdParams, createTestScheduleBody, updateTestScheduleBody } from '../validation/api.schemas';

const router = Router();
const controller = new TestScheduleController();

router.post('/projects/:projectId/schedules', requireAuth, validateRequest({ params: projectParams, body: createTestScheduleBody, query: noQueryParams }), controller.createSchedule);
router.get('/projects/:projectId/schedules', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), controller.listProjectSchedules);
router.patch('/schedules/:scheduleId', requireAuth, validateRequest({ params: scheduleIdParams, body: updateTestScheduleBody, query: noQueryParams }), controller.updateSchedule);
router.delete('/schedules/:scheduleId', requireAuth, validateRequest({ params: scheduleIdParams, query: noQueryParams }), controller.deleteSchedule);

export default router;
