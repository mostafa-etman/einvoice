'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-provider';
import { establishTenantContext } from '@/lib/establish-tenant-context';
import { useMutationToast } from '@/components/ui/use-mutation-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthPasswordField } from '@/components/auth/auth-password-field';
import { ArrowIcon, MailIcon } from '@/components/auth/auth-icons';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const { login, user, ready } = useAuth();
  const toast = useMutationToast();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const { ref: emailRef, ...emailField } = register('email');
  const passwordField = register('password');

  useEffect(() => {
    if (ready && user) {
      router.replace(`/${locale}`);
    }
  }, [ready, user, locale, router]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values);
      const { needsOnboarding, promptEtaSetup } = await establishTenantContext();
      if (needsOnboarding) {
        router.replace(`/${locale}/onboarding`);
        return;
      }
      if (promptEtaSetup) {
        router.replace(`/${locale}/settings/eta-credentials`);
        return;
      }
      router.replace(`/${locale}`);
    } catch {
      setError(t('errorGeneric'));
      toast.error(undefined, t('errorGeneric'));
    }
  });

  return (
    <main>
      <h2 className="text-login-title font-bold text-foreground">{t('loginTitle')}</h2>
      <p className="mb-token-xl mt-token-sm text-token-sm text-foreground-muted">{t('loginSubtitle')}</p>
      <form className="flex flex-col" onSubmit={onSubmit}>
        <Input
          label={t('email')}
          type="email"
          autoComplete="email"
          error={errors.email ? t('invalidEmail') : undefined}
          iconStart={<MailIcon />}
          {...emailField}
          ref={emailRef}
        />
        <AuthPasswordField
          registration={passwordField}
          error={errors.password ? t('passwordTooShort') : undefined}
          autoComplete="current-password"
        />
        <div className="mb-token-lg flex items-center justify-end text-token-sm">
          <button
            type="button"
            disabled
            className="cursor-not-allowed text-brand/50"
            title={t('forgotPasswordUnavailable')}
            aria-label={`${t('forgotPassword')} — ${t('forgotPasswordUnavailable')}`}
          >
            {t('forgotPassword')}
          </button>
        </div>
        {error ? (
          <p
            className="mb-token-md rounded-md border border-danger/30 bg-danger-muted px-token-sm py-token-sm text-token-sm text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={isSubmitting} iconEnd={<ArrowIcon />}>
          {t('loginCta')}
        </Button>
        <p className="mt-token-lg text-center text-token-sm text-foreground-muted">
          {t.rich('securityFootnote', {
            tls: (chunks) => <strong className="text-foreground">{chunks}</strong>,
            pdpl: (chunks) => <strong className="text-foreground">{chunks}</strong>,
          })}
        </p>
      </form>
      <p className="mt-token-md text-center text-token-sm text-foreground-muted">
        {t('needAccount')}{' '}
        <Link className="font-medium text-brand" href={`/${locale}/register`}>
          {t('submitRegister')}
        </Link>
      </p>
    </main>
  );
}
