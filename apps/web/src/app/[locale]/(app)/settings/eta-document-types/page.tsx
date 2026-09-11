'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEtaDocumentTypeVersions,
  listEtaDocumentTypes,
} from '@/lib/api/eta';
import { useTenant } from '@/lib/tenant-provider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, type TableColumn } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageHeader } from '../_components/settings-page-header';
import { QueryErrorCard } from '@/components/ui/query-error-card';

type DocTypeRow = {
  id: string;
  label: string;
  raw: Record<string, unknown>;
};

export default function EtaDocumentTypesPage() {
  const t = useTranslations('settingsEtaDocTypes');
  const tRetry = useTranslations('common.actions');
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
  const rows: DocTypeRow[] = items.map((item, idx) => {
    const id = String(item.documentTypeId ?? item.id ?? item.typeName ?? idx);
    const label = String(
      item.descriptionPrimaryLang ??
        item.description ??
        item.documentTypeNamePrimaryLang ??
        id,
    );
    return { id, label, raw: item };
  });

  const columns: TableColumn<DocTypeRow>[] = [
    {
      id: 'label',
      header: t('title'),
      cell: (row) => (
        <Button type="button" variant="link" onClick={() => setSelected(row.id)}>
          {row.label} ({row.id})
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-token-lg">
      <SettingsPageHeader
        title={t('title')}
        subtitle={t('intro')}
        actions={
          <Button type="button" variant="secondary" onClick={() => void refresh()}>
            {t('refresh')}
          </Button>
        }
      />

      {types.data ? (
        <p className="text-token-sm text-foreground-muted">
          {t('fetchedAt')}: {types.data.fetchedAt}
          {types.data.fromCache ? ` (${t('fromCache')})` : ''}
        </p>
      ) : null}

      {types.isError ? (
        <QueryErrorCard
          message={types.error instanceof Error ? types.error.message : tRetry('retry')}
          retryLabel={tRetry('retry')}
          onRetry={() => void types.refetch()}
        />
      ) : types.isLoading ? (
        <Card aria-busy="true">
          <Skeleton />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('empty')}
          action={{ label: t('refresh'), onClick: () => void refresh() }}
        />
      ) : (
        <Table
          caption={t('title')}
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
        />
      )}

      {selected ? (
        <Card>
          <h2 className="m-0 text-token-md font-semibold text-foreground">
            {t('versions')}: {selected}
          </h2>
          {versions.isLoading ? (
            <div className="mt-token-sm" aria-busy="true">
              <Skeleton />
            </div>
          ) : (
            <ul className="mt-token-sm flex flex-col gap-token-xs overflow-x-auto text-token-sm">
              {(versions.data?.items ?? []).map((v, i) => (
                <li key={i} className="font-en" dir="ltr">
                  {JSON.stringify(v)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
