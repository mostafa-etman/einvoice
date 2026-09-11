import { Skeleton } from '@/components/ui/skeleton';

export function DashboardGateSkeleton() {
  return (
    <section data-testid="dashboard-gate-loading" aria-busy="true">
      <Skeleton variant="rect" className="mb-token-xs h-token-lg w-1/3" />
      <Skeleton className="mb-token-lg w-1/2" />
      <div className="mb-token-lg grid gap-token-md [grid-template-columns:repeat(auto-fit,minmax(min(100%,12.5rem),1fr))]">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-token-md">
            <Skeleton variant="rect" className="mb-token-sm size-token-xl rounded-md" />
            <Skeleton className="mb-token-xs w-2/3" />
            <Skeleton variant="rect" className="h-token-lg w-1/2" />
          </div>
        ))}
      </div>
    </section>
  );
}
