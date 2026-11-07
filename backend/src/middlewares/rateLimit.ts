import rateLimit, { Options } from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * In-memory rate limiters (per API instance). Limits are configurable through env so
 * automated tests and local demos can relax them. Set RATE_LIMIT_DISABLED=true to turn off.
 */
const disabled = (): boolean => process.env.RATE_LIMIT_DISABLED === 'true' || process.env.NODE_ENV === 'test';

const envNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

function emailKey(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return `${req.ip ?? 'unknown'}|${email}`;
}

function limiter(options: Partial<Options> & { code: string; message: string }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => disabled(),
    ...options,
    handler: (_req: Request, res: Response, _next, opts) => {
      const retryAfterSeconds = Math.ceil(opts.windowMs / 1000);
      res.status(429).json({ success: false, error: { code: options.code, message: options.message, retryAfterSeconds } });
    },
  });
}

/** Brute-force protection on login: counts only failed attempts per IP + email. */
export const loginLimiter = limiter({
  windowMs: envNumber('RATE_LIMIT_LOGIN_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('RATE_LIMIT_LOGIN_MAX', 10),
  keyGenerator: emailKey,
  skipSuccessfulRequests: true,
  code: 'TOO_MANY_LOGIN_ATTEMPTS',
  message: 'Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.',
});

/** OTP send endpoints (password reset / email verification): prevents email spam. */
export const otpRequestLimiter = limiter({
  windowMs: envNumber('RATE_LIMIT_OTP_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('RATE_LIMIT_OTP_MAX', 5),
  keyGenerator: emailKey,
  code: 'TOO_MANY_OTP_REQUESTS',
  message: 'Bạn đã yêu cầu gửi mã quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
});

/** OTP verification endpoints: prevents guessing 6-digit codes. */
export const otpVerifyLimiter = limiter({
  windowMs: envNumber('RATE_LIMIT_OTP_VERIFY_WINDOW_MS', 15 * 60 * 1000),
  limit: envNumber('RATE_LIMIT_OTP_VERIFY_MAX', 10),
  keyGenerator: emailKey,
  code: 'TOO_MANY_OTP_ATTEMPTS',
  message: 'Bạn đã nhập sai mã quá nhiều lần. Vui lòng yêu cầu mã mới sau ít phút.',
});

export const registerLimiter = limiter({
  windowMs: envNumber('RATE_LIMIT_REGISTER_WINDOW_MS', 60 * 60 * 1000),
  limit: envNumber('RATE_LIMIT_REGISTER_MAX', 10),
  code: 'TOO_MANY_REGISTRATIONS',
  message: 'Quá nhiều lượt đăng ký từ địa chỉ này. Vui lòng thử lại sau.',
});

/** Generous global ceiling for the whole API (protects against floods). */
export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: envNumber('RATE_LIMIT_API_MAX', 600),
  code: 'TOO_MANY_REQUESTS',
  message: 'Quá nhiều yêu cầu. Vui lòng chậm lại.',
});

/** CI trigger endpoint: one token should not be able to hammer the run queue. */
export const ciTriggerLimiter = limiter({
  windowMs: 60 * 1000,
  limit: envNumber('RATE_LIMIT_CI_MAX', 30),
  keyGenerator: (req: Request) => `${req.ip ?? 'unknown'}|${req.params.projectId ?? ''}`,
  code: 'TOO_MANY_CI_RUNS',
  message: 'Quá nhiều lượt kích hoạt CI trong một phút.',
});
