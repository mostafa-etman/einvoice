'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatQuantityDisplay } from '@/lib/format-number';
import type { AddonView, PlanView, PricingCatalog } from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

function formatEgp(value: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    maximumFractionDigits: 0,
  }).format(value);
  return `${formatted} EGP`;
}

export function PlanCards({
  plans,
  currentPlanCode,
  onChoose,
  chooseLabel,
  startTrialLabel,
  trialDays,
}: {
  plans: PlanView[];
  currentPlanCode?: string | null;
  onChoose: (plan: PlanView) => void;
  chooseLabel?: string;
  startTrialLabel?: string;
  trialDays?: number;
}) {
  const t = useTranslations('billing');
  const locale = useLocale();

  return (
    <div className="grid gap-token-md sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan) => {
        const isCurrent = plan.code === currentPlanCode;
        const isTrial = Boolean(plan.isTrial);
        const name = locale === 'ar' && plan.nameAr ? plan.nameAr : plan.name;
        return (
          <Card
            key={plan.code}
            className={cn('flex flex-col', isCurrent && 'border-brand')}
          >
            <h3 className="m-0 text-token-lg font-semibold text-foreground">{name}</h3>
            <p className="mt-token-sm flex flex-wrap items-baseline gap-token-sm">
              {isTrial ? (
                <span className="text-token-xl font-semibold text-brand">
                  {t('trialCardPrice', { days: trialDays ?? 7 })}
                </span>
              ) : (
                <>
                  {plan.officialPriceEgp > 0 ? (
                    <span className="text-token-sm text-foreground-muted line-through" dir="ltr">
                      {formatEgp(plan.officialPriceEgp, locale)}
                    </span>
                  ) : null}
                  <span className="text-token-xl font-semibold text-brand" dir="ltr">
                    {formatEgp(plan.discountedPriceEgp || plan.officialPriceEgp, locale)}
                  </span>
                  <span className="text-token-xs text-foreground-muted">{t('perYear')}</span>
                </>
              )}
            </p>
            {!isTrial && plan.savingsPercent > 0 ? (
              <p className="mt-token-2xs text-token-sm font-medium text-success">
                {t('savePercent', { percent: plan.savingsPercent })}
              </p>
            ) : null}
            <ul className="mt-token-sm space-y-token-2xs text-token-sm text-foreground-muted">
              <li>{t('cardPoints', { points: formatQuantityDisplay(plan.includedPoints) })}</li>
              <li>{t('cardUsers', { count: plan.maxUsers })}</li>
              <li>{t('cardCompanies', { count: plan.maxCompanies })}</li>
              <li>{t('cardCapacity', { count: formatQuantityDisplay(plan.docCapacity) })}</li>
            </ul>
            <div className="mt-token-md">
              {isCurrent ? (
                <span className="text-token-sm font-medium text-brand">{t('current')}</span>
              ) : (
                <Button type="button" block onClick={() => onChoose(plan)}>
                  {isTrial
                    ? (startTrialLabel ?? t('startFreeTrial'))
                    : (chooseLabel ?? t('choosePlan'))}
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function AddonCards({
  addons,
  onChoose,
}: {
  addons: AddonView[];
  onChoose: (addon: AddonView) => void;
}) {
  const t = useTranslations('billing');
  const locale = useLocale();
  return (
    <div className="grid gap-token-md sm:grid-cols-3">
      {addons.map((addon) => {
        const name = locale === 'ar' && addon.nameAr ? addon.nameAr : addon.name;
        return (
          <Card key={addon.code} className="flex flex-col">
            <h3 className="m-0 font-medium text-foreground">{name}</h3>
            <p className="mt-token-2xs text-token-sm text-foreground-muted">
              {locale === 'ar' && addon.descriptionAr ? addon.descriptionAr : addon.descriptionEn}
            </p>
            <p className="mt-token-sm flex items-baseline gap-token-sm">
              <span className="text-token-sm text-foreground-muted line-through" dir="ltr">
                {formatEgp(addon.officialPriceEgp, locale)}
              </span>
              <span className="text-token-lg font-semibold text-brand" dir="ltr">
                {formatEgp(addon.discountedPriceEgp, locale)}
              </span>
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-token-sm"
              block
              onClick={() => onChoose(addon)}
            >
              {t('requestAddon')}
            </Button>
          </Card>
        );
      })}
    </div>
  );
}

export function PromoNote({ catalog }: { catalog: PricingCatalog }) {
  const t = useTranslations('billing');
  return (
    <p className="text-token-sm text-foreground-muted">
      {t('promoNote', {
        invoicePromo: catalog.costs.invoicePromo,
        invoiceStandard: catalog.costs.invoiceStandard,
        receipt: catalog.costs.receipt,
        trialDays: catalog.trialDays,
        trialPoints: catalog.trialPoints,
      })}
    </p>
  );
}
