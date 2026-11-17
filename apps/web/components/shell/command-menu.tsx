'use client';

import {
  COMMAND_ID_SEPARATOR,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandShortcut,
  Kbd,
  type ThemeChoice,
} from '@nittcam/ui';
import {
  FileText,
  FolderKanban,
  House,
  Drill,
  Keyboard,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  SunMoon,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Messages } from '../../lib/messages';
import type { ProjectListItem } from '../../lib/projects-api';
import { NEW_PROJECT_HREF } from '../../lib/shell-nav';
import type { ShortcutId } from '../../lib/shortcuts';
import { ShortcutKeys } from './keys';

const RECENT = 5;

export interface CommandActions {
  navigate: (href: string) => void;
  setTheme: (theme: ThemeChoice) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  openHelp: () => void;
}

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: { palette: Messages['palette']; nav: Messages['nav']; shortcuts: Messages['shortcuts'] };
  actions: CommandActions;
}

type Recent =
  { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; items: ProjectListItem[] };

function PaletteItem({
  value,
  icon: Icon,
  keywords,
  shortcut,
  onSelect,
  then,
}: {
  value: string;
  icon: LucideIcon;
  keywords?: string;
  shortcut?: ShortcutId;
  onSelect: () => void;
  then: string;
}) {
  return (
    <CommandItem value={value} keywords={keywords ? keywords.split(' ') : []} onSelect={onSelect}>
      <Icon aria-hidden />
      <span className="truncate">{value}</span>
      {shortcut ? (
        <CommandShortcut>
          <ShortcutKeys id={shortcut} then={then} />
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
}

/** Ctrl/⌘+K palette (T104, spec §3.7): pages, new project, recent projects, theme, shortcuts. */
export function CommandMenu({ open, onOpenChange, t, actions }: CommandMenuProps) {
  const p = t.palette;
  const [recent, setRecent] = useState<Recent>({ status: 'loading' });
  // Show "loading" again on every opening (state adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRecent({ status: 'loading' });
  }

  // Recent projects are fetched each time the palette opens (they change while working).
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch('/api/projects', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const items = ((await res.json()) as ProjectListItem[]).slice(0, RECENT);
        if (live) setRecent({ status: 'ready', items });
      })
      .catch(() => {
        if (live) setRecent({ status: 'error' });
      });
    return () => {
      live = false;
    };
  }, [open]);

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={p.title}
      description={p.description}
      label={p.label}
      footer={
        <>
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {p.hintNavigate}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            {p.hintSelect}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            {p.hintClose}
          </span>
        </>
      }
    >
      <CommandInput placeholder={p.placeholder} aria-label={p.placeholder} />
      <CommandList>
        <CommandEmpty>{p.empty}</CommandEmpty>
        <CommandGroup heading={p.groups.pages}>
          <PaletteItem
            then={t.shortcuts.then}
            value={t.nav.home}
            icon={House}
            keywords={p.keywords.home}
            shortcut="goHome"
            onSelect={() => run(() => actions.navigate('/'))}
          />
          <PaletteItem
            then={t.shortcuts.then}
            value={t.nav.projects}
            icon={FolderKanban}
            keywords={p.keywords.projects}
            shortcut="goProjects"
            onSelect={() => run(() => actions.navigate('/projeler'))}
          />
          <PaletteItem
            then={t.shortcuts.then}
            value={t.nav.machines}
            icon={Drill}
            keywords={p.keywords.machines}
            shortcut="goMachines"
            onSelect={() => run(() => actions.navigate('/makineler'))}
          />
        </CommandGroup>
        <CommandGroup heading={p.groups.actions}>
          <PaletteItem
            then={t.shortcuts.then}
            value={t.nav.newProject}
            icon={Plus}
            keywords={p.keywords.newProject}
            shortcut="newProject"
            onSelect={() => run(() => actions.navigate(NEW_PROJECT_HREF))}
          />
          <PaletteItem
            then={t.shortcuts.then}
            value={t.shortcuts.items.toggleSidebar}
            icon={PanelLeft}
            keywords={p.keywords.sidebar}
            shortcut="toggleSidebar"
            onSelect={() => run(actions.toggleSidebar)}
          />
          <PaletteItem
            then={t.shortcuts.then}
            value={t.shortcuts.items.help}
            icon={Keyboard}
            keywords={p.keywords.help}
            shortcut="help"
            onSelect={() => run(actions.openHelp)}
          />
        </CommandGroup>
        {recent.status === 'loading' ? (
          <CommandGroup heading={p.groups.recent}>
            <CommandLoading>{p.recentLoading}</CommandLoading>
          </CommandGroup>
        ) : null}
        {recent.status === 'error' ? (
          <CommandGroup heading={p.groups.recent}>
            <p role="status" className="px-2 py-2 text-sm text-danger-text">
              {p.recentError}
            </p>
          </CommandGroup>
        ) : null}
        {recent.status === 'ready' && recent.items.length > 0 ? (
          <CommandGroup heading={p.groups.recent}>
            {recent.items.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.name}${COMMAND_ID_SEPARATOR}${item.id}`}
                keywords={[item.machine ?? '', item.material].filter(Boolean)}
                onSelect={() => run(() => actions.navigate(`/projeler/${item.id}`))}
                data-testid="palette-recent"
              >
                <FileText aria-hidden />
                <span className="truncate">{item.name}</span>
                {item.machine ? (
                  <span className="ml-auto truncate text-xs text-fg-muted">{item.machine}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading={p.groups.theme}>
          <PaletteItem
            then={t.shortcuts.then}
            value={t.shortcuts.items.toggleTheme}
            icon={SunMoon}
            keywords={p.keywords.theme}
            shortcut="toggleTheme"
            onSelect={() => run(actions.toggleTheme)}
          />
          <PaletteItem
            then={t.shortcuts.then}
            value={p.themeLight}
            icon={Sun}
            keywords={p.keywords.theme}
            onSelect={() => run(() => actions.setTheme('light'))}
          />
          <PaletteItem
            then={t.shortcuts.then}
            value={p.themeDark}
            icon={Moon}
            keywords={p.keywords.theme}
            onSelect={() => run(() => actions.setTheme('dark'))}
          />
          <PaletteItem
            then={t.shortcuts.then}
            value={p.themeSystem}
            icon={Monitor}
            keywords={p.keywords.theme}
            onSelect={() => run(() => actions.setTheme('system'))}
          />
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
