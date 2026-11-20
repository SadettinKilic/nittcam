'use client';

import { cn } from '@nittcam/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Messages } from '../../lib/messages';
import { focusRing } from '../page/page-header';

type Text = Messages['settings']['nav'];

/** Ayarlar sections (T182, T183; spec §3.4 Ayarlar). */
export const SETTINGS_SECTIONS = [
  { key: 'general', href: '/ayarlar' },
  { key: 'materials', href: '/ayarlar/malzemeler' },
  { key: 'dxf', href: '/ayarlar/dxf' },
] as const;

/** The Ayarlar sub-navigation: a row of links, the current one marked (`aria-current="page"`). */
export function SettingsNav({ t }: { t: Text }) {
  const pathname = usePathname().replace(/\/+$/, '') || '/';
  return (
    <nav aria-label={t.label} data-testid="settings-nav" className="-mx-1 overflow-x-auto">
      <ul className="flex w-max gap-1 border-b border-border px-1">
        {SETTINGS_SECTIONS.map((s) => {
          const current = pathname === s.href;
          return (
            <li key={s.key}>
              <Link
                href={s.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-9 items-center border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-(--duration-fast)',
                  focusRing,
                  current
                    ? 'border-accent font-medium text-fg'
                    : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                {t[s.key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
