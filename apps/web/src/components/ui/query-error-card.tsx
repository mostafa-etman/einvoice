'use client';

import type { ReactNode } from 'react';
import { Card } from './card';
import { Button } from './button';

export type QueryErrorCardProps = {
  message: ReactNode;
  retryLabel: ReactNode;
  onRetry: () => void;
  testId?: string;
};

export function QueryErrorCard({
  message,
  retryLabel,
  onRetry,
  testId,
}: QueryErrorCardProps) {
  return (
    <Card className="border-danger" role="alert" data-testid={testId}>
      <p className="m-0 text-token-sm text-danger">{message}</p>
      <Button
        type="button"
        className="mt-token-sm"
        variant="secondary"
        size="sm"
        onClick={onRetry}
      >
        {retryLabel}
      </Button>
    </Card>
  );
}
