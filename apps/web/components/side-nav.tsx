'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Messages } from '../lib/messages';

type NavText = Messages['nav'];

const NEW = '/projeler/yeni';

/** Is the current page under this menu item? Oluştur owns the new-project wizard. */
function isActive(key: keyof NavText, pathname: string): boolean {
  switch (key) {
    case 'home':
      return pathname === '/';
    case 'machines':
      return pathname.startsWith('/makineler');
    case 'projects':
      return (
        pathname === '/projeler' || (pathname.startsWith('/projeler/') && !pathname.startsWith(NEW))
      );
    case 'create':
      return pathname.startsWith(NEW);
    default:
      return false;
  }
}

/** Menu of spec §3.3. Şablonlar and Ayarlar are placeholders ("yakında"). */
const ITEMS: { key: keyof NavText; href?: string }[] = [
  { key: 'home', href: '/' },
  { key: 'machines', href: '/makineler' },
  { key: 'projects', href: '/projeler' },
  { key: 'templates' },
  { key: 'create', href: NEW },
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
      <Link
        href={NEW}
        data-testid="nav-new-project"
        className="rounded-lg bg-accent px-3 py-2 text-center text-sm font-semibold text-accent-fg shadow-sm hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {t.newProject}
      </Link>
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
          const active = isActive(key, pathname);
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
