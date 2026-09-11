import { Badge } from '@/components/ui/badge';
import { documentBadgeVariant } from './document-list-utils';

export function DocumentStatusBadge({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return <Badge variant={documentBadgeVariant(status)}>{label}</Badge>;
}
