import type { Metadata } from 'next';
import { getMessages } from '../../lib/messages';
import { MachinesView } from './machines-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.machines.title} · ${messages.meta.title}`,
};

/** Makineler (spec §3.4): list + create/edit form. Data comes from `/api/machines`. */
export default function MachinesPage() {
  return <MachinesView t={messages.machines} />;
}
