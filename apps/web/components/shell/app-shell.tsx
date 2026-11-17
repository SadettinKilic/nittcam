'use client';

import { Sheet, SheetContent, SheetDescription, SheetTitle, TooltipProvider } from '@nittcam/ui';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isSidebarCollapsed, setSidebarCollapsed, subscribeSidebar } from '../../lib/sidebar-state';
import { ShellProvider } from './shell-context';
import { Sidebar, SidebarContent, type ShellText } from './sidebar';
import { TopBar } from './top-bar';

export interface AppShellProps {
  t: ShellText;
  company: string;
  children: ReactNode;
}

/** Dev-only pages (the /dev/ui gallery) render without the shell. */
function isBare(pathname: string): boolean {
  return pathname === '/dev' || pathname.startsWith('/dev/');
}

/**
 * Application frame (T103, spec §3.3/§3.7): collapsible sidebar on ≥ 768 px, a drawer below,
 * a sticky top bar and a skip link. Pages render their own <main> inside #content.
 */
export function AppShell({ t, company, children }: AppShellProps) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeSidebar, isSidebarCollapsed, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarCollapsed(!isSidebarCollapsed()), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // The drawer belongs to narrow screens: close it when the window grows past 768 px.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (wide.matches) setDrawerOpen(false);
    };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  if (isBare(pathname)) return <>{children}</>;

  return (
    <ShellProvider>
      <TooltipProvider>
        <a
          href="#content"
          className="sr-only z-50 rounded-md bg-surface-raised px-4 py-2 text-sm font-medium text-fg shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-solid focus:outline-2 focus:outline-focus"
        >
          {t.shell.skipToContent}
        </a>
        <div className="flex min-h-dvh">
          <Sidebar t={t} company={company} collapsed={collapsed} onToggle={toggleSidebar} />
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent
              side="left"
              closeLabel={t.shell.closeMenu}
              className="gap-0 bg-surface-subtle md:hidden"
              data-testid="shell-drawer"
            >
              <SheetTitle className="sr-only">{t.shell.menuTitle}</SheetTitle>
              <SheetDescription className="sr-only">{t.shell.workspace}</SheetDescription>
              <SidebarContent t={t} company={company} onNavigate={closeDrawer} />
            </SheetContent>
          </Sheet>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar t={t} onOpenMenu={() => setDrawerOpen(true)} />
            <div id="content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
              {children}
            </div>
          </div>
        </div>
      </TooltipProvider>
    </ShellProvider>
  );
}
