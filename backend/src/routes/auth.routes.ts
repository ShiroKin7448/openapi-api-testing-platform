import { Router } from 'express';
import { register, login, getMe, requestPasswordReset, requestEmailVerification, verifyEmail, verifyPasswordResetCode, completePasswordReset } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { emailVerificationBody, emailVerificationRequestBody, loginBody, noQueryParams, passwordResetBody, passwordResetCodeBody, passwordResetCompletionBody, passwordResetRequestBody, registerBody } from '../validation/api.schemas';

const router = Router();

router.post('/register', validateRequest({ body: registerBody, query: noQueryParams }), register);
router.post('/login', validateRequest({ body: loginBody, query: noQueryParams }), login);
router.post('/password-reset/request', validateRequest({ body: passwordResetRequestBody, query: noQueryParams }), requestPasswordReset);
router.post('/password-reset/verify-code', validateRequest({ body: passwordResetCodeBody, query: noQueryParams }), verifyPasswordResetCode);
router.post('/password-reset/complete', validateRequest({ body: passwordResetCompletionBody, query: noQueryParams }), completePasswordReset);
router.post('/verification/request', validateRequest({ body: emailVerificationRequestBody, query: noQueryParams }), requestEmailVerification);
router.post('/verification/verify', validateRequest({ body: emailVerificationBody, query: noQueryParams }), verifyEmail);
router.get('/me', requireAuth, validateRequest({ query: noQueryParams }), getMe);

export default router;
