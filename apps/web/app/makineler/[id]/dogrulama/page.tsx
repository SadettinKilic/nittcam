import type { Metadata } from 'next';
import { getMessages } from '../../../../lib/messages';
import { VerificationView } from './verification-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.verification.title} · ${messages.meta.title}`,
};

/** Makine doğrulama (spec §7.3, T022): air cut → test cut → measurements → verified. */
export default async function VerificationPage({ params }: PageProps<'/makineler/[id]/dogrulama'>) {
  const { id } = await params;
  return (
    <VerificationView
      key={id}
      machineId={id}
      t={messages.verification}
      states={messages.machines.state}
      reasons={messages.wizard.export.reasons}
    />
  );
}
