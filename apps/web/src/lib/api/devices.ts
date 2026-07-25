import { apiFetch } from './client';

export type DeviceSummary = {
  id: string;
  label: string;
  status: string;
  lastSeenAt: string | null;
  pairedAt: string;
  revokedAt: string | null;
  ready: unknown;
};

export type PairingCodeCreated = {
  id: string;
  code: string;
  expiresAt: string;
};

export function listDevices() {
  return apiFetch<{ items: DeviceSummary[] }>('/devices', {
    tenantScoped: true,
  });
}

export function createPairingCode() {
  return apiFetch<PairingCodeCreated>('/devices/pairing-codes', {
    method: 'POST',
    tenantScoped: true,
  });
}

export function renameDevice(id: string, label: string) {
  return apiFetch<DeviceSummary>(`/devices/${id}`, {
    method: 'PATCH',
    tenantScoped: true,
    body: { label },
  });
}

export function unpairDevice(id: string) {
  return apiFetch<void>(`/devices/${id}/unpair`, {
    method: 'POST',
    tenantScoped: true,
  });
}
