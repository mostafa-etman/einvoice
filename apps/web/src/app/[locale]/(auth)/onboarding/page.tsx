'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createTenant } from '@/lib/api/tenants';
import { fetchCatalog, type PlanView } from '@/lib/api/billing';
import { ApiError } from '@/lib/api/client';
import { trialAlreadyUsedMessage } from '@/lib/api/trial-already-used';
import { PlanCards, PromoNote } from '@/components/billing/plan-cards';

const schema = z.object({
  name: z.string().min(2),
  taxRegistrationNumber: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function OnboardingPage() {
  const t = useTranslations('auth');
  const tb = useTranslations('billing');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const catalogQuery = useQuery({ queryKey: ['signup-catalog'], queryFn: fetchCatalog });
  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const busy = isSubmitting || choosing;

  const startCompany = async (plan?: PlanView) => {
    setError(null);
    const ok = await trigger('name');
    if (!ok) {
      setError(t('fillCompanyFirst'));
      return;
    }
    const values = getValues();
    try {
      setChoosing(true);
      const created = await createTenant(values.name, {
        planCode: plan?.code,
        taxRegistrationNumber: values.taxRegistrationNumber?.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      if (created.activationStatus === 'ACTIVE') {
        router.push(`/${locale}/settings/eta-credentials`);
      } else {
        router.push(`/${locale}`);
      }
    } catch (err) {
      const trialMsg = trialAlreadyUsedMessage(err, locale);
      if (trialMsg) {
        setError(trialMsg);
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        setError(typeof err.message === 'string' ? err.message : t('companyLimit'));
        return;
      }
      setError(t('errorGeneric'));
    } finally {
      setChoosing(false);
    }
  };

  const onSubmit = handleSubmit(async () => {
    const trial = catalogQuery.data?.plans.find((p) => p.isTrial);
    await startCompany(trial);
  });

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
        <label className="text-token-sm">
          {t('taxRegistrationNumber')}
          <input
            className="mt-token-xs w-full rounded border border-border bg-surface px-token-sm py-token-sm"
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            {...register('taxRegistrationNumber')}
          />
          <span className="mt-token-xs block text-token-xs text-foreground/70">
            {t('taxRegistrationHint')}
          </span>
        </label>
        {error ? (
          <p className="text-token-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-brand px-token-md py-token-sm text-white disabled:opacity-60"
        >
          {tb('startFreeTrial')}
        </button>
      </form>

      <section className="mt-token-xl space-y-3">
        <h2 className="text-lg font-medium">{t('choosePlan')}</h2>
        <p className="text-sm text-foreground/70">{t('planBranchHint')}</p>
        {catalogQuery.data ? <PromoNote catalog={catalogQuery.data} /> : null}
        <PlanCards
          plans={catalogQuery.data?.plans ?? []}
          onChoose={(plan) => void startCompany(plan)}
          chooseLabel={tb('subscribeWhatsApp')}
          startTrialLabel={tb('startFreeTrial')}
          trialDays={catalogQuery.data?.trialDays}
        />
      </section>
    </main>
  );
}
