import { Badge } from '@/components/ui/badge';
import { etaStatusBadgeVariant } from './purchase-list-utils';

export function PurchaseStatusBadge({
  status,
  label,
}: {
  status: string | null | undefined;
  label: string;
}) {
  return <Badge variant={etaStatusBadgeVariant(status)}>{label}</Badge>;
}
