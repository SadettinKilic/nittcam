import type { Metadata } from 'next';
import { HelpView } from '../../components/help/help-view';
import { getMessages } from '../../lib/messages';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.help.metaTitle} · ${messages.meta.title}`,
};

/** Yardım (T192, D-095): the Turkish help topics with a search; "Yenilikler" opens from here too. */
export default function HelpPage() {
  return (
    <HelpView t={messages.help} latestRelease={messages.whatsNew.releases[0]?.version ?? ''} />
  );
}
