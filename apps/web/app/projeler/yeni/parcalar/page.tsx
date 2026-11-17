import type { Metadata } from 'next';
import { getMessages } from '../../../../lib/messages';
import { DraftCutListEditor } from './cut-list-editor';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.cutList.title} · ${messages.meta.title}`,
};

/**
 * Oluştur → Parçalar (spec §3.6 step 2, §4.1): the cut-list table and Excel/CSV paste,
 * nesting and the layout view (T013).
 * A standalone page until the wizard (T023) wraps it and saves the project.
 */
export default function PartsPage() {
  return (
    <DraftCutListEditor
      t={messages.cutList}
      layoutText={messages.layout}
      simulateText={messages.simulation.open}
    />
  );
}
