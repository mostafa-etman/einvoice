import { apiFetch } from '@/lib/api/client';

export type SignatureJobSummary = {
  id: string;
  documentId: string;
  documentVersion: number;
  status: 'PENDING' | 'CLAIMED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  claimedByDeviceId: string | null;
  failureCode: string | null;
  createdAt: string;
};

export function listSigningJobs(params?: {
  status?: SignatureJobSummary['status'];
  documentId?: string;
}) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.documentId) q.set('documentId', params.documentId);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return apiFetch<{ items: SignatureJobSummary[] }>(`/signing/jobs${suffix}`, {
    tenantScoped: true,
  });
}
