import { PACKAGE_STEPS, packageStepIndex, type ExportJob } from '@/lib/api/exports';

export function PackageProgress({
  job,
  downloaded,
  label,
}: {
  job: ExportJob;
  downloaded: boolean;
  label: (key: string) => string;
}) {
  const stepLabelKeys: Record<string, string> = {
    REQUESTED: 'stepRequested',
    IN_PROGRESS: 'stepInProgress',
    READY: 'stepReady',
    DOWNLOADED: 'stepDownloaded',
  };
  const reached = packageStepIndex(job, downloaded);
  const failed = reached < 0;
  return (
    <span
      className="flex flex-wrap items-center gap-token-xs"
      data-testid={`package-progress-${job.id}`}
    >
      {PACKAGE_STEPS.map((step, index) => {
        const done = !failed && index <= reached;
        return (
          <span
            key={step}
            aria-current={done && index === reached ? 'step' : undefined}
            className={
              done
                ? 'rounded-pill bg-brand px-token-sm py-token-xs text-token-xs text-on-dark'
                : 'rounded-pill border border-border px-token-sm py-token-xs text-token-xs text-foreground-muted'
            }
          >
            {label(stepLabelKeys[step]!)}
          </span>
        );
      })}
    </span>
  );
}
