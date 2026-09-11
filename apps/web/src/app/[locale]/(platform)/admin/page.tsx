'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import {
  activateTenant,
  approveTenant,
  getDocumentCosts,
  getSettings,
  listAdminAddons,
  listAdminPlans,
  listTenants,
  listTrialTaxRegistrations,
  provisionTenant,
  rejectTenant,
  resetTrialTaxRegistration,
  setDocumentCosts,
  setPlanActive,
  suspendTenant,
  updateSettings,
  upsertAddon,
  upsertPlan,
  type LifecycleStatus,
  type TenantSummary,
} from '@/lib/api/platform-admin';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterBar } from '@/components/ui/filter-bar';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TenantTable } from './_components/tenant-table';
import { TenantDetailDrawer } from './_components/tenant-detail-drawer';
import { ReasonDialog } from './_components/reason-dialog';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

type Tab = 'tenants' | 'plans' | 'addons' | 'costs' | 'settings' | 'trials';

type LifecycleDialog =
  | { kind: 'approve'; tenant: TenantSummary }
  | { kind: 'reject'; tenant: TenantSummary }
  | { kind: 'suspend'; tenant: TenantSummary };

export default function PlatformAdminPage() {
  const t = useTranslations('admin');
  const tUi = useTranslations('ui');
  const toast = useMutationToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('tenants');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [lifecycle, setLifecycle] = useState<LifecycleStatus | ''>('');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [lifecycleDialog, setLifecycleDialog] = useState<LifecycleDialog | null>(null);
  const [resetTax, setResetTax] = useState<string | null>(null);
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

  const provisionMut = useMutation({
    mutationFn: () => provisionTenant(form),
    onSuccess: () => {
      setShowProvision(false);
      setForm({ name: '', ownerEmail: '', ownerName: '', planCode: 'BASIC', reason: '' });
      void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });
      toast.created();
    },
    onError: (err) => toast.error(err),
  });

  const refreshTenants = () => void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });
  const plans = plansQuery.data?.plans ?? [];
  const tenantsBusy = tenantsQuery.isLoading;
  const accessDenied =
    tenantsQuery.error instanceof ApiError && tenantsQuery.error.status === 403;

  if (tenantsQuery.isPending) {
    return (
      <div className="space-y-token-lg" aria-busy="true">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <Skeleton variant="rect" className="h-token-lg" />
        <Skeleton variant="rect" className="h-token-lg" />
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="space-y-token-lg">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <Card className="border-danger" role="alert">
          <p className="m-0 text-token-sm text-danger">{t('accessDenied')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-token-lg" aria-busy={tenantsBusy || undefined}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        items={[
          {
            id: 'tenants',
            label: t('tabTenants'),
            panel: (
              <div className="space-y-token-md">
                <FilterBar>
                  <Input
                    label={t('search')}
                    placeholder={t('searchPlaceholder')}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  <Select
                    label={t('filterLifecycle')}
                    value={lifecycle}
                    onChange={(e) => setLifecycle(e.target.value as LifecycleStatus | '')}
                  >
                    <option value="">{t('allStatuses')}</option>
                    <option value="PENDING">PENDING</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                    <option value="REJECTED">REJECTED</option>
                  </Select>
                  <Button type="button" onClick={() => setShowProvision((v) => !v)}>
                    {t('provision')}
                  </Button>
                </FilterBar>

                {showProvision ? (
                  <Card>
                    <form
                      className="grid gap-token-md sm:grid-cols-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        provisionMut.mutate();
                      }}
                    >
                      <h2 className="col-span-full m-0 text-token-lg font-semibold">{t('provisionTitle')}</h2>
                      <Input
                        required
                        label={t('tenantName')}
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      />
                      <Input
                        required
                        type="email"
                        label={t('ownerEmail')}
                        value={form.ownerEmail}
                        onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))}
                        className="font-en"
                      />
                      <Select
                        label={t('planCode')}
                        value={form.planCode}
                        onChange={(e) => setForm((f) => ({ ...f, planCode: e.target.value }))}
                      >
                        {plans.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.code}
                          </option>
                        ))}
                      </Select>
                      <div className="col-span-full flex flex-wrap gap-token-sm">
                        <Button type="submit" loading={provisionMut.isPending}>
                          {t('create')}
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setShowProvision(false)}>
                          {t('cancel')}
                        </Button>
                      </div>
                    </form>
                  </Card>
                ) : null}

                {tenantsQuery.isError && !(tenantsQuery.error instanceof ApiError && tenantsQuery.error.status === 403) ? (
                  <Card className="border-danger" role="alert">
                    <p className="m-0 text-token-sm text-danger">
                      {tenantsQuery.error instanceof Error ? tenantsQuery.error.message : t('error')}
                    </p>
                    <Button
                      className="mt-token-sm"
                      variant="secondary"
                      size="sm"
                      onClick={() => void tenantsQuery.refetch()}
                    >
                      {t('retryLoad')}
                    </Button>
                  </Card>
                ) : (
                  <TenantTable
                    tenants={tenantsQuery.data?.items ?? []}
                    loading={tenantsQuery.isLoading}
                    emptyAction={
                      q.trim() || lifecycle
                        ? {
                            label: tUi('filterReset'),
                            onClick: () => {
                              setQ('');
                              setLifecycle('');
                            },
                          }
                        : { label: t('provision'), onClick: () => setShowProvision(true) }
                    }
                    onView={(tenant) => setSelectedTenantId(tenant.id)}
                    onApprove={(tenant) => setLifecycleDialog({ kind: 'approve', tenant })}
                    onReject={(tenant) => setLifecycleDialog({ kind: 'reject', tenant })}
                    onActivate={(tenant) =>
                      void toast.track(activateTenant(tenant.id).then(refreshTenants))
                    }
                    onSuspend={(tenant) => setLifecycleDialog({ kind: 'suspend', tenant })}
                  />
                )}
              </div>
            ),
          },
          {
            id: 'plans',
            label: t('tabPlans'),
            panel: (
              <div className="space-y-token-md">
                <Card>
                  <form
                    className="grid gap-token-md sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void toast.track(
                        upsertPlan(planForm).then(() => {
                          void qc.invalidateQueries({ queryKey: ['platform-admin-plans'] });
                        }),
                      );
                    }}
                  >
                    <h2 className="col-span-full m-0 text-token-lg font-semibold">{t('newPlan')}</h2>
                    <Input
                      required
                      label={t('fieldCode')}
                      value={planForm.code}
                      onChange={(e) => setPlanForm((f) => ({ ...f, code: e.target.value }))}
                      className="font-en"
                    />
                    <Input
                      required
                      label={t('fieldNameEn')}
                      value={planForm.nameEn}
                      onChange={(e) => setPlanForm((f) => ({ ...f, nameEn: e.target.value }))}
                    />
                    <Input
                      required
                      label={t('fieldNameAr')}
                      value={planForm.nameAr}
                      onChange={(e) => setPlanForm((f) => ({ ...f, nameAr: e.target.value }))}
                    />
                    <Input
                      type="number"
                      label={t('documentQuota')}
                      value={planForm.documentQuota}
                      onChange={(e) => setPlanForm((f) => ({ ...f, documentQuota: Number(e.target.value) }))}
                    />
                    <Input
                      type="number"
                      label={t('includedPoints')}
                      value={planForm.includedPoints}
                      onChange={(e) => setPlanForm((f) => ({ ...f, includedPoints: Number(e.target.value) }))}
                    />
                    <Input
                      type="number"
                      label={t('officialPrice')}
                      value={planForm.officialPriceEgp}
                      onChange={(e) => setPlanForm((f) => ({ ...f, officialPriceEgp: Number(e.target.value) }))}
                    />
                    <Input
                      type="number"
                      label={t('discountedPrice')}
                      value={planForm.discountedPriceEgp}
                      onChange={(e) => setPlanForm((f) => ({ ...f, discountedPriceEgp: Number(e.target.value) }))}
                    />
                    <Input
                      type="number"
                      label={t('maxUsers')}
                      value={planForm.maxUsers}
                      onChange={(e) => setPlanForm((f) => ({ ...f, maxUsers: Number(e.target.value) }))}
                    />
                    <Input
                      type="number"
                      label={t('maxCompanies')}
                      value={planForm.maxCompanies}
                      onChange={(e) => setPlanForm((f) => ({ ...f, maxCompanies: Number(e.target.value) }))}
                    />
                    <Checkbox
                      checked={planForm.isPublic}
                      onChange={(e) => setPlanForm((f) => ({ ...f, isPublic: e.target.checked }))}
                    >
                      {t('isPublic')}
                    </Checkbox>
                    <Checkbox
                      checked={planForm.isTrial}
                      onChange={(e) => setPlanForm((f) => ({ ...f, isTrial: e.target.checked }))}
                    >
                      {t('isTrial')}
                    </Checkbox>
                    <Checkbox
                      checked={planForm.isActive}
                      onChange={(e) => setPlanForm((f) => ({ ...f, isActive: e.target.checked }))}
                    >
                      {t('isActive')}
                    </Checkbox>
                    <Button type="submit">{t('savePlan')}</Button>
                  </form>
                </Card>
                {plansQuery.isLoading ? <Skeleton variant="rect" className="h-token-lg" /> : null}
                <ul className="m-0 grid list-none gap-token-sm p-0">
                  {plans.map((p) => (
                    <li key={p.id}>
                      <Card>
                        <div className="flex flex-wrap items-start justify-between gap-token-sm">
                          <div>
                            <CardTitle>
                              <span className="font-en" dir="ltr">
                                {p.code}
                              </span>
                              {' — '}
                              {p.nameEn} / {p.nameAr}
                            </CardTitle>
                            <p className="m-0 mt-token-xs text-token-sm text-foreground-muted">
                              <span className="font-en tabular-nums" dir="ltr">
                                {p.includedPoints}
                              </span>{' '}
                              {t('points')} ·{' '}
                              <span className="font-en tabular-nums" dir="ltr">
                                {p.discountedPriceEgp}/{p.officialPriceEgp} EGP
                              </span>{' '}
                              · {p.maxUsers}u / {p.maxCompanies}c ·{' '}
                              {p.isActive ? t('planActive') : t('planInactive')}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-token-xs">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
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
                              {t('edit')}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                void toast.track(
                                  setPlanActive(p.code, !p.isActive).then(() =>
                                    qc.invalidateQueries({ queryKey: ['platform-admin-plans'] }),
                                  ),
                                );
                              }}
                            >
                              {p.isActive ? t('hideFromCustomers') : t('showToCustomers')}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
          {
            id: 'addons',
            label: t('tabAddons'),
            panel: (
              <div className="space-y-token-md">
                <Card>
                  <form
                    className="grid gap-token-md sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void toast.track(
                        upsertAddon(addonForm).then(() => {
                          void qc.invalidateQueries({ queryKey: ['platform-admin-addons'] });
                        }),
                      );
                    }}
                  >
                    <h2 className="col-span-full m-0 text-token-lg font-semibold">{t('tabAddons')}</h2>
                    <Input
                      required
                      label={t('fieldCode')}
                      value={addonForm.code}
                      onChange={(e) => setAddonForm((f) => ({ ...f, code: e.target.value }))}
                      className="font-en"
                    />
                    <Input
                      required
                      label={t('fieldNameEn')}
                      value={addonForm.nameEn}
                      onChange={(e) => setAddonForm((f) => ({ ...f, nameEn: e.target.value }))}
                    />
                    <Input
                      required
                      label={t('fieldNameAr')}
                      value={addonForm.nameAr}
                      onChange={(e) => setAddonForm((f) => ({ ...f, nameAr: e.target.value }))}
                    />
                    <Select
                      label={t('addonKind')}
                      value={addonForm.kind}
                      onChange={(e) =>
                        setAddonForm((f) => ({ ...f, kind: e.target.value as typeof f.kind }))
                      }
                    >
                      <option value="POINTS">POINTS</option>
                      <option value="USER">USER</option>
                      <option value="COMPANY">COMPANY</option>
                    </Select>
                    <Input
                      type="number"
                      label={t('quantity')}
                      value={addonForm.quantity}
                      onChange={(e) => setAddonForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                    />
                    <Input
                      type="number"
                      label={t('officialPrice')}
                      value={addonForm.officialPriceEgp}
                      onChange={(e) =>
                        setAddonForm((f) => ({ ...f, officialPriceEgp: Number(e.target.value) }))
                      }
                    />
                    <Input
                      type="number"
                      label={t('discountedPrice')}
                      value={addonForm.discountedPriceEgp}
                      onChange={(e) =>
                        setAddonForm((f) => ({ ...f, discountedPriceEgp: Number(e.target.value) }))
                      }
                    />
                    <Button type="submit">{t('savePlan')}</Button>
                  </form>
                </Card>
                {addonsQuery.isLoading ? <Skeleton variant="rect" className="h-token-lg" /> : null}
                <ul className="m-0 grid list-none gap-token-sm p-0">
                  {(addonsQuery.data?.addons ?? []).map((a) => (
                    <li key={a.code}>
                      <Card>
                        <div className="flex flex-wrap items-start justify-between gap-token-sm">
                          <div>
                            <CardTitle>
                              <span className="font-en" dir="ltr">
                                {a.code}
                              </span>
                              {' — '}
                              {a.name} / {a.nameAr}
                            </CardTitle>
                            <p className="m-0 mt-token-xs font-en text-token-sm text-foreground-muted" dir="ltr">
                              {a.kind} × {a.quantity} · {a.discountedPriceEgp}/{a.officialPriceEgp} EGP
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
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
                            {t('edit')}
                          </Button>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
          {
            id: 'costs',
            label: t('tabCosts'),
            panel: costsQuery.isLoading ? (
              <Skeleton variant="rect" className="h-token-lg" />
            ) : (
              <Card>
                <form
                  className="space-y-token-md"
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
                          e.currentTarget.elements.namedItem(`std-${row.documentKind}`) as HTMLInputElement
                        )?.value ??
                          row.standardPoints ??
                          row.points,
                      ),
                    }));
                    void toast.track(
                      setDocumentCosts(items).then(() =>
                        qc.invalidateQueries({ queryKey: ['platform-admin-costs'] }),
                      ),
                    );
                  }}
                >
                  {(costsQuery.data ?? []).map((row) => (
                    <div
                      key={row.documentKind}
                      className="flex flex-wrap items-end justify-between gap-token-md"
                    >
                      <p className="m-0 text-token-sm">
                        {t('costKind')}:{' '}
                        <span className="font-en" dir="ltr">
                          {row.documentKind}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-token-sm">
                        <Input
                          name={`cost-${row.documentKind}`}
                          type="number"
                          min={0}
                          defaultValue={row.points}
                          label={t('costPoints')}
                          className="w-24"
                        />
                        <Input
                          name={`std-${row.documentKind}`}
                          type="number"
                          min={0}
                          defaultValue={row.standardPoints ?? row.points}
                          label={t('costStandard')}
                          className="w-24"
                        />
                      </div>
                    </div>
                  ))}
                  <Button type="submit">{t('saveCosts')}</Button>
                </form>
              </Card>
            ),
          },
          {
            id: 'settings',
            label: t('tabSettings'),
            panel: settingsQuery.isLoading ? (
              <Skeleton variant="rect" className="h-token-lg" />
            ) : settingsQuery.data ? (
              <Card>
                <form
                  className="space-y-token-md"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formEl = e.currentTarget;
                    void toast.track(
                      updateSettings({
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
                    }).then(() => qc.invalidateQueries({ queryKey: ['platform-admin-settings'] })),
                    );
                  }}
                >
                  <Checkbox name="autoSubs" defaultChecked={settingsQuery.data.autoActivateSubCompanies}>
                    {t('autoActivateSubs')}
                  </Checkbox>
                  <Input
                    name="waE164"
                    label={t('whatsappE164')}
                    defaultValue={settingsQuery.data.supportWhatsappE164}
                    className="font-en"
                  />
                  <Input
                    name="waDisplay"
                    label={t('whatsappDisplay')}
                    defaultValue={settingsQuery.data.supportWhatsappDisplay}
                    className="font-en"
                  />
                  <Input
                    name="trialDays"
                    type="number"
                    min={1}
                    label={t('trialDays')}
                    defaultValue={settingsQuery.data.trialDays}
                  />
                  <Input
                    name="trialPoints"
                    type="number"
                    min={0}
                    label={t('trialPoints')}
                    defaultValue={settingsQuery.data.trialPoints}
                  />
                  <Input
                    name="etaTutorialVideoUrl"
                    type="url"
                    dir="ltr"
                    label={t('etaTutorialVideoUrl')}
                    hint={t('etaTutorialVideoUrlHint')}
                    placeholder="https://www.youtube.com/watch?v=…"
                    defaultValue={settingsQuery.data.etaTutorialVideoUrl ?? ''}
                    className="font-en"
                  />
                  <Button type="submit">{t('saveSettings')}</Button>
                </form>
              </Card>
            ) : settingsQuery.isError ? (
              <Card className="border-danger" role="alert">
                <p className="m-0 text-token-sm text-danger">{t('error')}</p>
                <Button
                  className="mt-token-sm"
                  variant="secondary"
                  size="sm"
                  onClick={() => void settingsQuery.refetch()}
                >
                  {t('retryLoad')}
                </Button>
              </Card>
            ) : null,
          },
          {
            id: 'trials',
            label: t('tabTrials'),
            panel: (
              <div className="space-y-token-md">
                <div>
                  <h2 className="m-0 text-token-lg font-semibold">{t('trialTaxRegTitle')}</h2>
                  <p className="m-0 mt-token-xs text-token-sm text-foreground-muted">{t('trialTaxRegHint')}</p>
                </div>
                {trialRegsQuery.isLoading ? <Skeleton variant="rect" className="h-token-lg" /> : null}
                {(trialRegsQuery.data?.items ?? []).length ? (
                  <ul className="m-0 grid list-none gap-token-sm p-0">
                    {(trialRegsQuery.data?.items ?? []).map((row) => (
                      <li key={row.taxRegistrationNormalized}>
                        <Card>
                          <div className="flex flex-wrap items-center justify-between gap-token-sm">
                            <div>
                              <p className="m-0 font-en font-medium" dir="ltr">
                                {row.taxRegistrationNormalized}
                              </p>
                              <p className="m-0 font-en text-token-xs text-foreground-muted" dir="ltr">
                                {new Date(row.consumedAt).toLocaleString()}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setResetTax(row.taxRegistrationNormalized)}
                            >
                              {t('resetTrial')}
                            </Button>
                          </div>
                        </Card>
                      </li>
                    ))}
                  </ul>
                ) : !trialRegsQuery.isLoading ? (
                  <EmptyState
                    title={t('noTrialTaxRegs')}
                    action={{ label: t('retryLoad'), onClick: () => void trialRegsQuery.refetch() }}
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />

      {selectedTenantId ? (
        <TenantDetailDrawer
          tenantId={selectedTenantId}
          plans={plans}
          onClose={() => setSelectedTenantId(null)}
        />
      ) : null}

      <ConfirmDialog
        open={lifecycleDialog?.kind === 'approve'}
        onClose={() => setLifecycleDialog(null)}
        title={t('approve')}
        description={t('confirmApprove')}
        confirmLabel={t('approve')}
        onConfirm={() => {
          if (lifecycleDialog?.kind !== 'approve') return;
          const id = lifecycleDialog.tenant.id;
          setLifecycleDialog(null);
          void toast.track(approveTenant(id, 'ui').then(refreshTenants));
        }}
      />
      <ReasonDialog
        open={lifecycleDialog?.kind === 'reject'}
        title={t('reject')}
        description={t('rejectReasonPrompt')}
        label={t('reason')}
        confirmLabel={t('reject')}
        danger
        onClose={() => setLifecycleDialog(null)}
        onSubmit={(reason) => {
          if (lifecycleDialog?.kind !== 'reject') return;
          const id = lifecycleDialog.tenant.id;
          setLifecycleDialog(null);
          void toast.track(rejectTenant(id, reason).then(refreshTenants));
        }}
      />
      <ReasonDialog
        open={lifecycleDialog?.kind === 'suspend'}
        title={t('suspend')}
        description={t('suspendReasonPrompt')}
        label={t('reason')}
        confirmLabel={t('suspend')}
        danger
        onClose={() => setLifecycleDialog(null)}
        onSubmit={(reason) => {
          if (lifecycleDialog?.kind !== 'suspend') return;
          const id = lifecycleDialog.tenant.id;
          setLifecycleDialog(null);
          void toast.track(suspendTenant(id, reason).then(refreshTenants));
        }}
      />
      <ReasonDialog
        open={resetTax !== null}
        title={t('resetTrial')}
        description={t('resetTrialPrompt')}
        label={t('resetReasonPrompt')}
        confirmLabel={t('resetTrial')}
        required={false}
        onClose={() => setResetTax(null)}
        onSubmit={(reason) => {
          if (!resetTax) return;
          const tax = resetTax;
          setResetTax(null);
          void toast.track(
            resetTrialTaxRegistration(tax, reason || undefined).then(() =>
              qc.invalidateQueries({ queryKey: ['platform-admin-trial-tax-regs'] }),
            ),
          );
        }}
      />
    </div>
  );
}
