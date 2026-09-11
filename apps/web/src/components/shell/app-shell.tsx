'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { SendBlockedBanner } from '@/components/billing/send-blocked-banner';
import { getSidebarCollapsed, setSidebarCollapsed } from '@/lib/session';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MobileDrawer } from './mobile-drawer';
import { CommandPaletteHost, usePaletteShortcutHint } from './command-palette';
import { UserMenu } from './user-menu';

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const shortcutHint = usePaletteShortcutHint();

  useEffect(() => {
    setCollapsed(getSidebarCollapsed());
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      setSidebarCollapsed(next);
      return next;
    });
  };

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="flex min-h-screen">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onOpenPalette={openPalette}
          shortcutHint={shortcutHint}
          userBlock={<UserMenu compact={collapsed} tone="on-dark" />}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <SendBlockedBanner />
          <Topbar
            onOpenMobileNav={() => setMobileOpen(true)}
            onOpenPalette={openPalette}
            shortcutHint={shortcutHint}
          />
          <main className="flex-1 px-token-lg py-token-lg md:px-token-xl md:py-token-lg">{children}</main>
        </div>
      </div>
      <MobileDrawer open={mobileOpen} onClose={closeMobile} />
      <CommandPaletteHost open={paletteOpen} onOpen={openPalette} onClose={closePalette} />
    </div>
  );
}
