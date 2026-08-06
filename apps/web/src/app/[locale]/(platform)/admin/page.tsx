'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import {
  activateTenant,
  assignPlan,
  breakGlass,
  endImpersonation,
  getTenant,
  getTenantUsage,
  listTenants,
  provisionTenant,
  startImpersonation,
  suspendTenant,
  type ImpersonationSessionView,
  type TenantDetail,
} from '@/lib/api/platform-admin';
import type { PlanCode } from '@/lib/api/billing';

const PLAN_CODES: PlanCode[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];

function TenantDetailPanel({
  tenantId,
  onClose,
}: {
  tenantId: string;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const qc = useQueryClient();
  const [session, setSession] = useState<ImpersonationSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['platform-admin-tenant', tenantId],
    queryFn: () => getTenant(tenantId),
  });
  const usageQuery = useQuery({
    queryKey: ['platform-admin-tenant-usage', tenantId],
    queryFn: () => getTenantUsage(tenantId),
  });

  const impersonateMut = useMutation({
    mutationFn: () => {
      const reason = window.prompt(t('impersonateReasonPrompt')) || '';
      if (!reason) throw new Error('reason_required');
      const detail = detailQuery.data as TenantDetail;
      if (!detail.ownerId) throw new Error('no_owner');
      return startImpersonation({ tenantId, targetUserId: detail.ownerId, reason });
    },
    onSuccess: (s) => {
      setError(null);
      setSession(s);
      // eslint-disable-next-line no-console
      console.info('Impersonation access token (dev only):', s.accessToken);
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('error')),
  });

  const breakGlassMut = useMutation({
    mutationFn: () => {
      if (!session) throw new Error('no_session');
      const reason = window.prompt(t('impersonateReasonPrompt')) || '';
      if (!reason) throw new Error('reason_required');
      return breakGlass(session.id, reason);
    },
    onSuccess: (s) => setSession(s),
    onError: (e) => setError(e instanceof Error ? e.message : t('error')),
  });

  const endMut = useMutation({
    mutationFn: () => {
      if (!session) throw new Error('no_session');
      return endImpersonation(session.id);
    },
    onSuccess: () => setSession(null),
  });

  const planMut = useMutation({
    mutationFn: (input: { planCode?: PlanCode; reason: string }) =>
      assignPlan(tenantId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-admin-tenant', tenantId] });
      void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('error')),
  });

  const detail = detailQuery.data;
  const usage = usageQuery.data;

  return (
    <div className="space-y-4 rounded border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('detailsTitle')}</h2>
        <button type="button" className="text-sm text-brand underline" onClick={onClose}>
          {t('back')}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {!detail ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : (
        <>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('colName')}</dt>
              <dd className="font-medium">{detail.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('owner')}</dt>
              <dd className="font-medium">{detail.ownerEmail ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('colPlan')}</dt>
              <dd className="font-medium">{detail.planCode ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('colStatus')}</dt>
              <dd className="font-medium">{detail.status ?? '—'}</dd>
            </div>
          </dl>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">{t('entitlements')}</h3>
            <p className="text-sm">
              {detail.entitlements.documentQuota} docs · {detail.entitlements.branchQuota} branches ·{' '}
              {detail.entitlements.deviceQuota} devices
              {detail.entitlements.overrideActive ? ' (override active)' : ''}
            </p>
          </div>

          {usage ? (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">{t('usage')}</h3>
              <p className="text-sm">
                {usage.quotas.documents.used}/{usage.quotas.documents.limit} docs ·{' '}
                {usage.quotas.branches.used}/{usage.quotas.branches.limit} branches ·{' '}
                {usage.quotas.devices.used}/{usage.quotas.devices.limit} devices
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              {t('planCode')}
              <select
                className="rounded border px-2 py-1"
                value={detail.planCode ?? ''}
                onChange={(e) => {
                  const reason = window.prompt(t('reason')) || '';
                  if (!reason) return;
                  planMut.mutate({ planCode: e.target.value as PlanCode, reason });
                }}
              >
                {PLAN_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {!session ? (
              <button
                type="button"
                className="rounded bg-brand px-3 py-2 text-sm text-white"
                disabled={impersonateMut.isPending || !detail.ownerId}
                onClick={() => impersonateMut.mutate()}
              >
                {t('impersonate')}
              </button>
            ) : (
              <>
                <span className="text-sm text-muted-foreground">
                  {t('impersonationActive', { mode: session.mode })}
                </span>
                {session.mode === 'READ_ONLY' ? (
                  <button
                    type="button"
                    className="rounded border px-3 py-2 text-sm"
                    disabled={breakGlassMut.isPending}
                    onClick={() => breakGlassMut.mutate()}
                  >
                    {t('breakGlass')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded border px-3 py-2 text-sm"
                  disabled={endMut.isPending}
                  onClick={() => endMut.mutate()}
                >
                  {t('endImpersonation')}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function PlatformAdminPage() {
  const t = useTranslations('admin');
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [form, setForm] = useState({
    name: '',
    ownerEmail: '',
    ownerName: '',
    planCode: 'FREE' as PlanCode,
    reason: '',
  });

  const tenantsQuery = useQuery({
    queryKey: ['platform-admin-tenants', q],
    queryFn: () => listTenants({ q: q || undefined }),
    retry: false,
  });

  useEffect(() => {
    if (tenantsQuery.error instanceof ApiError && tenantsQuery.error.status === 403) {
      setAccessDenied(true);
    }
  }, [tenantsQuery.error]);

  const provisionMut = useMutation({
    mutationFn: () => provisionTenant(form),
    onSuccess: () => {
      setShowProvision(false);
      setForm({ name: '', ownerEmail: '', ownerName: '', planCode: 'FREE', reason: '' });
      void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });
    },
  });

  const suspendMut = useMutation({
    mutationFn: (tenantId: string) => {
      const reason = window.prompt(t('suspendReasonPrompt')) || '';
      if (!reason) throw new Error('reason_required');
      return suspendTenant(tenantId, reason);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] }),
  });

  const activateMut = useMutation({
    mutationFn: (tenantId: string) => activateTenant(tenantId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] }),
  });

  if (accessDenied) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {t('accessDenied')}
      </div>
    );
  }

  if (selectedTenantId) {
    return (
      <TenantDetailPanel tenantId={selectedTenantId} onClose={() => setSelectedTenantId(null)} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex flex-col text-sm">
          <span>{t('search')}</span>
          <input
            className="rounded border px-2 py-1"
            placeholder={t('searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded bg-brand px-3 py-2 text-sm text-white"
          onClick={() => setShowProvision((v) => !v)}
        >
          {t('provision')}
        </button>
      </div>

      {showProvision ? (
        <form
          className="grid gap-3 rounded border border-border bg-background p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            provisionMut.mutate();
          }}
        >
          <h2 className="col-span-full text-lg font-medium">{t('provisionTitle')}</h2>
          <label className="flex flex-col text-sm">
            {t('tenantName')}
            <input
              required
              className="rounded border px-2 py-1"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="flex flex-col text-sm">
            {t('ownerEmail')}
            <input
              required
              type="email"
              className="rounded border px-2 py-1"
              value={form.ownerEmail}
              onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))}
            />
          </label>
          <label className="flex flex-col text-sm">
            {t('ownerName')}
            <input
              className="rounded border px-2 py-1"
              value={form.ownerName}
              onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
            />
          </label>
          <label className="flex flex-col text-sm">
            {t('planCode')}
            <select
              className="rounded border px-2 py-1"
              value={form.planCode}
              onChange={(e) => setForm((f) => ({ ...f, planCode: e.target.value as PlanCode }))}
            >
              {PLAN_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-full flex flex-col text-sm">
            {t('reason')}
            <input
              className="rounded border px-2 py-1"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </label>
          {provisionMut.isError ? (
            <p className="col-span-full text-sm text-red-600">
              {provisionMut.error instanceof Error ? provisionMut.error.message : t('error')}
            </p>
          ) : null}
          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              className="rounded bg-brand px-3 py-2 text-sm text-white"
              disabled={provisionMut.isPending}
            >
              {t('create')}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              onClick={() => setShowProvision(false)}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="p-2">{t('colName')}</th>
              <th className="p-2">{t('colPlan')}</th>
              <th className="p-2">{t('colStatus')}</th>
              <th className="p-2">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {(tenantsQuery.data?.items ?? []).map((tenant) => (
              <tr key={tenant.id} className="border-b">
                <td className="p-2">{tenant.name}</td>
                <td className="p-2">{tenant.planCode ?? '—'}</td>
                <td className="p-2">
                  {tenant.suspendedAt ? (
                    <span className="text-red-700">{tenant.status ?? 'SUSPENDED'}</span>
                  ) : (
                    tenant.status ?? '—'
                  )}
                </td>
                <td className="flex flex-wrap gap-2 p-2">
                  <button
                    type="button"
                    className="text-brand underline"
                    onClick={() => setSelectedTenantId(tenant.id)}
                  >
                    {t('viewDetails')}
                  </button>
                  {tenant.suspendedAt ? (
                    <button
                      type="button"
                      className="text-brand underline"
                      onClick={() => activateMut.mutate(tenant.id)}
                    >
                      {t('activate')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-red-700 underline"
                      onClick={() => suspendMut.mutate(tenant.id)}
                    >
                      {t('suspend')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!tenantsQuery.data?.items?.length ? (
              <tr>
                <td className="p-4 text-muted-foreground" colSpan={4}>
                  {tenantsQuery.isLoading ? t('loading') : t('empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
