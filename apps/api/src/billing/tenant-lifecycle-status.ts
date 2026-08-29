import type { TenantActivationStatus } from '@prisma/client';

export type TenantLifecycleStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

export function tenantLifecycleStatus(input: {
  activationStatus: TenantActivationStatus;
  suspendedAt: Date | null;
}): TenantLifecycleStatus {
  if (input.activationStatus === 'PENDING') return 'PENDING';
  if (input.activationStatus === 'REJECTED') return 'REJECTED';
  if (input.suspendedAt) return 'SUSPENDED';
  return 'ACTIVE';
}

export function supportWhatsappUrl(e164: string): string {
  const digits = e164.replace(/\D/g, '').replace(/^00/, '');
  return `https://wa.me/${digits}`;
}
