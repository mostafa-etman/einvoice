'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-provider';
import { useTenant } from '@/lib/tenant-provider';
import { cn } from '@/lib/cn';

function initials(name: string | null | undefined, email: string): string {
  const source = (name ?? '').trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function UserMenu({
  compact,
  tone = 'on-light',
}: {
  compact?: boolean;
  tone?: 'on-dark' | 'on-light';
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { roleName } = useTenant();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!user) return null;

  const mark = initials(user.name, user.email);
  const displayName = user.name?.trim() || user.email;

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={cn('relative', tone === 'on-dark' && 'mt-auto w-full')}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('shell.userMenu')}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-token-sm rounded-logo p-token-sm text-start transition',
          tone === 'on-dark'
            ? 'bg-nav-user text-on-dark hover:bg-nav-user-hover'
            : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
          compact && tone === 'on-dark' && 'justify-center bg-transparent px-token-xs',
        )}
      >
        <span
          className="flex size-avatar shrink-0 items-center justify-center rounded-md bg-gradient-brand font-en text-token-sm font-semibold text-on-dark"
          aria-hidden
        >
          {mark}
        </span>
        {!compact ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-nav font-medium text-on-dark">{displayName}</span>
            <span className="block truncate text-token-xs text-on-dark-muted">
              {roleName ?? user.email}
            </span>
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className={cn(
            'absolute z-40 min-w-token-2xl rounded-md border border-border bg-surface py-token-xs shadow-md',
            compact && tone === 'on-light' ? 'end-0 top-full mt-token-xs' : 'inset-inline-0 bottom-full mb-token-xs',
          )}
          onKeyDown={onMenuKey}
        >
          <div className="border-b border-border px-token-md py-token-sm">
            <p className="truncate text-token-sm font-medium text-foreground">{displayName}</p>
            <p className="truncate text-token-xs text-foreground-muted">{user.email}</p>
          </div>
          {user.isPlatformOperator ? (
            <Link
              href={`/${locale}/admin`}
              role="menuitem"
              className="block px-token-md py-token-xs text-token-sm text-foreground hover:bg-surface-hover"
              onClick={() => setOpen(false)}
            >
              {t('nav.platformAdmin')}
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="block w-full px-token-md py-token-xs text-start text-token-sm text-danger hover:bg-surface-hover"
            onClick={async () => {
              setOpen(false);
              await logout();
              router.push(`/${locale}/login`);
            }}
          >
            {t('nav.logout')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
