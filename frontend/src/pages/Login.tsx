import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, LogIn, Mail, ShieldCheck, User, UserPlus } from 'lucide-react';
import { authApi } from '../api/auth.api';
import { apiErrorCode, apiErrorMessage } from '../api/errors';
import { useAuthStore } from '../store/useAuthStore';

type AuthMode = 'login' | 'register';
type ResetStep = 'email' | 'code' | 'password';

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AuthMode>('login');
  const [resetFlow, setResetFlow] = useState(false);
  const [verificationFlow, setVerificationFlow] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep>('email');
  const [resetToken, setResetToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  const login = useMutation({
    mutationFn: () => authApi.login(email.trim(), password),
    onSuccess: ({ token, user }) => {
      queryClient.clear();
      setAuth(token, user);
      navigate('/', { replace: true });
    },
  });
  const register = useMutation({
    mutationFn: () => authApi.register(email.trim(), password, name.trim()),
    onSuccess: () => {
      setVerificationFlow(true);
      setPassword('');
      setPasswordConfirmation('');
      setOtp('');
      setResendAt(Date.now() + 60_000);
      setNow(Date.now());
      setNotice('Mã OTP đã được gửi. Hãy kiểm tra hộp thư đến và cả thư mục Spam. Mã có hiệu lực trong 10 phút.');
      setFormError('');
    },
    onError: (error: unknown) => {
      if (apiErrorCode(error) === 'EMAIL_NOT_CONFIGURED' || apiErrorCode(error) === 'EMAIL_DELIVERY_FAILED') {
        setVerificationFlow(true);
        setOtp('');
        setNotice('Tài khoản đã được tạo nhưng chưa xác minh. Cấu hình gửi email rồi bấm “Gửi lại mã OTP”.');
      }
    },
  });
  const verifyRegistration = useMutation({
    mutationFn: () => authApi.verifyEmail(email.trim(), otp),
    onSuccess: () => {
      setVerificationFlow(false);
      setMode('login');
      setPassword('');
      setPasswordConfirmation('');
      setOtp('');
      setResendAt(0);
      setNotice('Email đã được xác minh. Bạn có thể đăng nhập ngay.');
      setFormError('');
    },
  });
  const resendVerification = useMutation({
    mutationFn: () => authApi.requestEmailVerification(email.trim()),
    onSuccess: () => {
      register.reset();
      setResendAt(Date.now() + 60_000);
      setNow(Date.now());
      setNotice('Nếu tài khoản cần xác minh, mã OTP đã được gửi. Hãy kiểm tra hộp thư đến và thư mục Spam.');
      setOtp('');
      setFormError('');
    },
  });
  const requestOtp = useMutation({
    mutationFn: () => authApi.requestPasswordReset(email.trim()),
    onSuccess: () => {
      setResetStep('code');
      setResetToken('');
      setResendAt(Date.now() + 60_000);
      setNow(Date.now());
      setNotice('Nếu email này đã đăng ký, mã OTP đã được gửi. Hãy kiểm tra Hộp thư đến và Spam. Mã dùng một lần, có hiệu lực 10 phút.');
      setOtp('');
      setFormError('');
    },
  });
  const verifyResetCode = useMutation({
    mutationFn: () => authApi.verifyPasswordResetCode(email.trim(), otp),
    onSuccess: ({ resetToken: token }) => {
      setResetToken(token);
      setResetStep('password');
      setOtp('');
      setPassword('');
      setPasswordConfirmation('');
      setNotice('Mã OTP chính xác. Bây giờ bạn có thể đặt mật khẩu mới.');
      setFormError('');
    },
  });
  const completeReset = useMutation({
    mutationFn: () => authApi.completePasswordReset(resetToken, password),
    onSuccess: () => {
      setResetFlow(false);
      setResetStep('email');
      setResetToken('');
      setResendAt(0);
      setMode('login');
      setPassword('');
      setPasswordConfirmation('');
      setOtp('');
      requestOtp.reset();
      setNotice('Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.');
      setFormError('');
    },
    onError: (error: unknown) => {
      if (apiErrorCode(error) === 'INVALID_RESET_TOKEN') {
        setResetStep('email');
        setResetToken('');
        setFormError('Phiên đổi mật khẩu đã hết hạn. Hãy yêu cầu mã OTP mới để tiếp tục.');
      }
    },
  });

  useEffect(() => {
    if (!resendAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const busy = login.isPending || register.isPending || verifyRegistration.isPending || resendVerification.isPending || requestOtp.isPending || verifyResetCode.isPending || completeReset.isPending;
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const switchMode = (nextMode: AuthMode) => {
    if (busy) return;
    setMode(nextMode);
    setResetFlow(false);
    setVerificationFlow(false);
    setResendAt(0);
    setFormError('');
    setNotice('');
    login.reset();
    register.reset();
    verifyRegistration.reset();
    resendVerification.reset();
    requestOtp.reset();
    verifyResetCode.reset();
    completeReset.reset();
  };

  const openPasswordReset = () => {
    setResetFlow(true);
    setVerificationFlow(false);
    setResetStep('email');
    setResendAt(0);
    setPassword('');
    setPasswordConfirmation('');
    setOtp('');
    setFormError('');
    setNotice('');
    login.reset();
    register.reset();
    verifyRegistration.reset();
    resendVerification.reset();
    requestOtp.reset();
    verifyResetCode.reset();
    completeReset.reset();
    setResetToken('');
  };

  const returnToAuth = () => {
    if (busy) return;
    if (verificationFlow || resetFlow) setMode('login');
    setResetFlow(false);
    setVerificationFlow(false);
    setResetStep('email');
    setResendAt(0);
    setFormError('');
    setNotice('');
    resendVerification.reset();
    verifyRegistration.reset();
    requestOtp.reset();
    verifyResetCode.reset();
    completeReset.reset();
    setResetToken('');
  };

  const validateNewPassword = (): boolean => {
    if (password !== passwordConfirmation) {
      setFormError('Mật khẩu xác nhận không khớp.');
      return false;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setFormError('Mật khẩu không được dài quá 72 byte để tương thích với bcrypt.');
      return false;
    }
    return true;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setNotice('');
    if (verificationFlow) {
      verifyRegistration.mutate();
      return;
    }
    if (resetFlow) {
      if (resetStep === 'email') requestOtp.mutate();
      else if (resetStep === 'code') verifyResetCode.mutate();
      else if (validateNewPassword()) completeReset.mutate();
      return;
    }
    if (mode === 'register') {
      if (!validateNewPassword()) return;
      register.mutate();
      return;
    }
    login.mutate();
  };

  const activeMutationError = verificationFlow
    ? verifyRegistration.error ?? resendVerification.error ?? register.error
    : resetFlow ? resetStep === 'email' ? requestOtp.error : resetStep === 'code' ? verifyResetCode.error : completeReset.error
      : mode === 'login' ? login.error : register.error;
  const fallback = verificationFlow ? 'Không thể xác minh email.' : resetFlow ? resetStep === 'email' ? 'Không gửi được mã khôi phục.' : resetStep === 'code' ? 'Không thể xác minh mã OTP.' : 'Không thể đặt lại mật khẩu.' : mode === 'login' ? 'Đăng nhập không thành công.' : 'Không thể tạo tài khoản.';
  const errorMessage = formError || (activeMutationError ? apiErrorMessage(activeMutationError, fallback) : '');
  const maskedEmail = email.trim().replace(/^(.{1,2})[^@]*(@.*)$/, '$1••••$2');
  const unverifiedLogin = !resetFlow && !verificationFlow && mode === 'login' && apiErrorCode(login.error) === 'EMAIL_NOT_VERIFIED';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f6f7f9] px-4 py-10 dark:bg-dark-950 sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.09),_transparent_48%)]" />
      <section className="relative w-full max-w-[440px] rounded-3xl border border-slate-200/80 bg-white px-6 py-8 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.22)] dark:border-white/[0.08] dark:bg-dark-900 sm:px-10 sm:py-10">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/15 dark:bg-indigo-500"><span className="text-lg font-semibold tracking-tight">A</span></div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">API Test Auto</p>
          {!resetFlow && !verificationFlow && <div className="mt-5 inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-dark-950" role="tablist" aria-label="Chọn đăng nhập hoặc đăng ký">
            {(['login', 'register'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value} disabled={busy} onClick={() => switchMode(value)} className={`rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${mode === value ? 'bg-white text-slate-900 shadow-sm dark:bg-dark-800 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>{value === 'login' ? 'Đăng nhập' : 'Đăng ký'}</button>)}
          </div>}
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{verificationFlow ? 'Xác minh email' : resetFlow ? resetStep === 'email' ? 'Khôi phục mật khẩu' : resetStep === 'code' ? 'Xác minh mã OTP' : 'Đặt mật khẩu mới' : mode === 'login' ? 'Chào mừng trở lại' : 'Tạo tài khoản'}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{verificationFlow ? <>Nhập mã 6 số đã gửi tới <strong className="font-medium text-slate-700 dark:text-slate-200">{maskedEmail}</strong> để kích hoạt tài khoản.</> : resetFlow ? resetStep === 'email' ? 'Nhập email tài khoản. Hướng dẫn khôi phục sẽ được gửi tới hộp thư nếu tài khoản tồn tại.' : resetStep === 'code' ? <>Nhập mã 6 số đã gửi tới <strong className="font-medium text-slate-700 dark:text-slate-200">{maskedEmail}</strong>.</> : 'Chọn mật khẩu mới cho tài khoản của bạn.' : mode === 'login' ? 'Đăng nhập để tiếp tục đến không gian làm việc.' : 'Tạo tài khoản để bắt đầu kiểm thử API.'}</p>
        </header>

        <div>
          {(resetFlow || verificationFlow) && <button type="button" onClick={returnToAuth} disabled={busy} className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:hover:text-white"><ArrowLeft className="h-4 w-4" /> Quay lại đăng nhập</button>}

          <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
            {!resetFlow && !verificationFlow && mode === 'register' && (
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Họ và tên
                <span className="relative mt-1.5 block"><User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input required type="text" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nguyễn Văn An" className="input-premium pl-10" /></span>
              </label>
            )}

            {!verificationFlow && (resetStep === 'email' || !resetFlow) && (
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Email
                <span className="relative mt-1.5 block"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input required type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ten@congty.com" className="input-premium pl-10" /></span>
              </label>
            )}

            {!resetFlow && !verificationFlow && (
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Mật khẩu
                <span className="relative mt-1.5 block"><Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input required type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? 'Ít nhất 8 ký tự' : 'Nhập mật khẩu'} className="input-premium pl-10 pr-12" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
                {mode === 'register' && <span className="mt-1.5 block text-xs font-normal text-slate-500">Mật khẩu tối đa 72 byte để tương thích với bcrypt.</span>}
              </label>
            )}

            {!resetFlow && !verificationFlow && mode === 'register' && <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Xác nhận mật khẩu
              <span className="relative mt-1.5 block"><Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="Nhập lại mật khẩu" className="input-premium pl-10" /></span>
            </label>}

            {((resetFlow && resetStep === 'code') || verificationFlow) && <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Mã OTP
              <input required type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="input-premium mt-1.5 text-center font-mono text-lg tracking-[0.25em]" />
            </label>}

            {resetFlow && resetStep === 'password' && (
              <>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Mật khẩu mới
                  <span className="relative mt-1.5 block"><Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" className="input-premium pl-10" /></span>
                </label>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">Xác nhận mật khẩu mới
                  <span className="relative mt-1.5 block"><Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={128} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="Nhập lại mật khẩu mới" className="input-premium pl-10" /></span>
                </label>
              </>
            )}

            {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm leading-5 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">{notice}</p>}
            {errorMessage && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-5 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">{errorMessage}</p>}

            {!resetFlow && !verificationFlow && mode === 'login' && <div className="flex justify-between"><button type="button" onClick={openPasswordReset} className="text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200">Quên mật khẩu?</button>{unverifiedLogin && <button type="button" onClick={() => { login.reset(); setVerificationFlow(true); setOtp(''); setNotice(''); resendVerification.mutate(); }} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-300">Gửi mã OTP</button>}</div>}

            {((resetFlow && resetStep === 'code') || verificationFlow) && <div className="flex justify-end"><button type="button" disabled={busy || resendSeconds > 0} onClick={() => verificationFlow ? resendVerification.mutate() : requestOtp.mutate()} className="text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-800 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-indigo-300">{resendSeconds > 0 ? `Gửi lại mã sau ${resendSeconds}s` : 'Gửi lại mã OTP'}</button></div>}

            <button type="submit" disabled={busy} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400">
              {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" /> : verificationFlow ? <ShieldCheck className="h-4 w-4" /> : resetFlow ? resetStep === 'email' ? <Mail className="h-4 w-4" /> : resetStep === 'code' ? <ShieldCheck className="h-4 w-4" /> : <KeyRound className="h-4 w-4" /> : mode === 'login' ? <LogIn className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /> : <UserPlus className="h-4 w-4" />}
              {busy ? 'Đang xử lý…' : verificationFlow ? 'Xác minh email' : resetFlow ? resetStep === 'email' ? 'Gửi mã OTP khôi phục' : resetStep === 'code' ? 'Xác minh mã OTP' : 'Cập nhật mật khẩu' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </button>
          </form>

        </div>
        <p className="mt-7 text-center text-xs text-slate-400">Bảo mật tài khoản của bạn luôn được ưu tiên.</p>
      </section>
    </main>
  );
}
