import type { ReactNode } from 'react';
import type { useTranslations } from 'next-intl';
import { Card, CardTitle } from '@/components/ui/card';
import { partyTypeLabel } from '@/lib/eta-display';
import { formatAddress, partyField } from './purchase-tax';

export function PurchasePartyCard({
  title,
  party,
  fallbackName,
  fallbackType,
  fallbackId,
  t,
  locale,
}: {
  title: string;
  party: unknown;
  fallbackName?: string | null;
  fallbackType?: string | null;
  fallbackId?: string | null;
  t: ReturnType<typeof useTranslations<'purchases'>>;
  locale: string;
}) {
  const name = partyField(party, 'name') || fallbackName || '—';
  const typeCode = partyField(party, 'type') || fallbackType || '';
  const type = partyTypeLabel(typeCode, locale === 'ar' ? 'ar' : 'en');
  const id = partyField(party, 'id') || fallbackId || '—';
  const address = formatAddress(party);

  return (
    <Card className="space-y-token-sm">
      <CardTitle>{title}</CardTitle>
      <dl className="grid grid-cols-1 gap-token-xs text-token-sm sm:grid-cols-2">
        <div>
          <dt className="text-foreground-muted">{t('partyName')}</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">{t('partyType')}</dt>
          <dd>{type}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-foreground-muted">{t('partyId')}</dt>
          <dd className="break-all font-en text-token-xs" dir="ltr">
            {id}
          </dd>
        </div>
        {address ? (
          <div className="sm:col-span-2">
            <dt className="text-foreground-muted">{t('address')}</dt>
            <dd>{address}</dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}

export function Ltr({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="inline-block font-en tabular-nums">
      {children}
    </span>
  );
}
