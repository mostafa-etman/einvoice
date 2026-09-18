import { apiFetch } from './client';

export function submitFeedback(input: { screenKey: string; routePath: string; note: string }) {
  return apiFetch<{ id: string; status: string }>(
    '/feedback',
    { method: 'POST', body: input, tenantScoped: true },
  );
}
