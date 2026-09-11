'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchAnalyticsSummary } from '@/lib/api/analytics';
import { getCompanyProfile } from '@/lib/api/company';
import { listDocuments } from '@/lib/api/documents';
import {
  getEtaCredentials,
  getEtaSetupStatus,
  type EtaSetupStatus,
} from '@/lib/api/eta-credentials';
import { getEtaEnvironment } from '@/lib/api/eta-environment';
import { listMembers } from '@/lib/api/members';
import { useAuth } from '@/lib/auth-provider';
import { useTenant } from '@/lib/tenant-provider';
import { DashboardGateSkeleton } from './_components/dashboard-skeleton';
import { DashboardHeader } from './_components/dashboard-header';
import { DashboardStats } from './_components/dashboard-stats';
import {
  cairoTodayIso,
  monthToDateRange,
  previousMonthToDate,
} from './_components/dashboard-dates';
import { EtaStatusCard } from './_components/eta-status-card';
import { RecentActivity } from './_components/recent-activity';
import { SetupChecklist, type ChecklistItem } from './_components/setup-checklist';

function greetingName(name: string | null | undefined, email: string | null | undefined, fallback: string) {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0] ?? fallback;
  const local = email?.split('@')[0]?.trim();
  return local || fallback;
}

export default function HomePage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const { user } = useAuth();
  const { tenantId, memberships } = useTenant();
  const [ready, setReady] = useState(!tenantId);
  const [setup, setSetup] = useState<EtaSetupStatus | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    void getEtaSetupStatus()
      .then((next) => {
        if (cancelled) return;
        if (next.promptEtaSetup) {
          router.replace(`/${locale}/settings/eta-credentials`);
          return;
        }
        setSetup(next);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, locale, router]);

  const currentRange = useMemo(() => monthToDateRange(cairoTodayIso()), []);
  const previousRange = useMemo(
    () => previousMonthToDate(currentRange),
    [currentRange],
  );

  const canLoad = ready && !!tenantId;

  const summaryQuery = useQuery({
    queryKey: ['analytics-summary', tenantId, currentRange.from, currentRange.to],
    queryFn: () =>
      fetchAnalyticsSummary({ from: currentRange.from, to: currentRange.to }),
    enabled: canLoad,
  });

  const previousQuery = useQuery({
    queryKey: [
      'analytics-summary',
      tenantId,
      previousRange.from,
      previousRange.to,
    ],
    queryFn: () =>
      fetchAnalyticsSummary({ from: previousRange.from, to: previousRange.to }),
    enabled: canLoad,
  });

  const documentsQuery = useQuery({
    queryKey: [
      'documents',
      tenantId,
      { limit: 5, sortBy: 'issueDateTime', sortDir: 'desc', scope: 'dashboard' },
    ],
    queryFn: () =>
      listDocuments({ limit: 5, sortBy: 'issueDateTime', sortDir: 'desc' }),
    enabled: canLoad,
  });

  const envQuery = useQuery({
    queryKey: ['eta-environment', tenantId],
    queryFn: () => getEtaEnvironment(),
    enabled: canLoad,
    staleTime: 30_000,
  });

  const credEnv = envQuery.data?.activeEnvironment;
  const credentialsQuery = useQuery({
    queryKey: ['eta-credentials', tenantId, credEnv],
    queryFn: () => getEtaCredentials({ environment: credEnv }),
    enabled: canLoad && !!credEnv,
  });

  const companyQuery = useQuery({
    queryKey: ['company-profile', tenantId],
    queryFn: getCompanyProfile,
    enabled: canLoad,
  });

  const membersQuery = useQuery({
    queryKey: ['members', tenantId],
    queryFn: listMembers,
    enabled: canLoad,
  });

  const tenantName =
    memberships.find((m) => m.tenant.id === tenantId)?.tenant.name ?? null;
  const name = greetingName(user?.name, user?.email, t('greetingFallback'));

  const checklistLoading =
    canLoad &&
    (companyQuery.isPending || documentsQuery.isPending || membersQuery.isPending);
  const hasDocument =
    (documentsQuery.data?.items.length ?? 0) > 0 ||
    (summaryQuery.data?.totals.issued ?? 0) > 0;
  const companyDone = Boolean(companyQuery.data?.legalName?.trim());
  const etaDone = Boolean(setup?.etaConfigured);
  const userDone = (membersQuery.data?.length ?? 0) > 1;

  const checklistItems: ChecklistItem[] = [
    { id: 'company', done: companyDone, href: '/settings/company' },
    { id: 'eta', done: etaDone, href: '/settings/eta-credentials' },
    { id: 'document', done: hasDocument, href: '/documents/new' },
    { id: 'user', done: userDone, href: '/users' },
  ];

  if (!ready) {
    return <DashboardGateSkeleton />;
  }

  return (
    <section data-testid="dashboard-page">
      <DashboardHeader name={name} tenantName={tenantName} />
      <DashboardStats
        totals={summaryQuery.data?.totals}
        previous={previousQuery.data?.totals}
        loading={summaryQuery.isLoading}
        error={summaryQuery.isError}
        onRetry={() => void summaryQuery.refetch()}
      />
      <div className="grid grid-cols-1 gap-token-lg xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentActivity
          rows={documentsQuery.data?.items ?? []}
          loading={documentsQuery.isLoading}
          error={documentsQuery.isError}
          onRetry={() => void documentsQuery.refetch()}
        />
        <div className="flex flex-col gap-token-md">
          <SetupChecklist items={checklistItems} loading={checklistLoading} />
          <EtaStatusCard
            configured={setup ? setup.etaConfigured : null}
            environment={envQuery.data?.activeEnvironment ?? null}
            lastValidatedAt={credentialsQuery.data?.lastValidatedAt ?? null}
            loading={
              envQuery.isLoading ||
              (Boolean(credEnv) && credentialsQuery.isLoading)
            }
            error={envQuery.isError}
          />
        </div>
      </div>
    </section>
  );
}
