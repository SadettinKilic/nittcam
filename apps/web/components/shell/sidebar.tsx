'use client';

import {
  Button,
  Wordmark,
  RouterIcon,
  TooltipContent,
  TooltipRoot,
  TooltipTrigger,
  cn,
} from '@nittcam/ui';
import {
  FolderKanban,
  House,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  PencilRuler,
  Plus,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, type ComponentType, type ReactNode } from 'react';
import { useCompanyBrand } from '../../lib/company-brand';
import type { Messages } from '../../lib/messages';
import { NAV_ITEMS, NEW_PROJECT_HREF, isNavActive, type NavKey } from '../../lib/shell-nav';

export type ShellText = {
  nav: Messages['nav'];
  shell: Messages['shell'];
  palette: Messages['palette'];
  shortcuts: Messages['shortcuts'];
  /** Wizard step names, for the palette's in-project commands (P4). */
  steps: Messages['wizard']['steps'];
};

const ICONS: Record<NavKey, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  home: House,
  machines: RouterIcon,
  projects: FolderKanban,
  templates: LayoutTemplate,
  create: PencilRuler,
  settings: Settings,
};

const noop = () => {};

const row = cn(
  'group flex h-control-md items-center gap-3 rounded-md px-2.5 text-sm whitespace-nowrap',
  'transition-colors duration-(--duration-fast) ease-out',
  'rail-collapsed:justify-center rail-collapsed:px-0',
);

const focus =
  'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** Tooltip shown only on the collapsed rail (the label is visible otherwise). */
function RailTip({
  label,
  show,
  children,
}: {
  label: ReactNode;
  show: boolean;
  children: ReactNode;
}) {
  return (
    <TooltipRoot {...(show ? {} : { open: false })}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </TooltipRoot>
  );
}

/** Company / operator row at the bottom of the sidebar: the account and workspace (T194). */
function WorkspaceRow({
  t,
  company,
  collapsed,
}: {
  t: ShellText;
  company: string;
  collapsed: boolean;
}) {
  // T301: the saved company name and logo; `company` is the fallback until they are read.
  const brand = useCompanyBrand(company);
  return (
    <div className="px-3 pb-3 rail-collapsed:px-0">
      <RailTip label={`${brand.name} · ${t.shell.operator}`} show={collapsed}>
        <div
          data-testid="shell-workspace"
          className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface px-2.5 py-2 rail-collapsed:justify-center rail-collapsed:border-transparent rail-collapsed:bg-transparent rail-collapsed:px-0"
        >
          {brand.logoUrl ? (
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-active"
              data-testid="shell-company-logo"
            >
              {/* A user-uploaded image of unknown size: next/image would need a loader config. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-active text-xs font-semibold text-fg-muted"
            >
              {brand.name.slice(0, 1).toLocaleUpperCase('tr-TR')}
            </span>
          )}
          <div className="min-w-0 rail-collapsed:sr-only">
            <p
              className="truncate text-sm font-medium text-fg"
              data-testid="shell-company"
              title={brand.name}
            >
              {brand.name}
            </p>
            <p className="truncate text-xs text-fg-muted" data-testid="shell-operator">
              {t.shell.operator}
            </p>
          </div>
        </div>
      </RailTip>
    </div>
  );
}

export interface SidebarContentProps {
  t: ShellText;
  company: string;
  /** Desktop rail collapsed to icons: labels move into tooltips. */
  collapsed?: boolean;
  /** Called after a link is followed (closes the drawer). */
  onNavigate?: () => void;
  /** Rendered at the bottom (collapse button on the rail). */
  footer?: ReactNode;
}

/** Company block, "Yeni proje" and the menu; shared by the desktop rail and the mobile drawer. */
export function SidebarContent({
  t,
  company,
  collapsed = false,
  onNavigate = noop,
  footer,
}: SidebarContentProps) {
  const pathname = usePathname();
  const soonId = useId();
  const live = NAV_ITEMS.filter((i) => i.href);
  const soon = NAV_ITEMS.filter((i) => !i.href);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center px-4 rail-collapsed:justify-center rail-collapsed:px-0">
        <RailTip label={t.shell.brandHome} show={collapsed}>
          <Link
            href="/"
            onClick={onNavigate}
            aria-label={t.shell.brandHome}
            data-testid="shell-brand"
            className={cn('-mx-1 flex items-center rounded-md p-1', focus)}
          >
            <Wordmark size={24} className="rail-collapsed:hidden" />
            <Wordmark size={24} variant="short" className="hidden rail-collapsed:inline-block" />
          </Link>
        </RailTip>
      </div>

      <div className="px-3 pb-3 rail-collapsed:px-3">
        <RailTip label={t.nav.newProject} show={collapsed}>
          <Button
            asChild
            size="md"
            className="w-full justify-start gap-2 rail-collapsed:justify-center rail-collapsed:px-0"
          >
            <Link href={NEW_PROJECT_HREF} data-testid="nav-new-project" onClick={onNavigate}>
              <Plus aria-hidden />
              <span className="truncate rail-collapsed:sr-only">{t.nav.newProject}</span>
            </Link>
          </Button>
        </RailTip>
      </div>

      <nav
        aria-label={t.nav.label}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3"
      >
        <ul className="flex flex-col gap-0.5">
          {live.map(({ key, href }) => {
            const Icon = ICONS[key];
            const active = isNavActive(key, pathname);
            return (
              <li key={key}>
                <RailTip label={t.nav[key]} show={collapsed}>
                  <Link
                    href={href ?? '/'}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      row,
                      focus,
                      active
                        ? 'bg-surface-active font-medium text-fg'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-accent-text' : 'text-fg-subtle group-hover:text-fg-muted',
                      )}
                      aria-hidden
                    />
                    <span className="truncate rail-collapsed:sr-only">{t.nav[key]}</span>
                  </Link>
                </RailTip>
              </li>
            );
          })}
        </ul>
        {/* Not built yet: a muted group at the bottom, not between live items (T194a). */}
        {soon.length > 0 ? (
          <div className="mt-auto flex flex-col gap-0.5 pt-6" data-testid="nav-soon">
            <p
              id={soonId}
              className="px-2.5 pb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase rail-collapsed:sr-only"
            >
              {t.nav.soonGroup}
            </p>
            <ul aria-labelledby={soonId} className="flex flex-col gap-0.5">
              {soon.map(({ key }) => {
                const Icon = ICONS[key];
                return (
                  <li key={key}>
                    <RailTip label={`${t.nav[key]} (${t.nav.soon})`} show={collapsed}>
                      <span
                        aria-disabled="true"
                        className={cn(row, 'h-control-sm cursor-default text-fg-subtle')}
                      >
                        <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                        <span className="truncate rail-collapsed:sr-only">{t.nav[key]}</span>
                      </span>
                    </RailTip>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </nav>
      <WorkspaceRow t={t} company={company} collapsed={collapsed} />
      {footer}
    </div>
  );
}

export interface SidebarProps {
  t: ShellText;
  company: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Shortcut hint for the collapse button (from the shortcut registry). */
  toggleHint?: ReactNode;
}

/** Desktop sidebar (≥ 768 px): sticky, collapsible to an icon rail; state from <html data-sidebar>. */
export function Sidebar({ t, company, collapsed, onToggle, toggleHint }: SidebarProps) {
  const label = collapsed ? t.shell.expand : t.shell.collapse;
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside
      data-rail=""
      data-testid="shell-sidebar"
      className={cn(
        'sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-border-subtle bg-surface-subtle md:block',
        'transition-[width] duration-(--duration-slow) ease-out rail-collapsed:w-16',
      )}
    >
      <SidebarContent
        t={t}
        company={company}
        collapsed={collapsed}
        footer={
          <div className="border-t border-border-subtle p-3">
            <TooltipRoot>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggle}
                  aria-expanded={!collapsed}
                  aria-label={label}
                  data-testid="sidebar-toggle"
                  className={cn(
                    'flex h-control-md w-full items-center gap-3 rounded-md px-2.5 text-sm text-fg-muted whitespace-nowrap',
                    'transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-fg',
                    'rail-collapsed:justify-center rail-collapsed:px-0',
                    focus,
                  )}
                >
                  <ToggleIcon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate rail-collapsed:sr-only" aria-hidden="true">
                    {label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-2">
                {label}
                {toggleHint}
              </TooltipContent>
            </TooltipRoot>
          </div>
        }
      />
    </aside>
  );
}
