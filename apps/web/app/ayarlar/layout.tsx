import type { ReactNode } from 'react';
import { SettingsNav } from '../../components/settings/settings-nav';
import { getMessages } from '../../lib/messages';

/** Ayarlar (spec §3.4): the section links above every settings page (T182). */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-6xl min-w-0 px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <SettingsNav t={getMessages().settings.nav} />
      </div>
      {children}
    </>
  );
}
