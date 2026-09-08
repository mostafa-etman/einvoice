'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import {
  activateTenant,
  adjustPoints,
  approveTenant,
  assignPlan,
  breakGlass,
  endImpersonation,
  getDocumentCosts,
  getSettings,
  getTenant,
  getTenantUsage,
  listAdminPlans,
  listAdminAddons,
  listTenants,
  provisionTenant,
  rejectTenant,
  setDocumentCosts,
  startImpersonation,
  suspendTenant,
  updateSettings,
  upsertPlan,
  upsertAddon,
  applyAddon,
  setPlanActive,
  listTrialTaxRegistrations,
  resetTrialTaxRegistration,
  type ImpersonationSessionView,
  type LifecycleStatus,
  type PlanAdmin,
  type TenantDetail,
} from '@/lib/api/platform-admin';
import { CopyableTenantId } from '@/components/copyable-tenant-id';

type Tab = 'tenants' | 'plans' | 'addons' | 'costs' | 'settings' | 'trials';

function TenantDetailPanel({
  tenantId,
  plans,
  onClose,
}: {
  tenantId: string;
  plans: PlanAdmin[];
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

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['platform-admin-tenant', tenantId] });
    void qc.invalidateQueries({ queryKey: ['platform-admin-tenant-usage', tenantId] });
    void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });
  };

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
      console.info('Impersonation access token (dev only):', s.accessToken);
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('error')),
  });

  const planMut = useMutation({
    mutationFn: (input: { planCode?: string; reason: string }) => assignPlan(tenantId, input),
    onSuccess: invalidate,
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
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{t('colId')}</dt>
              <dd>
                <CopyableTenantId id={detail.id} showLabel={false} />
              </dd>
            </div>
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
              <dd className="font-medium">{detail.lifecycleStatus}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('colSignup')}</dt>
              <dd className="font-medium" dir="ltr">
                {new Date(detail.createdAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('points')}</dt>
              <dd className="font-medium tabular-nums" dir="ltr">
                {detail.pointsBalance}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('trialEndsAt')}</dt>
              <dd className="font-medium" dir="ltr">
                {detail.trialEndsAt ? new Date(detail.trialEndsAt).toLocaleString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('extraUsers')}</dt>
              <dd className="font-medium tabular-nums" dir="ltr">
                {detail.extraUsers ?? 0}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('extraCompanies')}</dt>
              <dd className="font-medium tabular-nums" dir="ltr">
                {detail.extraCompanies ?? 0}
              </dd>
            </div>
          </dl>
          <p className="text-sm">
            {detail.entitlements.documentQuota} docs · {detail.entitlements.branchQuota} branches ·{' '}
            {detail.entitlements.deviceQuota} devices
          </p>
          {usage ? (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">{t('usage')}</h3>
              <p className="text-sm">
                {usage.quotas.documents.used}/{usage.quotas.documents.limit} docs ·{' '}
                {usage.quotas.branches.used}/{usage.quotas.branches.limit} branches ·{' '}
                {usage.quotas.devices.used}/{usage.quotas.devices.limit} devices
              </p>
              <p className="text-sm text-muted-foreground">
                {t('points')}: {usage.pointsBalance} · consumed {usage.pointsLedger.consumedOnPage}
                {usage.limits
                  ? ` · ${usage.limits.users.used}/${usage.limits.users.limit} users · ${usage.limits.companies.used}/${usage.limits.companies.limit} companies`
                  : ''}
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
                  planMut.mutate({ planCode: e.target.value, reason });
                }}
              >
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              onClick={() => {
                const raw = window.prompt(t('pointsDeltaPrompt')) || '';
                const delta = Number(raw);
                if (!Number.isFinite(delta) || delta === 0) return;
                const note = window.prompt(t('pointsNotePrompt')) || undefined;
                void adjustPoints(tenantId, delta, note).then(invalidate);
              }}
            >
              {t('adjustPoints')}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-2 text-sm"
              onClick={() => {
                const addonCode = window.prompt(t('applyAddon')) || '';
                if (!addonCode) return;
                const reason = window.prompt(t('reason')) || 'addon';
                void applyAddon(tenantId, addonCode.trim().toUpperCase(), reason).then(invalidate);
              }}
            >
              {t('applyAddon')}
            </button>
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
                    onClick={() => {
                      const reason = window.prompt(t('impersonateReasonPrompt')) || '';
                      if (!reason) return;
                      void breakGlass(session.id, reason).then(setSession);
                    }}
                  >
                    {t('breakGlass')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded border px-3 py-2 text-sm"
                  onClick={() => void endImpersonation(session.id).then(() => setSession(null))}
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
  const [tab, setTab] = useState<Tab>('tenants');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [lifecycle, setLifecycle] = useState<LifecycleStatus | ''>('');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [form, setForm] = useState({
    name: '',
    ownerEmail: '',
    ownerName: '',
    planCode: 'BASIC',
    reason: '',
  });
  const [planForm, setPlanForm] = useState({
    code: '',
    nameEn: '',
    nameAr: '',
    documentQuota: 500,
    branchQuota: 1,
    deviceQuota: 1,
    includedPoints: 0,
    officialPriceEgp: 0,
    discountedPriceEgp: 0,
    maxUsers: 1,
    maxCompanies: 1,
    isTrial: false,
    isPublic: true,
    selfServe: true,
    isActive: true,
    sortOrder: 0,
  });
  const [addonForm, setAddonForm] = useState({
    code: '',
    kind: 'POINTS' as 'POINTS' | 'USER' | 'COMPANY',
    nameEn: '',
    nameAr: '',
    quantity: 1,
    officialPriceEgp: 0,
    discountedPriceEgp: 0,
    isActive: true,
    sortOrder: 0,
  });

  const tenantsQuery = useQuery({
    queryKey: ['platform-admin-tenants', qDebounced, lifecycle],
    queryFn: () => listTenants({ q: qDebounced || undefined, lifecycle: lifecycle || undefined }),
    retry: false,
  });
  const plansQuery = useQuery({
    queryKey: ['platform-admin-plans'],
    queryFn: listAdminPlans,
    retry: false,
  });
  const addonsQuery = useQuery({
    queryKey: ['platform-admin-addons'],
    queryFn: listAdminAddons,
    enabled: tab === 'addons',
  });
  const costsQuery = useQuery({
    queryKey: ['platform-admin-costs'],
    queryFn: getDocumentCosts,
    enabled: tab === 'costs',
  });
  const settingsQuery = useQuery({
    queryKey: ['platform-admin-settings'],
    queryFn: getSettings,
    enabled: tab === 'settings',
  });
  const trialRegsQuery = useQuery({
    queryKey: ['platform-admin-trial-tax-regs'],
    queryFn: listTrialTaxRegistrations,
    enabled: tab === 'trials',
  });

  useEffect(() => {
    const handle = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    if (tenantsQuery.error instanceof ApiError && tenantsQuery.error.status === 403) {
      setAccessDenied(true);
    }
  }, [tenantsQuery.error]);

  const provisionMut = useMutation({
    mutationFn: () => provisionTenant(form),
    onSuccess: () => {
      setShowProvision(false);
      setForm({ name: '', ownerEmail: '', ownerName: '', planCode: 'BASIC', reason: '' });
      void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });
    },
  });

  const refreshTenants = () => void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });

  if (accessDenied) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {t('accessDenied')}
      </div>
    );
  }

  const plans = plansQuery.data?.plans ?? [];

  if (selectedTenantId) {
    return (
      <TenantDetailPanel
        tenantId={selectedTenantId}
        plans={plans}
        onClose={() => setSelectedTenantId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
        {(['tenants', 'plans', 'addons', 'costs', 'settings', 'trials'] as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`rounded px-3 py-1.5 text-sm ${tab === id ? 'bg-brand text-white' : 'border'}`}
            onClick={() => setTab(id)}
          >
            {t(
              id === 'tenants'
                ? 'tabTenants'
                : id === 'plans'
                  ? 'tabPlans'
                  : id === 'addons'
                    ? 'tabAddons'
                    : id === 'costs'
                      ? 'tabCosts'
                      : id === 'trials'
                        ? 'tabTrials'
                        : 'tabSettings',
            )}
          </button>
        ))}
      </nav>

      {tab === 'tenants' ? (
        <>
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
            <label className="flex flex-col text-sm">
              <span>{t('filterLifecycle')}</span>
              <select
                className="rounded border px-2 py-1"
                value={lifecycle}
                onChange={(e) => setLifecycle(e.target.value as LifecycleStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                <option value="PENDING">PENDING</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
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
                {t('planCode')}
                <select
                  className="rounded border px-2 py-1"
                  value={form.planCode}
                  onChange={(e) => setForm((f) => ({ ...f, planCode: e.target.value }))}
                >
                  {plans.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code}
                    </option>
                  ))}
                </select>
              </label>
              <div className="col-span-full flex gap-2">
                <button type="submit" className="rounded bg-brand px-3 py-2 text-sm text-white">
                  {t('create')}
                </button>
                <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setShowProvision(false)}>
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
                  <th className="p-2">{t('colId')}</th>
                  <th className="p-2">{t('colContact')}</th>
                  <th className="p-2">{t('colPlan')}</th>
                  <th className="p-2">{t('colStatus')}</th>
                  <th className="p-2">{t('colPoints')}</th>
                  <th className="p-2">{t('colSignup')}</th>
                  <th className="p-2">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {(tenantsQuery.data?.items ?? []).map((tenant) => (
                  <tr key={tenant.id} className="border-b">
                    <td className="p-2">{tenant.name}</td>
                    <td className="p-2">
                      <CopyableTenantId id={tenant.id} showLabel={false} />
                    </td>
                    <td className="p-2">{tenant.ownerEmail ?? '—'}</td>
                    <td className="p-2">{tenant.planCode ?? '—'}</td>
                    <td className="p-2">{tenant.lifecycleStatus}</td>
                    <td className="p-2 tabular-nums" dir="ltr">
                      {tenant.pointsBalance}
                    </td>
                    <td className="p-2" dir="ltr">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </td>
                    <td className="flex flex-wrap gap-2 p-2">
                      <button type="button" className="text-brand underline" onClick={() => setSelectedTenantId(tenant.id)}>
                        {t('viewDetails')}
                      </button>
                      {tenant.lifecycleStatus === 'PENDING' ? (
                        <>
                          <button
                            type="button"
                            className="text-brand underline"
                            onClick={() => void approveTenant(tenant.id, 'ui').then(refreshTenants)}
                          >
                            {t('approve')}
                          </button>
                          <button
                            type="button"
                            className="text-red-700 underline"
                            onClick={() => {
                              const reason = window.prompt(t('rejectReasonPrompt')) || '';
                              if (!reason) return;
                              void rejectTenant(tenant.id, reason).then(refreshTenants);
                            }}
                          >
                            {t('reject')}
                          </button>
                        </>
                      ) : tenant.lifecycleStatus === 'SUSPENDED' ? (
                        <button
                          type="button"
                          className="text-brand underline"
                          onClick={() => void activateTenant(tenant.id).then(refreshTenants)}
                        >
                          {t('activate')}
                        </button>
                      ) : tenant.lifecycleStatus === 'ACTIVE' ? (
                        <button
                          type="button"
                          className="text-red-700 underline"
                          onClick={() => {
                            const reason = window.prompt(t('suspendReasonPrompt')) || '';
                            if (!reason) return;
                            void suspendTenant(tenant.id, reason).then(refreshTenants);
                          }}
                        >
                          {t('suspend')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!tenantsQuery.data?.items?.length ? (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={8}>
                      {tenantsQuery.isLoading ? t('loading') : t('empty')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'plans' ? (
        <div className="space-y-4">
          <form
            className="grid gap-3 rounded border p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void upsertPlan(planForm).then(() => {
                void qc.invalidateQueries({ queryKey: ['platform-admin-plans'] });
              });
            }}
          >
            <h2 className="col-span-full text-lg font-medium">{t('newPlan')}</h2>
            {(['code', 'nameEn', 'nameAr'] as const).map((field) => (
              <label key={field} className="flex flex-col text-sm">
                {field}
                <input
                  required
                  className="rounded border px-2 py-1"
                  value={planForm[field]}
                  onChange={(e) => setPlanForm((f) => ({ ...f, [field]: e.target.value }))}
                />
              </label>
            ))}
            <label className="flex flex-col text-sm">
              docs
              <input
                type="number"
                className="rounded border px-2 py-1"
                value={planForm.documentQuota}
                onChange={(e) => setPlanForm((f) => ({ ...f, documentQuota: Number(e.target.value) }))}
              />
            </label>
            <label className="flex flex-col text-sm">
              {t('includedPoints')}
              <input
                type="number"
                className="rounded border px-2 py-1"
                value={planForm.includedPoints}
                onChange={(e) => setPlanForm((f) => ({ ...f, includedPoints: Number(e.target.value) }))}
              />
            </label>
            {(
              [
                ['officialPriceEgp', t('officialPrice')],
                ['discountedPriceEgp', t('discountedPrice')],
                ['maxUsers', t('maxUsers')],
                ['maxCompanies', t('maxCompanies')],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="flex flex-col text-sm">
                {label}
                <input
                  type="number"
                  className="rounded border px-2 py-1"
                  value={planForm[field]}
                  onChange={(e) => setPlanForm((f) => ({ ...f, [field]: Number(e.target.value) }))}
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={planForm.isPublic}
                onChange={(e) => setPlanForm((f) => ({ ...f, isPublic: e.target.checked }))}
              />
              {t('isPublic')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={planForm.isTrial}
                onChange={(e) => setPlanForm((f) => ({ ...f, isTrial: e.target.checked }))}
              />
              {t('isTrial')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={planForm.isActive}
                onChange={(e) => setPlanForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              {t('isActive')}
            </label>
            <button type="submit" className="rounded bg-brand px-3 py-2 text-sm text-white">
              {t('savePlan')}
            </button>
          </form>
          <ul className="space-y-2 text-sm">
            {plans.map((p) => (
              <li key={p.id} className="rounded border p-3">
                <strong>{p.code}</strong> — {p.nameEn} / {p.nameAr} · {p.includedPoints}{' '}
                {t('points')} · {p.discountedPriceEgp}/{p.officialPriceEgp} EGP · {p.maxUsers}u /{' '}
                {p.maxCompanies}c · {p.isActive ? t('planActive') : t('planInactive')}
                <button
                  type="button"
                  className="ms-2 text-brand underline"
                  onClick={() =>
                    setPlanForm({
                      code: p.code,
                      nameEn: p.nameEn,
                      nameAr: p.nameAr,
                      documentQuota: p.documentQuota,
                      branchQuota: p.branchQuota,
                      deviceQuota: p.deviceQuota,
                      includedPoints: p.includedPoints,
                      officialPriceEgp: p.officialPriceEgp,
                      discountedPriceEgp: p.discountedPriceEgp,
                      maxUsers: p.maxUsers,
                      maxCompanies: p.maxCompanies,
                      isTrial: p.isTrial,
                      isPublic: p.isPublic,
                      selfServe: p.selfServe,
                      isActive: p.isActive,
                      sortOrder: p.sortOrder,
                    })
                  }
                >
                  edit
                </button>
                <button
                  type="button"
                  className="ms-2 text-brand underline"
                  onClick={() => {
                    void setPlanActive(p.code, !p.isActive).then(() =>
                      qc.invalidateQueries({ queryKey: ['platform-admin-plans'] }),
                    );
                  }}
                >
                  {p.isActive ? t('hideFromCustomers') : t('showToCustomers')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === 'addons' ? (
        <div className="space-y-4">
          <form
            className="grid gap-3 rounded border p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void upsertAddon(addonForm).then(() => {
                void qc.invalidateQueries({ queryKey: ['platform-admin-addons'] });
              });
            }}
          >
            <h2 className="col-span-full text-lg font-medium">{t('tabAddons')}</h2>
            {(['code', 'nameEn', 'nameAr'] as const).map((field) => (
              <label key={field} className="flex flex-col text-sm">
                {field}
                <input
                  required
                  className="rounded border px-2 py-1"
                  value={addonForm[field]}
                  onChange={(e) => setAddonForm((f) => ({ ...f, [field]: e.target.value }))}
                />
              </label>
            ))}
            <label className="flex flex-col text-sm">
              kind
              <select
                className="rounded border px-2 py-1"
                value={addonForm.kind}
                onChange={(e) =>
                  setAddonForm((f) => ({ ...f, kind: e.target.value as typeof f.kind }))
                }
              >
                <option value="POINTS">POINTS</option>
                <option value="USER">USER</option>
                <option value="COMPANY">COMPANY</option>
              </select>
            </label>
            {(['quantity', 'officialPriceEgp', 'discountedPriceEgp'] as const).map((field) => (
              <label key={field} className="flex flex-col text-sm">
                {field}
                <input
                  type="number"
                  className="rounded border px-2 py-1"
                  value={addonForm[field]}
                  onChange={(e) => setAddonForm((f) => ({ ...f, [field]: Number(e.target.value) }))}
                />
              </label>
            ))}
            <button type="submit" className="rounded bg-brand px-3 py-2 text-sm text-white">
              {t('savePlan')}
            </button>
          </form>
          <ul className="space-y-2 text-sm">
            {(addonsQuery.data?.addons ?? []).map((a) => (
              <li key={a.code} className="rounded border p-3">
                <strong>{a.code}</strong> — {a.name} / {a.nameAr} · {a.kind} × {a.quantity} ·{' '}
                {a.discountedPriceEgp}/{a.officialPriceEgp} EGP
                <button
                  type="button"
                  className="ms-2 text-brand underline"
                  onClick={() =>
                    setAddonForm({
                      code: a.code,
                      kind: a.kind,
                      nameEn: a.name,
                      nameAr: a.nameAr,
                      quantity: a.quantity,
                      officialPriceEgp: a.officialPriceEgp,
                      discountedPriceEgp: a.discountedPriceEgp,
                      isActive: a.isActive,
                      sortOrder: a.sortOrder,
                    })
                  }
                >
                  edit
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === 'costs' ? (
        <form
          className="space-y-3 rounded border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const items = (costsQuery.data ?? []).map((row) => ({
              documentKind: row.documentKind,
              points: Number(
                (e.currentTarget.elements.namedItem(`cost-${row.documentKind}`) as HTMLInputElement)
                  ?.value ?? row.points,
              ),
              standardPoints: Number(
                (
                  e.currentTarget.elements.namedItem(
                    `std-${row.documentKind}`,
                  ) as HTMLInputElement
                )?.value ?? row.standardPoints ?? row.points,
              ),
            }));
            void setDocumentCosts(items).then(() =>
              qc.invalidateQueries({ queryKey: ['platform-admin-costs'] }),
            );
          }}
        >
          {(costsQuery.data ?? []).map((row) => (
            <label key={row.documentKind} className="flex flex-wrap items-center justify-between gap-4 text-sm">
              <span>
                {t('costKind')}: {row.documentKind}
              </span>
              <span className="flex items-center gap-2">
                <input
                  name={`cost-${row.documentKind}`}
                  type="number"
                  min={0}
                  defaultValue={row.points}
                  className="w-24 rounded border px-2 py-1"
                  aria-label={t('costPoints')}
                />
                <input
                  name={`std-${row.documentKind}`}
                  type="number"
                  min={0}
                  defaultValue={row.standardPoints ?? row.points}
                  className="w-24 rounded border px-2 py-1"
                  aria-label={t('costStandard')}
                />
              </span>
            </label>
          ))}
          <button type="submit" className="rounded bg-brand px-3 py-2 text-sm text-white">
            {t('saveCosts')}
          </button>
        </form>
      ) : null}

      {tab === 'settings' && settingsQuery.data ? (
        <form
          className="space-y-3 rounded border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const formEl = e.currentTarget;
            void updateSettings({
              autoActivateSubCompanies: (formEl.elements.namedItem('autoSubs') as HTMLInputElement)
                .checked,
              supportWhatsappE164: (formEl.elements.namedItem('waE164') as HTMLInputElement).value,
              supportWhatsappDisplay: (formEl.elements.namedItem('waDisplay') as HTMLInputElement)
                .value,
              trialDays: Number((formEl.elements.namedItem('trialDays') as HTMLInputElement).value),
              trialPoints: Number(
                (formEl.elements.namedItem('trialPoints') as HTMLInputElement).value,
              ),
              etaTutorialVideoUrl: (
                formEl.elements.namedItem('etaTutorialVideoUrl') as HTMLInputElement
              ).value,
            }).then(() => qc.invalidateQueries({ queryKey: ['platform-admin-settings'] }));
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              name="autoSubs"
              type="checkbox"
              defaultChecked={settingsQuery.data.autoActivateSubCompanies}
            />
            {t('autoActivateSubs')}
          </label>
          <label className="flex flex-col text-sm">
            {t('whatsappE164')}
            <input
              name="waE164"
              className="rounded border px-2 py-1"
              defaultValue={settingsQuery.data.supportWhatsappE164}
            />
          </label>
          <label className="flex flex-col text-sm">
            {t('whatsappDisplay')}
            <input
              name="waDisplay"
              className="rounded border px-2 py-1"
              defaultValue={settingsQuery.data.supportWhatsappDisplay}
            />
          </label>
          <label className="flex flex-col text-sm">
            {t('trialDays')}
            <input
              name="trialDays"
              type="number"
              min={1}
              className="rounded border px-2 py-1"
              defaultValue={settingsQuery.data.trialDays}
            />
          </label>
          <label className="flex flex-col text-sm">
            {t('trialPoints')}
            <input
              name="trialPoints"
              type="number"
              min={0}
              className="rounded border px-2 py-1"
              defaultValue={settingsQuery.data.trialPoints}
            />
          </label>
          <label className="flex flex-col text-sm">
            {t('etaTutorialVideoUrl')}
            <input
              name="etaTutorialVideoUrl"
              type="url"
              dir="ltr"
              placeholder="https://www.youtube.com/watch?v=…"
              className="rounded border px-2 py-1"
              defaultValue={settingsQuery.data.etaTutorialVideoUrl ?? ''}
            />
            <span className="mt-1 text-xs text-muted-foreground">{t('etaTutorialVideoUrlHint')}</span>
          </label>
          <button type="submit" className="rounded bg-brand px-3 py-2 text-sm text-white">
            {t('saveSettings')}
          </button>
        </form>
      ) : null}

      {tab === 'trials' ? (
        <div className="space-y-3">
          <h2 className="text-lg font-medium">{t('trialTaxRegTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('trialTaxRegHint')}</p>
          <ul className="space-y-2 text-sm">
            {(trialRegsQuery.data?.items ?? []).map((row) => (
              <li
                key={row.taxRegistrationNormalized}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
              >
                <span>
                  <strong dir="ltr">{row.taxRegistrationNormalized}</strong>
                  <span className="ms-2 text-muted-foreground" dir="ltr">
                    {new Date(row.consumedAt).toLocaleString()}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-brand underline"
                  onClick={() => {
                    if (!window.confirm(t('resetTrialPrompt'))) return;
                    const reason = window.prompt(t('resetReasonPrompt')) || undefined;
                    void resetTrialTaxRegistration(row.taxRegistrationNormalized, reason).then(
                      () =>
                        qc.invalidateQueries({ queryKey: ['platform-admin-trial-tax-regs'] }),
                    );
                  }}
                >
                  {t('resetTrial')}
                </button>
              </li>
            ))}
            {!trialRegsQuery.data?.items?.length ? (
              <li className="text-muted-foreground">
                {trialRegsQuery.isLoading ? t('loading') : t('noTrialTaxRegs')}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
