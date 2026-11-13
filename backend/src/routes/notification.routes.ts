import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { channelParams, createChannelBody, noQueryParams, projectParams, updateChannelBody } from '../validation/api.schemas';
import { createChannel, deleteChannel, listChannels, testChannel, updateChannel } from '../controllers/notification.controller';

const router = Router();
router.get('/projects/:projectId/notification-channels', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), listChannels);
router.post('/projects/:projectId/notification-channels', requireAuth, validateRequest({ params: projectParams, body: createChannelBody, query: noQueryParams }), createChannel);
router.patch('/projects/:projectId/notification-channels/:channelId', requireAuth, validateRequest({ params: channelParams, body: updateChannelBody, query: noQueryParams }), updateChannel);
router.delete('/projects/:projectId/notification-channels/:channelId', requireAuth, validateRequest({ params: channelParams, query: noQueryParams }), deleteChannel);
router.post('/projects/:projectId/notification-channels/:channelId/test', requireAuth, validateRequest({ params: channelParams, query: noQueryParams }), testChannel);
export default router;
