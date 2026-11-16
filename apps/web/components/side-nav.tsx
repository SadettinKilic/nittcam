'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Messages } from '../lib/messages';

type NavText = Messages['nav'];

/** Menu of spec §3.3. Ana sayfa, Makineler and Oluştur (parts step) work so far; the rest are placeholders. */
const ITEMS: { key: keyof NavText; href?: string }[] = [
  { key: 'home', href: '/' },
  { key: 'machines', href: '/makineler' },
  { key: 'projects' },
  { key: 'templates' },
  { key: 'create', href: '/projeler/yeni/parcalar' },
  { key: 'settings' },
];

const itemClass =
  'block rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function SideNav({ t }: { t: NavText }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={t.label}
      className="flex w-full shrink-0 flex-col gap-4 border-b border-border bg-sidebar p-4 md:min-h-screen md:w-56 md:border-r md:border-b-0"
    >
      <p className="px-3 text-lg font-semibold tracking-tight">NittCam</p>
      <span
        aria-disabled="true"
        title={t.soon}
        className="rounded-lg border border-dashed border-accent px-3 py-2 text-center text-sm font-medium text-accent"
      >
        {t.newProject}
      </span>
      <ul className="flex flex-row flex-wrap gap-1 md:flex-col">
        {ITEMS.map(({ key, href }) => {
          if (!href) {
            return (
              <li key={key}>
                <span aria-disabled="true" className={`${itemClass} text-fg-muted`}>
                  {t[key]} <span className="text-xs">({t.soon})</span>
                </span>
              </li>
            );
          }
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`${itemClass} ${active ? 'bg-bg font-medium text-fg shadow-sm' : 'text-fg hover:bg-bg'}`}
              >
                {t[key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
