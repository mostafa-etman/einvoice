'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { listBranches, listMyTenants, type Branch, type TenantMembership } from '@/lib/api/tenants';
import {
  getActiveBranchId,
  getActiveTenantId,
  setActiveBranchId,
  setActiveTenantId,
} from '@/lib/session';
import { useAuth } from '@/lib/auth-provider';

type TenantContextValue = {
  memberships: TenantMembership[];
  branches: Branch[];
  tenantId: string | null;
  branchId: string | null;
  setTenantId: (id: string) => void;
  setBranchId: (id: string) => void;
  roleName: string | null;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const [tenantId, setTenantIdState] = useState<string | null>(null);
  const [branchId, setBranchIdState] = useState<string | null>(null);

  useEffect(() => {
    setTenantIdState(getActiveTenantId());
    setBranchIdState(getActiveBranchId());
  }, []);

  const tenantsQuery = useQuery({
    queryKey: ['tenants', user?.id],
    queryFn: listMyTenants,
    enabled: ready && !!user,
  });

  const branchesQuery = useQuery({
    queryKey: ['branches', tenantId],
    queryFn: listBranches,
    enabled: ready && !!user && !!tenantId,
  });

  useEffect(() => {
    const memberships = tenantsQuery.data ?? [];
    if (!memberships.length) return;
    if (!tenantId || !memberships.some((m) => m.tenant.id === tenantId)) {
      const next = memberships[0].tenant.id;
      setActiveTenantId(next);
      setTenantIdState(next);
    }
  }, [tenantsQuery.data, tenantId]);

  useEffect(() => {
    const branches = branchesQuery.data ?? [];
    if (!branches.length) return;
    if (!branchId || !branches.some((b) => b.id === branchId)) {
      const def = branches.find((b) => b.isDefault) ?? branches[0];
      setActiveBranchId(def.id);
      setBranchIdState(def.id);
    }
  }, [branchesQuery.data, branchId]);

  const setTenantId = useCallback((id: string) => {
    setActiveTenantId(id);
    setTenantIdState(id);
    setActiveBranchId(null);
    setBranchIdState(null);
  }, []);

  const setBranchId = useCallback((id: string) => {
    setActiveBranchId(id);
    setBranchIdState(id);
  }, []);

  const memberships = tenantsQuery.data ?? [];
  const roleName = memberships.find((m) => m.tenant.id === tenantId)?.role.name ?? null;

  const value = useMemo(
    () => ({
      memberships,
      branches: branchesQuery.data ?? [],
      tenantId,
      branchId,
      setTenantId,
      setBranchId,
      roleName,
    }),
    [
      memberships,
      branchesQuery.data,
      tenantId,
      branchId,
      setTenantId,
      setBranchId,
      roleName,
    ],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant requires TenantProvider');
  return ctx;
}
