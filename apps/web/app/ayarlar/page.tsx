import type { Metadata } from 'next';
import { getMessages } from '../../lib/messages';
import { GeneralView } from './general-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.nav.settings} · ${messages.meta.title}`,
};

/** Ayarlar → Genel (T182, spec §3.4): company name and logo, new-project defaults. */
export default function SettingsPage() {
  return <GeneralView t={messages.settings} />;
}
