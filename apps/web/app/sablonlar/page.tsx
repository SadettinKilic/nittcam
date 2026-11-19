import type { Metadata } from 'next';
import { getMessages } from '../../lib/messages';
import { TemplatesView } from './templates-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.templatesPage.title} · ${messages.meta.title}`,
};

/**
 * Şablonlar (spec §3.4, §4.7; T151): company templates and the ready library, with preview,
 * parameter edit (a new immutable version), version history, duplicate and archive.
 */
export default function TemplatesPage() {
  return <TemplatesView t={messages.templatesPage} />;
}
