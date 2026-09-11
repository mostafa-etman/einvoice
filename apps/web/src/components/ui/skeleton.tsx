import { cn } from '@/lib/cn';

export type SkeletonProps = {
  variant?: 'text' | 'rect';
  className?: string;
};

export function Skeleton({ variant = 'text', className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'block animate-pulse rounded-sm bg-gradient-skeleton',
        variant === 'text' ? 'h-token-sm w-full' : 'h-token-xl w-full',
        className,
      )}
    />
  );
}
