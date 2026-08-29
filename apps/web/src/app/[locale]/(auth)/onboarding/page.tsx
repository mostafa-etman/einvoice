'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createTenant } from '@/lib/api/tenants';
import { fetchPlans } from '@/lib/api/billing';

const schema = z.object({
  name: z.string().min(2),
  planCode: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export default function OnboardingPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const plansQuery = useQuery({ queryKey: ['signup-plans'], queryFn: fetchPlans });
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { planCode: 'FREE' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await createTenant(values.name, values.planCode);
      router.push(`/${locale}`);
    } catch {
      setError(t('errorGeneric'));
    }
  });

  const plans = plansQuery.data?.plans ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-token-lg">
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
        <fieldset className="space-y-2">
          <legend className="text-token-sm">{t('choosePlan')}</legend>
          {plans.map((plan) => (
            <label
              key={plan.code}
              className="flex cursor-pointer items-start gap-token-sm rounded border border-border bg-surface p-token-sm"
            >
              <input type="radio" value={plan.code} {...register('planCode')} className="mt-1" />
              <span>
                <span className="block font-medium">{locale === 'ar' ? plan.nameAr : plan.name}</span>
                <span className="block text-token-xs text-foreground/70">
                  {t('planMeta', {
                    documents: plan.documentQuota,
                    branches: plan.branchQuota,
                    devices: plan.deviceQuota,
                    points: plan.includedPoints,
                  })}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {error ? <p className="text-token-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting || plansQuery.isLoading}
          className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
        >
          {t('submitTenant')}
        </button>
      </form>
    </main>
  );
}
