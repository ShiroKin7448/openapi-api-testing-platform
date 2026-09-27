import nodemailer from 'nodemailer';
import { AppError } from '../utils/AppError';

interface SmtpConfiguration {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export type EmailOtpPurpose = 'PASSWORD_RESET' | 'EMAIL_VERIFICATION';

function smtpConfiguration(): SmtpConfiguration | undefined {
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  if (!user || !password) return undefined;
  const parsedPort = Number(process.env.SMTP_PORT ?? '465');
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new AppError('SMTP_PORT must be a valid TCP port', 500, false, 'EMAIL_CONFIGURATION_ERROR');
  }
  const secureSetting = process.env.SMTP_SECURE?.toLowerCase();
  return {
    host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
    port: parsedPort,
    secure: secureSetting ? secureSetting === 'true' : parsedPort === 465,
    user,
    password,
    from: process.env.SMTP_FROM?.trim() || user,
  };
}

export class EmailService {
  assertConfigured(): void {
    if (!smtpConfiguration()) {
      throw new AppError('Email delivery is not configured. Set SMTP_USER and SMTP_PASSWORD.', 503, true, 'EMAIL_NOT_CONFIGURED');
    }
  }

  async sendOneTimeCode(email: string, code: string, purpose: EmailOtpPurpose): Promise<void> {
    const configuration = smtpConfiguration();
    if (!configuration) {
      throw new AppError('Email delivery is not configured. Set SMTP_USER and SMTP_PASSWORD.', 503, true, 'EMAIL_NOT_CONFIGURED');
    }

    const transporter = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      auth: { user: configuration.user, pass: configuration.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
    try {
      const isVerification = purpose === 'EMAIL_VERIFICATION';
      const title = isVerification ? 'Xác minh địa chỉ email' : 'Đặt lại mật khẩu';
      const purposeLabel = isVerification ? 'xác minh tài khoản' : 'đặt lại mật khẩu';
      await transporter.sendMail({
        from: configuration.from,
        to: email,
        subject: `Mã OTP ${purposeLabel} – API Test Auto`,
        text: `Mã OTP ${purposeLabel} của bạn là ${code}. Mã có hiệu lực trong 10 phút và chỉ sử dụng được một lần. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#172033"><h2>${title}</h2><p>Nhập mã xác minh bên dưới để tiếp tục:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#4f46e5">${code}</p><p>Mã có hiệu lực trong <strong>10 phút</strong> và chỉ sử dụng được một lần.</p><p>Nếu bạn không yêu cầu mã này, hãy bỏ qua email.</p></div>`,
      });
    } finally {
      transporter.close();
    }
  }
}
