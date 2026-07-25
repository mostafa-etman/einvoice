'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-provider';

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
    formState: { isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-token-lg">
      <h1 className="font-display text-token-xl text-brand">{t('registerTitle')}</h1>
      <form className="mt-token-lg flex flex-col gap-token-md" onSubmit={onSubmit}>
        <label className="text-token-sm">
          {t('name')}
          <input
            className="mt-token-xs w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            type="text"
            autoComplete="name"
            {...register('name')}
          />
        </label>
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
            autoComplete="new-password"
            {...register('password')}
          />
        </label>
        {error ? <p className="text-token-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
        >
          {t('submitRegister')}
        </button>
      </form>
      <p className="mt-token-md text-token-sm">
        {t('haveAccount')}{' '}
        <Link className="text-brand underline" href={`/${locale}/login`}>
          {t('submitLogin')}
        </Link>
      </p>
    </main>
  );
}
