'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatQuantityDisplay } from '@/lib/format-number';
import type { AddonView, PlanView, PricingCatalog } from '@/lib/api/billing';

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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan) => {
        const isCurrent = plan.code === currentPlanCode;
        const isTrial = Boolean(plan.isTrial);
        const name = locale === 'ar' && plan.nameAr ? plan.nameAr : plan.name;
        return (
          <article
            key={plan.code}
            className={`flex flex-col rounded border p-4 ${
              isCurrent ? 'border-brand ring-1 ring-brand' : 'border-border'
            }`}
          >
            <h3 className="text-lg font-semibold">{name}</h3>
            <p className="mt-2 flex flex-wrap items-baseline gap-2">
              {isTrial ? (
                <span className="text-2xl font-semibold text-brand">
                  {t('trialCardPrice', { days: trialDays ?? 7 })}
                </span>
              ) : (
                <>
                  {plan.officialPriceEgp > 0 ? (
                    <span className="text-sm text-muted-foreground line-through" dir="ltr">
                      {formatEgp(plan.officialPriceEgp, locale)}
                    </span>
                  ) : null}
                  <span className="text-2xl font-semibold text-brand" dir="ltr">
                    {formatEgp(plan.discountedPriceEgp || plan.officialPriceEgp, locale)}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('perYear')}</span>
                </>
              )}
            </p>
            {!isTrial && plan.savingsPercent > 0 ? (
              <p className="mt-1 text-sm font-medium text-green-700" dir="ltr">
                {t('savePercent', { percent: plan.savingsPercent })}
              </p>
            ) : null}
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              <li dir="ltr">
                {t('cardPoints', { points: formatQuantityDisplay(plan.includedPoints) })}
              </li>
              <li dir="ltr">{t('cardUsers', { count: plan.maxUsers })}</li>
              <li dir="ltr">{t('cardCompanies', { count: plan.maxCompanies })}</li>
              <li dir="ltr">
                {t('cardCapacity', { count: formatQuantityDisplay(plan.docCapacity) })}
              </li>
            </ul>
            <div className="mt-4">
              {isCurrent ? (
                <span className="text-sm font-medium text-brand">{t('current')}</span>
              ) : (
                <button
                  type="button"
                  className="w-full rounded bg-brand px-3 py-2 text-sm text-white"
                  onClick={() => onChoose(plan)}
                >
                  {isTrial
                    ? (startTrialLabel ?? t('startFreeTrial'))
                    : (chooseLabel ?? t('choosePlan'))}
                </button>
              )}
            </div>
          </article>
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
    <div className="grid gap-3 sm:grid-cols-3">
      {addons.map((addon) => {
        const name = locale === 'ar' && addon.nameAr ? addon.nameAr : addon.name;
        return (
          <article key={addon.code} className="flex flex-col rounded border border-border p-4">
            <h3 className="font-medium">{name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {locale === 'ar' && addon.descriptionAr ? addon.descriptionAr : addon.descriptionEn}
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-sm text-muted-foreground line-through" dir="ltr">
                {formatEgp(addon.officialPriceEgp, locale)}
              </span>
              <span className="text-lg font-semibold text-brand" dir="ltr">
                {formatEgp(addon.discountedPriceEgp, locale)}
              </span>
            </p>
            <button
              type="button"
              className="mt-3 rounded border px-3 py-2 text-sm"
              onClick={() => onChoose(addon)}
            >
              {t('requestAddon')}
            </button>
          </article>
        );
      })}
    </div>
  );
}

export function PromoNote({ catalog }: { catalog: PricingCatalog }) {
  const t = useTranslations('billing');
  return (
    <p className="text-sm text-muted-foreground">
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
