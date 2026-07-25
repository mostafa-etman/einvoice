'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { createTenant } from '@/lib/api/tenants';

const schema = z.object({
  name: z.string().min(2),
});

type FormValues = z.infer<typeof schema>;

export default function OnboardingPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await createTenant(values.name);
      router.push(`/${locale}`);
    } catch {
      setError(t('errorGeneric'));
    }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-token-lg">
      <h1 className="font-display text-token-xl text-brand">{t('onboardingTitle')}</h1>
      <form className="mt-token-lg flex flex-col gap-token-md" onSubmit={onSubmit}>
        <label className="text-token-sm">
          {t('tenantName')}
          <input
            className="mt-token-xs w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            type="text"
            {...register('name')}
          />
        </label>
        {error ? <p className="text-token-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
        >
          {t('submitTenant')}
        </button>
      </form>
    </main>
  );
}
