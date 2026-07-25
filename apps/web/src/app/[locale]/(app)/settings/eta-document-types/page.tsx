'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEtaDocumentTypeVersions,
  listEtaDocumentTypes,
} from '@/lib/api/eta';
import { useTenant } from '@/lib/tenant-provider';

export default function EtaDocumentTypesPage() {
  const t = useTranslations('settingsEtaDocTypes');
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const types = useQuery({
    queryKey: ['eta-doc-types', tenantId],
    queryFn: () => listEtaDocumentTypes(false),
    enabled: !!tenantId,
  });

  const versions = useQuery({
    queryKey: ['eta-doc-versions', tenantId, selected],
    queryFn: () => getEtaDocumentTypeVersions(selected!),
    enabled: !!tenantId && !!selected,
  });

  async function refresh() {
    await listEtaDocumentTypes(true);
    await qc.invalidateQueries({ queryKey: ['eta-doc-types', tenantId] });
    if (selected) {
      await getEtaDocumentTypeVersions(selected, true);
      await qc.invalidateQueries({
        queryKey: ['eta-doc-versions', tenantId, selected],
      });
    }
  }

  const items = types.data?.items ?? [];

  return (
    <section>
      <h1 className="font-display text-token-xl">{t('title')}</h1>
      <p className="mt-token-sm text-token-md text-foreground/70">{t('intro')}</p>
      <button
        type="button"
        className="mt-token-md rounded border border-border px-token-md py-token-sm text-token-sm"
        onClick={() => void refresh()}
      >
        {t('refresh')}
      </button>

      {types.data ? (
        <p className="mt-token-sm text-token-sm text-foreground/60">
          {t('fetchedAt')}: {types.data.fetchedAt}
          {types.data.fromCache ? ` (${t('fromCache')})` : ''}
        </p>
      ) : null}

      {items.length === 0 && !types.isLoading ? (
        <p className="mt-token-lg text-token-sm">{t('empty')}</p>
      ) : (
        <ul className="mt-token-lg flex flex-col gap-token-sm">
          {items.map((item, idx) => {
            const id = String(
              item.documentTypeId ?? item.id ?? item.typeName ?? idx,
            );
            const label = String(
              item.descriptionPrimaryLang ??
                item.description ??
                item.documentTypeNamePrimaryLang ??
                id,
            );
            return (
              <li key={id}>
                <button
                  type="button"
                  className="text-token-md text-brand underline-offset-2 hover:underline"
                  onClick={() => setSelected(id)}
                >
                  {label} ({id})
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <div className="mt-token-xl">
          <h2 className="text-token-lg">
            {t('versions')}: {selected}
          </h2>
          <ul className="mt-token-sm flex flex-col gap-token-xs text-token-sm">
            {(versions.data?.items ?? []).map((v, i) => (
              <li key={i}>{JSON.stringify(v)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
