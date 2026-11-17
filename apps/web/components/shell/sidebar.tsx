'use client';

import { Badge, Button, TooltipContent, TooltipRoot, TooltipTrigger, cn } from '@nittcam/ui';
import {
  Drill,
  FolderKanban,
  House,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  PencilRuler,
  Plus,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Messages } from '../../lib/messages';
import { NAV_ITEMS, NEW_PROJECT_HREF, isNavActive, type NavKey } from '../../lib/shell-nav';

export type ShellText = { nav: Messages['nav']; shell: Messages['shell'] };

const ICONS: Record<NavKey, LucideIcon> = {
  home: House,
  machines: Drill,
  projects: FolderKanban,
  templates: LayoutTemplate,
  create: PencilRuler,
  settings: Settings,
};

const noop = () => {};

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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-3 pt-4 pb-3 rail-collapsed:justify-center rail-collapsed:px-0">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-fg shadow-xs"
        >
          {company.slice(0, 1).toLocaleUpperCase('tr-TR')}
        </span>
        <div className="min-w-0 rail-collapsed:sr-only">
          <p className="truncate text-sm font-semibold text-fg" data-testid="shell-company">
            {company}
          </p>
          <p className="truncate text-xs text-fg-muted" data-testid="shell-operator">
            {t.shell.operator}
          </p>
        </div>
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

      <nav aria-label={t.nav.label} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ key, href }) => {
            const Icon = ICONS[key];
            const row = cn(
              'group flex h-control-md items-center gap-3 rounded-md px-2.5 text-sm whitespace-nowrap',
              'transition-colors duration-(--duration-fast) ease-out',
              'rail-collapsed:justify-center rail-collapsed:px-0',
              focus,
            );
            if (!href) {
              return (
                <li key={key}>
                  <RailTip label={`${t.nav[key]} (${t.nav.soon})`} show={collapsed}>
                    <span aria-disabled="true" className={cn(row, 'cursor-default text-fg-muted')}>
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex min-w-0 flex-1 items-center gap-2 rail-collapsed:sr-only">
                        <span className="truncate">{t.nav[key]}</span>
                        <Badge variant="neutral" className="ml-auto">
                          {t.nav.soon}
                        </Badge>
                      </span>
                    </span>
                  </RailTip>
                </li>
              );
            }
            const active = isNavActive(key, pathname);
            return (
              <li key={key}>
                <RailTip label={t.nav[key]} show={collapsed}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      row,
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
      </nav>
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
