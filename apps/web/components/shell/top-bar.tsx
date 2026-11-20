'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Wordmark,
  useTheme,
  type ThemeChoice,
} from '@nittcam/ui';
import { ChevronRight, Menu, Monitor, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, type ReactNode } from 'react';
import { breadcrumbs, type Crumb } from '../../lib/shell-nav';
import { useShellSlots } from './shell-context';
import type { ShellText } from './sidebar';

function crumbText(t: ShellText, crumb: Crumb): string {
  switch (crumb.key) {
    case 'newProject':
    case 'project':
    case 'verification':
    case 'materials':
    case 'dxfLayers':
    case 'appearance':
    case 'notFound':
      return t.shell.crumbs[crumb.key];
    default:
      return t.nav[crumb.key];
  }
}

/** Sistem / Açık / Koyu menu behind one icon button (sun in light, moon in dark). */
function ThemeMenu({ t, extra }: { t: ShellText['shell']['theme']; extra?: ReactNode }) {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={t.label} data-testid="theme-menu">
          {/* CSS picks the icon, so the server and client markup match. */}
          <Sun className="dark:hidden" aria-hidden />
          <Moon className="hidden dark:block" aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>{t.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={theme ?? 'system'}
          onValueChange={(v) => setTheme(v as ThemeChoice)}
        >
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden />
            {t.system}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden />
            {t.light}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden />
            {t.dark}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {extra}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface TopBarProps {
  t: ShellText;
  onOpenMenu: () => void;
  /** Search / command palette trigger (T104). */
  search?: ReactNode;
  /** Extra rows at the bottom of the theme menu (e.g. a shortcut hint). */
  themeExtra?: ReactNode;
}

/** Top bar (spec §3.3, §3.7): breadcrumb with the page title, page actions, save status, theme. */
export function TopBar({ t, onOpenMenu, search, themeExtra }: TopBarProps) {
  const pathname = usePathname();
  const slots = useShellSlots();
  const crumbs = breadcrumbs(pathname);
  const lastIndex = crumbs.length - 1;
  return (
    <header
      data-testid="shell-topbar"
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg/85 px-3 backdrop-blur-md sm:px-4 md:px-6"
    >
      <IconButton
        aria-label={t.shell.openMenu}
        data-testid="shell-menu-button"
        onClick={onOpenMenu}
        className="-ml-1 md:hidden"
      >
        <Menu aria-hidden />
      </IconButton>
      <Link
        href="/"
        aria-label={t.shell.brandHome}
        data-testid="shell-brand-mobile"
        className="flex shrink-0 items-center rounded-md p-1 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:hidden"
      >
        <Wordmark size={20} className="hidden min-[400px]:inline-block" />
        <Wordmark size={20} variant="short" className="min-[400px]:hidden" />
      </Link>

      {/* Phones (< 640 px): no breadcrumb, the page shows its own title (B4b); a page title set
          by the page (the project name, T240) stays visible here. */}
      <div className="flex min-w-0 flex-1 sm:hidden">
        {slots?.title || slots?.placeholder ? (
          <span
            data-testid="shell-title-mobile"
            title={slots.title ?? slots.placeholder ?? undefined}
            className="truncate px-1 text-sm font-semibold text-fg"
          >
            {slots.title ?? slots.placeholder}
          </span>
        ) : null}
      </div>
      <nav aria-label={t.shell.breadcrumb} className="hidden min-w-0 flex-1 sm:block">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs.map((crumb, i) => {
            const last = i === lastIndex;
            const text = last && slots?.title ? slots.title : crumbText(t, crumb);
            return (
              <Fragment key={`${crumb.key}-${i}`}>
                {i > 0 ? (
                  <li aria-hidden="true" className="hidden text-fg-subtle sm:block">
                    <ChevronRight className="size-3.5" />
                  </li>
                ) : null}
                <li className={last ? 'min-w-0' : 'hidden shrink-0 sm:block'}>
                  {last ? (
                    <span
                      aria-current="page"
                      data-testid="shell-title"
                      className="block truncate font-semibold text-fg"
                    >
                      {text}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href ?? '/'}
                      className="rounded-sm text-fg-muted transition-colors duration-(--duration-fast) outline-none hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {text}
                    </Link>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      <div
        ref={slots?.setActions}
        role="group"
        aria-label={t.shell.pageActions}
        className="flex shrink-0 items-center gap-2 empty:hidden"
      />
      <div ref={slots?.setStatus} className="flex min-w-0 items-center empty:hidden" />
      {search}
      <ThemeMenu t={t.shell.theme} extra={themeExtra} />
    </header>
  );
}
