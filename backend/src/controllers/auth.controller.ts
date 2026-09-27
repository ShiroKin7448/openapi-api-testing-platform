import { NextFunction, Request, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { AuthService } from '../services/auth.service';
import { PasswordResetService } from '../services/password-reset.service';
import { EmailVerificationService } from '../services/email-verification.service';

const authService = new AuthService();
const passwordResetService = new PasswordResetService();
const emailVerificationService = new EmailVerificationService();

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, name } = req.body as { email: string; password: string; name: string };
    await authService.register(email, password, name);
    await emailVerificationService.requestCode(email);
    res.status(202).json({ success: true, data: { email, message: 'A verification code has been sent to your email address.' } });
  } catch (error) { next(error); }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const result = await authService.login(email, password);
    res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
};

export const getMe = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await authService.getUserById(req.user!.id);
    res.status(200).json({ success: true, data: user });
  } catch (error) { next(error); }
};

export const requestPasswordReset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body as { email: string };
    await passwordResetService.requestCode(email);
    res.status(202).json({ success: true, data: { message: 'If an account uses that email, a verification code has been sent.' } });
  } catch (error) { next(error); }
};

export const requestEmailVerification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body as { email: string };
    await emailVerificationService.requestCode(email);
    res.status(202).json({ success: true, data: { email, message: 'If the account needs verification, a code has been sent.' } });
  } catch (error) { next(error); }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, code } = req.body as { email: string; code: string };
    await emailVerificationService.verify(email, code);
    res.status(200).json({ success: true, data: { message: 'Email verified. You can now sign in.' } });
  } catch (error) { next(error); }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, code, newPassword } = req.body as { email: string; code: string; newPassword: string };
    await passwordResetService.resetPassword(email, code, newPassword);
    res.status(200).json({ success: true, data: { message: 'Password has been reset. Sign in with your new password.' } });
  } catch (error) { next(error); }
};

export const verifyPasswordResetCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, code } = req.body as { email: string; code: string };
    const resetToken = await passwordResetService.verifyResetCode(email, code);
    res.status(200).json({ success: true, data: { resetToken, expiresInSeconds: 600 } });
  } catch (error) { next(error); }
};

export const completePasswordReset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { resetToken, newPassword } = req.body as { resetToken: string; newPassword: string };
    await passwordResetService.completePasswordReset(resetToken, newPassword);
    res.status(200).json({ success: true, data: { message: 'Password has been reset. Sign in with your new password.' } });
  } catch (error) { next(error); }
};
