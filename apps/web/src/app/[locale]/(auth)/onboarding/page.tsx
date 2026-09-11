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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BuildingIcon } from '@/components/auth/auth-icons';

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
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });
  const { ref: nameRef, ...nameField } = register('name');
  const { ref: taxRef, ...taxField } = register('taxRegistrationNumber');

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
    <main>
      <h2 className="text-login-title font-bold text-foreground">{t('onboardingTitle')}</h2>
      <p className="mt-token-sm text-token-sm text-foreground-muted">{t('trialHint')}</p>
      <form className="mt-token-lg flex flex-col" onSubmit={onSubmit}>
        <Input
          label={t('tenantName')}
          type="text"
          error={errors.name ? t('fillCompanyFirst') : undefined}
          iconStart={<BuildingIcon />}
          {...nameField}
          ref={nameRef}
        />
        <Input
          label={t('taxRegistrationNumber')}
          type="text"
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          hint={t('taxRegistrationHint')}
          {...taxField}
          ref={taxRef}
        />
        {error ? (
          <p
            className="mb-token-md rounded-md border border-danger/30 bg-danger-muted px-token-sm py-token-sm text-token-sm text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={busy}>
          {tb('startFreeTrial')}
        </Button>
      </form>

      <section className="mt-token-xl space-y-token-sm">
        <h2 className="text-token-lg font-medium text-foreground">{t('choosePlan')}</h2>
        <p className="text-token-sm text-foreground-muted">{t('planBranchHint')}</p>
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
