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
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (ready && user) {
      router.replace(`/${locale}`);
    }
  }, [ready, user, locale, router]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values);
      const { needsOnboarding } = await establishTenantContext();
      if (needsOnboarding) {
        router.replace(`/${locale}/onboarding`);
        return;
      }
      router.replace(`/${locale}`);
    } catch {
      setError(t('errorGeneric'));
    }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-token-lg">
      <h1 className="font-display text-token-xl text-brand">{t('loginTitle')}</h1>
      <form className="mt-token-lg flex flex-col gap-token-md" onSubmit={onSubmit}>
        <label className="text-token-sm">
          {t('email')}
          <input
            className="mt-token-xs w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            type="email"
            autoComplete="email"
            {...register('email')}
          />
        </label>
        <label className="text-token-sm">
          {t('password')}
          <input
            className="mt-token-xs w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        </label>
        {error ? <p className="text-token-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
        >
          {t('submitLogin')}
        </button>
      </form>
      <p className="mt-token-md text-token-sm">
        {t('needAccount')}{' '}
        <Link className="text-brand underline" href={`/${locale}/register`}>
          {t('submitRegister')}
        </Link>
      </p>
    </main>
  );
}
