import type { ReactNode } from 'react';
import Link from 'next/link';
import { CardTitle, CardDescription } from '@/components/ui/card';

const iconToneClass = {
  default: 'bg-gradient-brand-soft text-brand',
  warn: 'bg-warning-muted text-warning',
  teal: 'bg-brand-teal-muted text-brand-teal',
} as const;

export function SettingsTile({
  href,
  title,
  description,
  icon,
  tone = 'default',
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  tone?: keyof typeof iconToneClass;
}) {
  return (
    <Link
      href={href}
      className={
        tone === 'warn'
          ? 'block rounded-lg border border-warning bg-surface px-token-lg py-token-md shadow-sm transition hover:shadow-brand focus-visible:outline-none focus-visible:shadow-ring'
          : 'block rounded-lg border border-border bg-surface px-token-lg py-token-md shadow-sm transition hover:border-brand hover:shadow-brand focus-visible:outline-none focus-visible:shadow-ring'
      }
    >
      <span
        className={`mb-token-sm inline-flex size-token-xl items-center justify-center rounded-xl ${iconToneClass[tone]}`}
      >
        {icon}
      </span>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </Link>
  );
}

export function SettingsGroupTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 text-token-md font-semibold text-foreground">{children}</h2>
  );
}
