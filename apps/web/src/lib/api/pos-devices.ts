import { apiFetch } from './client';

export type PosDeviceStatus = 'ACTIVE' | 'RETIRED' | 'PERMANENTLY_RETIRED';

export type PosDevice = {
  id: string;
  branchId: string;
  label: string;
  serialNumber: string;
  osVersion: string;
  modelFramework: string;
  hasPreSharedKey: boolean;
  preSharedKeyMasked: string;
  status: PosDeviceStatus;
  lastReceiptUuid: string;
  signingDeviceId: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listPosDevices(branchId?: string) {
  const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  return apiFetch<PosDevice[]>(`/pos-devices${q}`, { tenantScoped: true });
}

export function createPosDevice(body: {
  branchId: string;
  label?: string;
  serialNumber: string;
  osVersion: string;
  modelFramework: string;
  preSharedKey: string;
  signingDeviceId?: string | null;
}) {
  return apiFetch<PosDevice>('/pos-devices', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}

export function updatePosDevice(
  id: string,
  body: Partial<{
    branchId: string;
    label: string;
    serialNumber: string;
    osVersion: string;
    modelFramework: string;
    preSharedKey: string;
    status: PosDeviceStatus;
    signingDeviceId: string | null;
  }>,
) {
  return apiFetch<PosDevice>(`/pos-devices/${id}`, {
    method: 'PATCH',
    tenantScoped: true,
    body,
  });
}
