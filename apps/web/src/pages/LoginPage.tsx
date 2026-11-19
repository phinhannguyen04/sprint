import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom';
import { Button, Input } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import { getApiErrorMessage } from '../api/client';
import { Eye, EyeOff, CircleAlert } from 'lucide-react';
import { AuthPageShell } from '../components/auth/AuthPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type AuthStep = 'email' | 'password' | 'code';
type AuthMode = 'sign-in' | 'sign-up';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, refreshUser } = useAuth();

  const state = location.state as {
    from?: { pathname?: string; search?: string };
    email?: string;
    inviteToken?: string;
  } | null;
  const from = state?.from;
  const returnPath = from ? (from.pathname ?? '/') + (from.search ?? '') : '/';
  const prefilledEmail = state?.email ?? '';

  const [searchParams] = useSearchParams();
  const inviteToken = useMemo(() => {
    const q = searchParams.get('invite')?.trim() ?? '';
    const st = state?.inviteToken?.trim() ?? '';
    return q || st;
  }, [searchParams, state?.inviteToken]);

  const [step, setStep] = useState<AuthStep>('email');
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState('');
  const [magicCode, setMagicCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allowSignup, setAllowSignup] = useState(true);
  const [isSmtpConfigured, setIsSmtpConfigured] = useState(false);
  const [isPasswordEnabled, setIsPasswordEnabled] = useState(true);
  const [isMagicCodeEnabled, setIsMagicCodeEnabled] = useState(true);

  useDocumentTitle(t('auth.login.documentTitle', 'Sign in'));

  useEffect(() => {
    authService
      .getAuthConfig()
      .then((cfg) => {
        setAllowSignup(cfg.enable_signup);
        setIsSmtpConfigured(cfg.is_smtp_configured);
        setIsPasswordEnabled(cfg.is_email_password_enabled);
        setIsMagicCodeEnabled(cfg.is_magic_code_enabled ?? true);
      })
      .catch(() => {});
  }, []);

  const canUseMagicCode = isMagicCodeEnabled && isSmtpConfigured;

  const sendMagicCode = useCallback(async () => {
    await authService.requestMagicCode({
      email,
      ...(inviteToken ? { invite_token: inviteToken } : {}),
    });
  }, [email, inviteToken]);

  const handleEmailSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setIsSubmitting(true);
      try {
        const resp = await authService.emailCheck(email);
        if (resp.existing) {
          setMode('sign-in');
        } else {
          navigate('/sign-up', { state: { email, inviteToken }, replace: true });
          return;
        }

        const magicOnly = !isPasswordEnabled && isMagicCodeEnabled && isSmtpConfigured;
        if (magicOnly) {
          try {
            await sendMagicCode();
            setStep('code');
          } catch (err: unknown) {
            setError(
              getApiErrorMessage(err) ||
                t('auth.login.sendCodeError', 'Could not send sign-in code.'),
            );
          } finally {
            setIsSubmitting(false);
          }
          return;
        }

        setStep('password');
      } catch {
        setStep('password');
        setMode('sign-in');
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      email,
      inviteToken,
      isPasswordEnabled,
      isMagicCodeEnabled,
      isSmtpConfigured,
      sendMagicCode,
      navigate,
      t,
    ],
  );

  const switchToMagicCode = useCallback(async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await sendMagicCode();
      setStep('code');
    } catch (err: unknown) {
      setError(
        getApiErrorMessage(err) || t('auth.login.sendCodeError', 'Could not send sign-in code.'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [sendMagicCode, t]);

  const handlePasswordSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setIsSubmitting(true);
      try {
        await login(email, password);
        navigate(returnPath, { replace: true });
      } catch (err: unknown) {
        setError(
          getApiErrorMessage(err) ||
            t('common.genericError', 'Something went wrong. Please try again.'),
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, password, login, navigate, returnPath, t],
  );

  const handleMagicCodeSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      const code = magicCode.replace(/\D/g, '');
      if (code.length !== 6) {
        setError(t('auth.login.codeLengthError', 'Enter the 6-digit code from your email.'));
        return;
      }
      setIsSubmitting(true);
      try {
        await authService.verifyMagicCode({
          email,
          code,
          ...(inviteToken ? { invite_token: inviteToken } : {}),
        });
        await refreshUser();
        navigate(returnPath, { replace: true });
      } catch (err: unknown) {
        setError(
          getApiErrorMessage(err) || t('auth.login.invalidCode', 'Invalid or expired code.'),
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [magicCode, email, inviteToken, refreshUser, navigate, returnPath, t],
  );

  const goBackToEmail = useCallback(() => {
    setStep('email');
    setPassword('');
    setMagicCode('');
    setError('');
  }, []);

  const goBackToPassword = useCallback(() => {
    setStep('password');
    setMagicCode('');
    setError('');
  }, []);

  const title = useMemo(() => {
    if (step === 'email') return t('auth.login.titleEmail', 'Get started with Devlane');
    if (step === 'code') return t('auth.login.titleCode', 'Check your email');
    return t('auth.login.titlePassword', 'Welcome back!');
  }, [step, t]);

  const subtitle = useMemo(() => {
    if (step === 'email') return t('auth.login.subtitleEmail', 'Enter your email to continue.');
    if (step === 'code')
      return t(
        'auth.login.subtitleCode',
        'We sent a 6-digit code to your inbox. It expires in 10 minutes.',
      );
    return t('auth.login.subtitlePassword', 'Enter your password to sign in.');
  }, [step, t]);

  return (
    <AuthPageShell mode="sign-in" enableSignup={allowSignup}>
      <div className="w-full max-w-[22.5rem]">
        <h1 className="mb-1 text-2xl font-semibold text-(--txt-primary)">{title}</h1>
        <p className="mb-6 text-sm text-(--txt-secondary)">{subtitle}</p>
        {step === 'email' && isPasswordEnabled && canUseMagicCode && (
          <p className="-mt-4 mb-4 text-xs text-(--txt-tertiary)">
            {t(
              'auth.login.magicHint',
              'After you continue, you can use your password or choose a one-time email code instead.',
            )}
          </p>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'email' && (
          <>
            <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
              <Input
                label={t('common.email', 'Email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('common.emailPlaceholder', 'you@example.com')}
                required
                autoComplete="email"
                autoFocus
              />
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting
                  ? t('common.checking', 'Checking…')
                  : t('auth.login.continueWithEmail', 'Continue with email')}
              </Button>
            </form>
          </>
        )}

        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
            <div>
              <button
                type="button"
                onClick={goBackToEmail}
                className="mb-3 flex items-center gap-1 text-xs text-(--txt-tertiary) hover:text-(--txt-primary)"
              >
                <span>←</span>
                <span>{email}</span>
              </button>
            </div>

            <div className="relative">
              <Input
                label={t('common.password', 'Password')}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.login.passwordPlaceholder', 'Enter password')}
                required
                autoComplete="current-password"
                autoFocus
              />
              <button
                type="button"
                className="absolute top-[2.1rem] right-3 text-(--txt-tertiary) hover:text-(--txt-primary)"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={
                  showPassword
                    ? t('common.hidePassword', 'Hide password')
                    : t('common.showPassword', 'Show password')
                }
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <p className="text-xs text-(--txt-tertiary)">
              {t(
                'auth.login.adminProvisioned',
                'Accounts are created by your administrator. Contact them if you need access or a new password.',
              )}
            </p>

            {canUseMagicCode && isPasswordEnabled && (
              <button
                type="button"
                onClick={() => void switchToMagicCode()}
                disabled={isSubmitting}
                className="w-full text-center text-xs font-medium text-(--txt-accent) hover:underline disabled:opacity-50"
              >
                {t('auth.login.useMagicCode', 'Sign in with email code instead')}
              </button>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting
                ? t('auth.login.signingIn', 'Signing in…')
                : t('common.signIn', 'Sign in')}
            </Button>

            {allowSignup && (
              <p className="text-center text-sm text-(--txt-secondary)">
                {t('auth.login.noAccount', "Don't have an account? ")}
                <Link to="/sign-up" className="font-medium text-(--txt-accent) hover:underline">
                  {t('common.signUp', 'Sign up')}
                </Link>
              </p>
            )}
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleMagicCodeSubmit} className="flex flex-col gap-4">
            <div>
              <button
                type="button"
                onClick={goBackToEmail}
                className="mb-3 flex items-center gap-1 text-xs text-(--txt-tertiary) hover:text-(--txt-primary)"
              >
                <span>←</span>
                <span>{email}</span>
              </button>
            </div>

            <Input
              label={t('auth.login.codeLabel', '6-digit code')}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={magicCode}
              onChange={(e) => setMagicCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              required
              maxLength={6}
              autoFocus={mode === 'sign-in'}
            />

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting
                ? t('common.verifying', 'Verifying…')
                : t('common.continue', 'Continue')}
            </Button>

            <button
              type="button"
              onClick={() => void switchToMagicCode()}
              disabled={isSubmitting}
              className="w-full text-center text-xs text-(--txt-accent) hover:underline disabled:opacity-50"
            >
              {t('auth.login.resendCode', 'Resend code')}
            </button>

            {isPasswordEnabled && (
              <button
                type="button"
                onClick={goBackToPassword}
                className="w-full text-center text-xs text-(--txt-tertiary) hover:text-(--txt-primary)"
              >
                {t('auth.login.usePassword', 'Use password instead')}
              </button>
            )}
          </form>
        )}
      </div>
    </AuthPageShell>
  );
}
