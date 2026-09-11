import { Badge, type BadgeVariant } from '@/components/ui/badge';

function variantFor(status: string): BadgeVariant {
  const upper = status.toUpperCase();
  if (upper === 'SUCCEEDED' || upper === 'READY' || upper === 'VALIDATED') return 'success';
  if (upper === 'PARTIAL' || upper === 'VALIDATING' || upper === 'RUNNING') return 'warning';
  if (upper === 'FAILED' || upper === 'EXPIRED') return 'danger';
  return 'neutral';
}

export function JobStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={variantFor(status)}>
      <span dir="ltr">{status}</span>
    </Badge>
  );
}
