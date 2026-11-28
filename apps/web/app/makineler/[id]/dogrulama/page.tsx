import type { Metadata } from 'next';
import { getMessages } from '../../../../lib/messages';
import { VerificationView } from './verification-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.verification.title} · ${messages.meta.title}`,
};

/** Makine doğrulama (spec §7.3, T022): air cut → test cut → measurements → verified. */
export default async function VerificationPage({
  params,
  searchParams,
}: PageProps<'/makineler/[id]/dogrulama'>) {
  const { id } = await params;
  // T356: `?aile=kompozit` = the ACM (composite) family; anything else = the wood board family.
  const family = (await searchParams).aile === 'kompozit' ? 'composite' : 'woodBoard';
  return (
    <VerificationView
      key={`${id}-${family}`}
      machineId={id}
      family={family}
      t={messages.verification}
      states={messages.machines.state}
      reasons={messages.wizard.export.reasons}
    />
  );
}
