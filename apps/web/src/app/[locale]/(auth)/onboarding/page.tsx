'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createTenant } from '@/lib/api/tenants';
import { fetchCatalog, type PlanView } from '@/lib/api/billing';
import { ApiError } from '@/lib/api/client';
import { PlanCards, PromoNote } from '@/components/billing/plan-cards';
import {
  WhatsAppUpgradeDialog,
  type BillingInterest,
} from '@/components/billing/whatsapp-upgrade-dialog';

const schema = z.object({
  name: z.string().min(2),
});

type FormValues = z.infer<typeof schema>;

export default function OnboardingPage() {
  const t = useTranslations('auth');
  const tb = useTranslations('billing');
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [interest, setInterest] = useState<BillingInterest | null>(null);
  const catalogQuery = useQuery({ queryKey: ['signup-catalog'], queryFn: fetchCatalog });
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await createTenant(values.name);
      router.push(`/${locale}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(typeof err.message === 'string' ? err.message : t('companyLimit'));
        return;
      }
      setError(t('errorGeneric'));
    }
  });

  const choosePlan = (plan: PlanView) => {
    setInterest({
      kind: 'upgrade',
      planCode: plan.code,
      planLabel: locale === 'ar' && plan.nameAr ? plan.nameAr : plan.name,
    });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-token-lg py-token-xl">
      <h1 className="font-display text-token-xl text-brand">{t('onboardingTitle')}</h1>
      <p className="mt-token-sm text-token-sm text-foreground/70">{t('trialHint')}</p>
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

      <section className="mt-token-xl space-y-3">
        <h2 className="text-lg font-medium">{t('choosePlan')}</h2>
        {catalogQuery.data ? <PromoNote catalog={catalogQuery.data} /> : null}
        <PlanCards
          plans={catalogQuery.data?.plans ?? []}
          onChoose={choosePlan}
          chooseLabel={tb('choosePlan')}
        />
      </section>

      <WhatsAppUpgradeDialog
        open={interest !== null}
        interest={interest}
        onClose={() => setInterest(null)}
      />
    </main>
  );
}
