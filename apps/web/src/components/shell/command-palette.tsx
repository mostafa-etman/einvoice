'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { flattenNav } from './nav-config';
import { NavGlyph } from './nav-icons';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const destinations = useMemo(() => flattenNav(locale), [locale]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return destinations;
    return destinations.filter((item) => t(item.labelKey).toLocaleLowerCase().includes(q));
  }, [destinations, query, t]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[active];
      if (item) go(item.href);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('shell.commandPalette')}
      description={t('shell.commandPaletteHint')}
      size="md"
      initialFocusRef={inputRef}
    >
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        placeholder={t('shell.quickSearch')}
        aria-label={t('shell.quickSearch')}
        aria-controls="shell-command-results"
      />
      <ul id="shell-command-results" role="listbox" className="mt-token-sm max-h-80 overflow-auto">
        {filtered.length === 0 ? (
          <li className="px-token-sm py-token-md text-token-sm text-foreground-muted">{t('common.states.empty')}</li>
        ) : (
          filtered.map((item, index) => (
            <li key={item.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={`flex w-full items-center gap-token-sm rounded-control px-token-sm py-token-sm text-start text-token-sm ${
                  index === active ? 'bg-brand-muted text-brand' : 'text-foreground hover:bg-surface-hover'
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item.href)}
              >
                <NavGlyph name={item.icon} />
                {t(item.labelKey)}
              </button>
            </li>
          ))
        )}
      </ul>
    </Modal>
  );
}

export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

export function usePaletteShortcutHint(): string {
  const [hint, setHint] = useState('Ctrl+K');
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/i.test(navigator.platform);
    setHint(mac ? '⌘K' : 'Ctrl+K');
  }, []);
  return hint;
}

export function CommandPaletteHost({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  useCommandPaletteShortcut(onOpen);
  const pathname = usePathname();
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);
  return <CommandPalette open={open} onClose={onClose} />;
}
