'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyableTenantId } from '@/components/copyable-tenant-id';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMutationToast } from '@/components/ui/use-mutation-toast';
import {
  adjustPoints,
  applyAddon,
  assignPlan,
  breakGlass,
  endImpersonation,
  getTenant,
  getTenantUsage,
  startImpersonation,
  type ImpersonationSessionView,
  type PlanAdmin,
  type TenantDetail,
} from '@/lib/api/platform-admin';
import { ReasonDialog } from './reason-dialog';

export function TenantDetailDrawer({
  tenantId,
  plans,
  onClose,
}: {
  tenantId: string;
  plans: PlanAdmin[];
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const tActions = useTranslations('common.actions');
  const qc = useQueryClient();
  const toast = useMutationToast();
  const [session, setSession] = useState<ImpersonationSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [breakGlassOpen, setBreakGlassOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [addonOpen, setAddonOpen] = useState(false);
  const [planReasonOpen, setPlanReasonOpen] = useState(false);
  const [pendingPlanCode, setPendingPlanCode] = useState('');
  const [pointsDelta, setPointsDelta] = useState('');
  const [pointsNote, setPointsNote] = useState('');
  const [addonCode, setAddonCode] = useState('');
  const [addonReason, setAddonReason] = useState('');

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
    mutationFn: (reason: string) => {
      const detail = detailQuery.data as TenantDetail;
      if (!detail.ownerId) throw new Error('no_owner');
      return startImpersonation({ tenantId, targetUserId: detail.ownerId, reason });
    },
    onSuccess: (s) => {
      setError(null);
      setSession(s);
      console.info('Impersonation access token (dev only):', s.accessToken);
      toast.saved();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : t('error'));
      toast.error(e, t('error'));
    },
  });

  const planMut = useMutation({
    mutationFn: (input: { planCode?: string; reason: string }) => assignPlan(tenantId, input),
    onSuccess: () => {
      setPlanReasonOpen(false);
      invalidate();
      toast.saved();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : t('error'));
      toast.error(e, t('error'));
    },
  });

  const detail = detailQuery.data;
  const usage = usageQuery.data;
  const pointsDeltaNumber = Number(pointsDelta);
  const canAdjustPoints = Number.isFinite(pointsDeltaNumber) && pointsDeltaNumber !== 0;

  return (
    <Drawer open onClose={onClose} title={t('detailsTitle')}>
      <div className="space-y-token-md">
        {error ? (
          <Card className="border-danger" role="alert">
            <p className="m-0 text-token-sm text-danger">{error}</p>
          </Card>
        ) : null}

        {detailQuery.isLoading && !detail ? (
          <div className="space-y-token-sm" aria-busy="true">
            <Skeleton variant="rect" className="h-token-lg" />
            <Skeleton variant="rect" className="h-token-lg" />
            <Skeleton variant="rect" className="h-token-lg" />
          </div>
        ) : null}

        {detailQuery.isError && !detail ? (
          <Card className="border-danger" role="alert">
            <p className="m-0 text-token-sm text-danger">
              {detailQuery.error instanceof Error ? detailQuery.error.message : t('error')}
            </p>
            <Button
              className="mt-token-sm"
              variant="secondary"
              size="sm"
              onClick={() => void detailQuery.refetch()}
            >
              {t('retryLoad')}
            </Button>
          </Card>
        ) : null}

        {detail ? (
          <>
            <dl className="m-0 grid gap-token-sm text-token-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-foreground-muted">{t('colId')}</dt>
                <dd className="m-0">
                  <CopyableTenantId id={detail.id} showLabel={false} />
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('colName')}</dt>
                <dd className="m-0 font-medium">{detail.name}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('owner')}</dt>
                <dd className="m-0 font-en font-medium" dir="ltr">
                  {detail.ownerEmail ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('colPlan')}</dt>
                <dd className="m-0 font-en font-medium" dir="ltr">
                  {detail.planCode ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('colStatus')}</dt>
                <dd className="m-0 font-en font-medium" dir="ltr">
                  {detail.lifecycleStatus}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('colSignup')}</dt>
                <dd className="m-0 font-en font-medium" dir="ltr">
                  {new Date(detail.createdAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('points')}</dt>
                <dd className="m-0 font-en font-medium tabular-nums" dir="ltr">
                  {detail.pointsBalance}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('trialEndsAt')}</dt>
                <dd className="m-0 font-en font-medium" dir="ltr">
                  {detail.trialEndsAt ? new Date(detail.trialEndsAt).toLocaleString() : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('extraUsers')}</dt>
                <dd className="m-0 font-en font-medium tabular-nums" dir="ltr">
                  {detail.extraUsers ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">{t('extraCompanies')}</dt>
                <dd className="m-0 font-en font-medium tabular-nums" dir="ltr">
                  {detail.extraCompanies ?? 0}
                </dd>
              </div>
            </dl>
            <p className="m-0 text-token-sm">
              <span className="font-en tabular-nums" dir="ltr">
                {detail.entitlements.documentQuota}
              </span>{' '}
              {t('docs')} ·{' '}
              <span className="font-en tabular-nums" dir="ltr">
                {detail.entitlements.branchQuota}
              </span>{' '}
              {t('branches')} ·{' '}
              <span className="font-en tabular-nums" dir="ltr">
                {detail.entitlements.deviceQuota}
              </span>{' '}
              {t('devices')}
            </p>
            {usage ? (
              <div>
                <h3 className="m-0 text-token-sm font-medium text-foreground-muted">{t('usage')}</h3>
                <p className="m-0 text-token-sm">
                  <span className="font-en tabular-nums" dir="ltr">
                    {usage.quotas.documents.used}/{usage.quotas.documents.limit}
                  </span>{' '}
                  {t('docs')} ·{' '}
                  <span className="font-en tabular-nums" dir="ltr">
                    {usage.quotas.branches.used}/{usage.quotas.branches.limit}
                  </span>{' '}
                  {t('branches')} ·{' '}
                  <span className="font-en tabular-nums" dir="ltr">
                    {usage.quotas.devices.used}/{usage.quotas.devices.limit}
                  </span>{' '}
                  {t('devices')}
                </p>
                <p className="m-0 text-token-sm text-foreground-muted">
                  {t('points')}:{' '}
                  <span className="font-en tabular-nums" dir="ltr">
                    {usage.pointsBalance}
                  </span>{' '}
                  · {t('consumed')}{' '}
                  <span className="font-en tabular-nums" dir="ltr">
                    {usage.pointsLedger.consumedOnPage}
                  </span>
                  {usage.limits ? (
                    <>
                      {' · '}
                      <span className="font-en tabular-nums" dir="ltr">
                        {usage.limits.users.used}/{usage.limits.users.limit}
                      </span>{' '}
                      {t('maxUsers')} ·{' '}
                      <span className="font-en tabular-nums" dir="ltr">
                        {usage.limits.companies.used}/{usage.limits.companies.limit}
                      </span>{' '}
                      {t('maxCompanies')}
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-token-sm">
              <Select
                label={t('planCode')}
                value={detail.planCode ?? ''}
                onChange={(e) => {
                  setPendingPlanCode(e.target.value);
                  setPlanReasonOpen(true);
                }}
              >
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="secondary" size="sm" onClick={() => setPointsOpen(true)}>
                {t('adjustPoints')}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAddonOpen(true)}>
                {t('applyAddon')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-token-sm border-t border-border pt-token-md">
              {!session ? (
                <Button
                  type="button"
                  disabled={impersonateMut.isPending || !detail.ownerId}
                  loading={impersonateMut.isPending}
                  onClick={() => setImpersonateOpen(true)}
                >
                  {t('impersonate')}
                </Button>
              ) : (
                <>
                  <span className="text-token-sm text-foreground-muted">
                    {t('impersonationActive', { mode: session.mode })}
                  </span>
                  {session.mode === 'READ_ONLY' ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setBreakGlassOpen(true)}>
                      {t('breakGlass')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void toast.track(endImpersonation(session.id).then(() => setSession(null)))}
                  >
                    {t('endImpersonation')}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>

      <ReasonDialog
        open={impersonateOpen}
        title={t('impersonate')}
        description={t('impersonateReasonPrompt')}
        label={t('reason')}
        confirmLabel={t('impersonate')}
        onClose={() => setImpersonateOpen(false)}
        onSubmit={(reason) => {
          setImpersonateOpen(false);
          impersonateMut.mutate(reason);
        }}
      />
      <ReasonDialog
        open={breakGlassOpen}
        title={t('breakGlass')}
        description={t('impersonateReasonPrompt')}
        label={t('reason')}
        danger
        onClose={() => setBreakGlassOpen(false)}
        onSubmit={(reason) => {
          if (!session) return;
          setBreakGlassOpen(false);
          void toast.track(breakGlass(session.id, reason).then(setSession));
        }}
      />
      <ReasonDialog
        open={planReasonOpen}
        title={t('planCode')}
        description={t('reason')}
        label={t('reason')}
        onClose={() => setPlanReasonOpen(false)}
        onSubmit={(reason) => planMut.mutate({ planCode: pendingPlanCode, reason })}
      />

      <Modal
        open={pointsOpen}
        onClose={() => setPointsOpen(false)}
        title={t('adjustPoints')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPointsOpen(false)}>
              {tActions('cancel')}
            </Button>
            <Button
              disabled={!canAdjustPoints}
              onClick={() => {
                if (!canAdjustPoints) return;
                const note = pointsNote || undefined;
                setPointsOpen(false);
                setPointsDelta('');
                setPointsNote('');
                void toast.track(adjustPoints(tenantId, pointsDeltaNumber, note).then(invalidate));
              }}
            >
              {t('adjustPoints')}
            </Button>
          </>
        }
      >
        <div className="space-y-token-sm">
          <Input
            label={t('pointsDeltaPrompt')}
            value={pointsDelta}
            onChange={(e) => setPointsDelta(e.target.value)}
            inputMode="numeric"
          />
          <Input
            label={t('pointsNotePrompt')}
            value={pointsNote}
            onChange={(e) => setPointsNote(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={addonOpen}
        onClose={() => setAddonOpen(false)}
        title={t('applyAddon')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddonOpen(false)}>
              {tActions('cancel')}
            </Button>
            <Button
              disabled={!addonCode.trim()}
              onClick={() => {
                const code = addonCode.trim();
                if (!code) return;
                const reason = addonReason || 'addon';
                setAddonOpen(false);
                setAddonCode('');
                setAddonReason('');
                void toast.track(applyAddon(tenantId, code.toUpperCase(), reason).then(invalidate));
              }}
            >
              {t('applyAddon')}
            </Button>
          </>
        }
      >
        <div className="space-y-token-sm">
          <Input
            label={t('applyAddon')}
            value={addonCode}
            onChange={(e) => setAddonCode(e.target.value)}
            className="font-en"
          />
          <Input label={t('reason')} value={addonReason} onChange={(e) => setAddonReason(e.target.value)} />
        </div>
      </Modal>
    </Drawer>
  );
}
