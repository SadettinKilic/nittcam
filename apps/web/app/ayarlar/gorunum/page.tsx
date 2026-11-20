import type { Metadata } from 'next';
import { getMessages } from '../../../lib/messages';
import { AppearanceView } from './appearance-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.settings.appearance.title} · ${messages.meta.title}`,
};

/** Ayarlar → Görünüm (T183, spec §3.7): theme, density, 3D simple mode, motion, shortcuts. */
export default function AppearancePage() {
  return (
    <AppearanceView
      t={messages.settings.appearance}
      theme={messages.shell.theme}
      shortcuts={messages.shortcuts}
    />
  );
}
