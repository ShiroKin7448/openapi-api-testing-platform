import { Router } from 'express';
import { register, login, getMe, requestPasswordReset, requestEmailVerification, verifyEmail, verifyPasswordResetCode, completePasswordReset } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { loginLimiter, otpRequestLimiter, otpVerifyLimiter, registerLimiter } from '../middlewares/rateLimit';
import { emailVerificationBody, emailVerificationRequestBody, loginBody, noQueryParams, passwordResetBody, passwordResetCodeBody, passwordResetCompletionBody, passwordResetRequestBody, registerBody } from '../validation/api.schemas';

const router = Router();

router.post('/register', registerLimiter, validateRequest({ body: registerBody, query: noQueryParams }), register);
router.post('/login', loginLimiter, validateRequest({ body: loginBody, query: noQueryParams }), login);
router.post('/password-reset/request', otpRequestLimiter, validateRequest({ body: passwordResetRequestBody, query: noQueryParams }), requestPasswordReset);
router.post('/password-reset/verify-code', otpVerifyLimiter, validateRequest({ body: passwordResetCodeBody, query: noQueryParams }), verifyPasswordResetCode);
router.post('/password-reset/complete', otpVerifyLimiter, validateRequest({ body: passwordResetCompletionBody, query: noQueryParams }), completePasswordReset);
router.post('/verification/request', otpRequestLimiter, validateRequest({ body: emailVerificationRequestBody, query: noQueryParams }), requestEmailVerification);
router.post('/verification/verify', otpVerifyLimiter, validateRequest({ body: emailVerificationBody, query: noQueryParams }), verifyEmail);
router.get('/me', requireAuth, validateRequest({ query: noQueryParams }), getMe);

export default router;
