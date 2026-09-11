'use client';

import { useTranslations } from 'next-intl';
import { XiraLogo } from '@/components/brand/xira-logo';
import { CheckCircleIcon } from './auth-icons';

const CHIP_KEYS = ['chipEinvoicing', 'chipGateway', 'chipErp', 'chipPos'] as const;

export function AuthHero() {
  const t = useTranslations('auth');

  return (
    <section className="auth-hero flex min-h-hero-sm flex-col px-hero-x-sm py-hero-y-sm lg:min-h-screen lg:px-hero-x lg:py-hero-y">
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <div className="mb-token-2xl">
          <XiraLogo variant="on-dark" />
        </div>
        <div className="mb-token-lg inline-flex w-fit items-center gap-token-sm rounded-pill border border-[color:var(--color-hero-tag-border)] bg-[color:var(--color-hero-tag-bg)] px-token-md py-token-xs text-hero-tag font-medium text-brand-teal">
          <CheckCircleIcon />
          {t('heroTag')}
        </div>
        <h1 className="mb-token-md max-w-xl text-hero-title-sm font-bold leading-tight text-on-dark lg:text-hero-title">
          {t.rich('heroTitle', {
            grad: (chunks) => <span className="auth-hero-grad">{chunks}</span>,
            br: () => <br />,
          })}
        </h1>
        <p className="mb-token-xl max-w-xl text-token-sm text-on-dark-muted lg:text-token-md">{t('heroDesc')}</p>
        <div className="mb-token-lg flex flex-wrap gap-token-sm">
          {CHIP_KEYS.map((key) => (
            <span
              key={key}
              className="rounded-pill border border-[color:var(--color-hero-chip-border)] bg-[color:var(--color-hero-chip-bg)] px-token-sm py-token-2xs font-en text-hero-chip text-on-dark"
            >
              {t(key)}
            </span>
          ))}
        </div>
        <div className="mt-auto grid grid-cols-2 gap-token-sm lg:grid-cols-4">
          {(
            [
              { key: 'erp', teal: false },
              { key: 'eta', teal: true },
              { key: 'invoices', teal: false },
              { key: 'load', teal: true },
            ] as const
          ).map((stat) => (
            <div
              key={stat.key}
              className="rounded-lg border border-border-dark bg-[color:var(--color-hero-stat-bg)] p-token-md backdrop-blur-sm"
            >
              <div className="mb-token-2xs text-nav-group font-semibold uppercase tracking-nav-group text-on-dark-muted">
                {t(`stats.${stat.key}.label`)}
              </div>
              <div className={stat.teal ? 'font-en text-hero-stat font-bold text-brand-teal' : 'font-en text-hero-stat font-bold text-on-dark'}>
                {t(`stats.${stat.key}.value`)}
              </div>
              <div className="text-hero-chip text-brand-teal">{t(`stats.${stat.key}.sub`)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
