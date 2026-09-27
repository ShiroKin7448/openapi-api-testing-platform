import axios from 'axios';

interface ApiErrorEnvelope { error?: { code?: string; message?: string }; message?: string; }

const knownMessages: Record<string, string> = {
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu chưa chính xác. Vui lòng kiểm tra và thử lại.',
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  EMAIL_ALREADY_EXISTS: 'Email này đã được sử dụng. Hãy đăng nhập hoặc dùng email khác.',
  EMAIL_NOT_VERIFIED: 'Email của tài khoản chưa được xác minh. Hãy nhận mã OTP để hoàn tất đăng ký.',
  EMAIL_ALREADY_VERIFIED: 'Email này đã được xác minh. Bạn có thể đăng nhập.',
  EMAIL_NOT_CONFIGURED: 'Máy chủ chưa cấu hình gửi email OTP. Hãy cấu hình SMTP_USER và SMTP_PASSWORD trong backend/.env rồi khởi động lại backend.',
  EMAIL_DELIVERY_FAILED: 'Không gửi được mã OTP. Hãy kiểm tra Gmail App Password và cấu hình SMTP, sau đó thử gửi lại.',
  INVALID_RESET_CODE: 'Mã xác minh không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới.',
  INVALID_OTP: 'Mã OTP không đúng, đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu mã mới.',
  INVALID_RESET_TOKEN: 'Phiên đặt lại mật khẩu đã hết hạn. Hãy xác minh lại mã OTP.',
  RESET_RATE_LIMITED: 'Bạn vừa yêu cầu mã xác minh. Vui lòng đợi một chút rồi thử lại.',
  VALIDATION_ERROR: 'Thông tin chưa hợp lệ. Hãy kiểm tra lại các trường vừa nhập.',
};

function friendlyAuthMessage(code: string | undefined, message: string | undefined, fallback: string): string {
  const normalized = message?.toLowerCase() ?? '';
  if (normalized.includes('invalid email or password')) return knownMessages.INVALID_CREDENTIALS;
  if (code && knownMessages[code]) return knownMessages[code];
  if (normalized.includes('already exists') && normalized.includes('email')) return knownMessages.EMAIL_ALREADY_EXISTS;
  if (normalized.includes('email delivery is not configured')) return knownMessages.EMAIL_NOT_CONFIGURED;
  if (normalized.includes('invalid request')) return knownMessages.VALIDATION_ERROR;
  if (normalized.includes('verification code') && (normalized.includes('invalid') || normalized.includes('expired'))) return knownMessages.INVALID_RESET_CODE;
  if (normalized.includes('email') && normalized.includes('send')) return knownMessages.EMAIL_DELIVERY_FAILED;
  return fallback;
}

export function apiErrorCode(error: unknown): string | undefined {
  return axios.isAxiosError<ApiErrorEnvelope>(error) ? error.response?.data?.error?.code : undefined;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ApiErrorEnvelope>(error)) {
    if (!error.response) return 'Không thể kết nối máy chủ. Hãy kiểm tra backend rồi thử lại.';
    return friendlyAuthMessage(error.response.data?.error?.code, error.response.data?.error?.message ?? error.response.data?.message, fallback);
  }
  return fallback;
}
