'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuthPasswordField } from '@/components/auth/auth-password-field';
import { MailIcon, UserIcon } from '@/components/auth/auth-icons';

const schema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const { register: registerUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const { ref: nameRef, ...nameField } = register('name');
  const { ref: emailRef, ...emailField } = register('email');
  const passwordField = register('password');
  const passwordValue = watch('password') ?? '';

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await registerUser(values);
      router.push(`/${locale}/onboarding`);
    } catch {
      setError(t('errorGeneric'));
    }
  });

  return (
    <main>
      <h2 className="text-login-title font-bold text-foreground">{t('registerTitle')}</h2>
      <p className="mb-token-xl mt-token-sm text-token-sm text-foreground-muted">{t('registerSubtitle')}</p>
      <form className="flex flex-col" onSubmit={onSubmit}>
        <Input
          label={t('name')}
          type="text"
          autoComplete="name"
          iconStart={<UserIcon />}
          {...nameField}
          ref={nameRef}
        />
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
          autoComplete="new-password"
          showStrength
          value={passwordValue}
        />
        {error ? (
          <p
            className="mb-token-md rounded-md border border-danger/30 bg-danger-muted px-token-sm py-token-sm text-token-sm text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          {t('submitRegister')}
        </Button>
      </form>
      <p className="mt-token-md text-center text-token-sm text-foreground-muted">
        {t('haveAccount')}{' '}
        <Link className="font-medium text-brand" href={`/${locale}/login`}>
          {t('submitLogin')}
        </Link>
      </p>
    </main>
  );
}
