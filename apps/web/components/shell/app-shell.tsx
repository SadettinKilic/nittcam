'use client';

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Toaster,
  TooltipProvider,
  useTheme,
} from '@nittcam/ui';
import { SunMoon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { NEW_PROJECT_HREF } from '../../lib/shell-nav';
import { useMediaQuery } from '../../lib/use-media-query';
import {
  OPEN_SHORTCUTS_EVENT,
  SHORTCUT_GROUPS,
  currentPageGroup,
  type ShortcutGroup,
  SHORTCUTS,
  createShortcutMatcher,
  isPageClaimedKey,
  isTypingTarget,
} from '../../lib/shortcuts';
import {
  RAIL_BELOW_PX,
  isSidebarCollapsed,
  setSidebarCollapsed,
  subscribeSidebar,
  syncSidebar,
} from '../../lib/sidebar-state';
import { CommandMenu, type CommandActions } from './command-menu';
import { ShortcutKeys, useIsMac } from './keys';
import { ShellProvider } from './shell-context';
import { ShortcutsDialog } from './shortcuts-dialog';
import { useReturnFocus } from './use-return-focus';
import { SearchButton } from './search-button';
import { Sidebar, SidebarContent, type ShellText } from './sidebar';
import { TopBar } from './top-bar';
import { guardedNavigate } from '../../lib/navigation-guard';

export interface AppShellProps {
  t: ShellText;
  company: string;
  children: ReactNode;
}

/** Dev-only pages (the /dev/ui gallery) render without the shell. */
/** The project wizard: `/projeler/yeni` and `/projeler/<id>` (not the list or other pages). */
export function isWizard(pathname: string): boolean {
  return /^\/projeler\/(yeni|[0-9a-f-]{36})\/?$/i.test(pathname);
}

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // T136: a page's own sheet (the board's) instead of the full list; null = every group.
  const [helpGroup, setHelpGroup] = useState<ShortcutGroup | null>(null);
  // Overlays open from state (no Radix Trigger): give focus back to whoever opened them.
  const drawerFocus = useReturnFocus();
  const paletteFocus = useReturnFocus();
  const helpFocus = useReturnFocus();
  const rememberPalette = paletteFocus.remember;
  const rememberHelp = helpFocus.remember;
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const isMac = useIsMac();
  const bare = isBare(pathname);
  const wizard = isWizard(pathname);
  const phone = !useMediaQuery('(min-width: 768px)', true);

  const actions = useMemo<CommandActions>(
    () => ({
      navigate: (href) => guardedNavigate(href, (to) => router.push(to)),
      setTheme,
      toggleTheme: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      toggleSidebar,
      // After the palette has closed and given focus back, so the dialogs do not fight over it.
      openHelp: () =>
        window.setTimeout(() => {
          rememberHelp();
          setHelpGroup(null);
          setHelpOpen(true);
        }, 0),
    }),
    [router, setTheme, resolvedTheme, toggleSidebar, rememberHelp],
  );

  // Pages open the help too (the board status bar "?", T242).
  useEffect(() => {
    const open = (e: Event) => {
      const detail = e instanceof CustomEvent ? (e.detail as unknown) : null;
      rememberHelp();
      setHelpGroup(SHORTCUT_GROUPS.find((g) => g === detail) ?? null);
      setHelpOpen(true);
    };
    window.addEventListener(OPEN_SHORTCUTS_EVENT, open);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, open);
  }, [rememberHelp]);

  // Global shortcuts from the registry (T104); ignored while typing, except the palette.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  useEffect(() => {
    if (bare) return;
    const match = createShortcutMatcher(SHORTCUTS, isMac);
    function onKey(e: KeyboardEvent) {
      // Keys a page already handled, or owns while open (board tools V/H/R/C/L/A/F), stay there.
      if (e.defaultPrevented || e.isComposing || e.repeat || isPageClaimedKey(e)) return;
      const hit = match(e, isTypingTarget(e.target as Element | null), e.timeStamp);
      if (!hit) return;
      // Inside an open dialog (palette, help, forms) only the palette toggle works.
      const inDialog = (e.target as Element | null)?.closest?.(
        '[role="dialog"],[role="alertdialog"]',
      );
      if (inDialog && hit.id !== 'palette') return;
      e.preventDefault();
      const a = actionsRef.current;
      switch (hit.id) {
        case 'palette':
          if (!inDialog) rememberPalette();
          setPaletteOpen((o) => !o);
          break;
        case 'help':
          rememberHelp();
          setHelpGroup(currentPageGroup());
          setHelpOpen(true);
          break;
        case 'toggleTheme':
          a.toggleTheme();
          break;
        case 'toggleSidebar':
          a.toggleSidebar();
          break;
        case 'goHome':
          a.navigate('/');
          break;
        case 'goProjects':
          a.navigate('/projeler');
          break;
        case 'goMachines':
          a.navigate('/makineler');
          break;
        case 'newProject':
          a.navigate(NEW_PROJECT_HREF);
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bare, isMac, rememberPalette, rememberHelp]);

  // The drawer belongs to narrow screens: close it when the window grows past 768 px.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (wide.matches) setDrawerOpen(false);
    };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  // T263: crossing 1440 px switches between the workspace rail rule and the stored choice.
  useEffect(() => {
    const laptop = window.matchMedia(`(min-width: ${RAIL_BELOW_PX}px)`);
    laptop.addEventListener('change', syncSidebar);
    return () => laptop.removeEventListener('change', syncSidebar);
  }, []);

  if (bare) return <>{children}</>;

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
          <Sidebar
            t={t}
            company={company}
            collapsed={collapsed}
            onToggle={toggleSidebar}
            toggleHint={<ShortcutKeys id="toggleSidebar" />}
          />
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent
              side="left"
              closeLabel={t.shell.closeMenu}
              className="gap-0 bg-surface-subtle md:hidden"
              data-testid="shell-drawer"
              onCloseAutoFocus={drawerFocus.onCloseAutoFocus}
            >
              <SheetTitle className="sr-only">{t.shell.menuTitle}</SheetTitle>
              <SheetDescription className="sr-only">{t.shell.workspace}</SheetDescription>
              <SidebarContent t={t} company={company} onNavigate={closeDrawer} />
            </SheetContent>
          </Sheet>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar
              t={t}
              onOpenMenu={() => {
                drawerFocus.remember();
                setDrawerOpen(true);
              }}
              search={
                <SearchButton
                  t={t.shell}
                  onOpen={() => {
                    rememberPalette();
                    setPaletteOpen(true);
                  }}
                />
              }
              themeExtra={
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={actions.toggleTheme}>
                    <SunMoon aria-hidden />
                    {t.shortcuts.items.toggleTheme}
                    <DropdownMenuShortcut>
                      <ShortcutKeys id="toggleTheme" />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </>
              }
            />
            <div id="content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
              {children}
            </div>
          </div>
        </div>
        <CommandMenu
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          t={{ palette: t.palette, nav: t.nav, shortcuts: t.shortcuts }}
          actions={actions}
          onCloseAutoFocus={paletteFocus.onCloseAutoFocus}
          steps={wizard ? t.steps : null}
        />
        <ShortcutsDialog
          open={helpOpen}
          onOpenChange={setHelpOpen}
          group={helpGroup}
          onShowAll={() => setHelpGroup(null)}
          t={t.shortcuts}
          onCloseAutoFocus={helpFocus.onCloseAutoFocus}
        />
        {/* P4 (CTO #8–#10): in the project wizard the toasts sit top-centre just under the wizard
            header (--wizard-head-bottom), so they never cover the right panel, the canvas scale bar
            or the footer actions; a step change closes them. Elsewhere bottom-right as usual. */}
        {wizard && !phone ? (
          <Toaster
            position="top-center"
            offset={{ top: 'calc(var(--wizard-head-bottom, 56px) + 8px)' }}
          />
        ) : wizard ? (
          // Phones: top-centre would cover the canvas bar (Liste / Çizim, zoom); above the sticky
          // footer instead, so its actions stay reachable.
          <Toaster
            offset={{ bottom: 'calc(var(--wizard-footer-h, 0px) + 16px)' }}
            mobileOffset={{ bottom: 'calc(var(--wizard-footer-h, 0px) + 16px)' }}
          />
        ) : (
          <Toaster />
        )}
      </TooltipProvider>
    </ShellProvider>
  );
}
