import type { Metadata } from 'next';
import { getMessages } from '../../lib/messages';
import { MachinesView } from './machines-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.machines.title} · ${messages.meta.title}`,
};

/**
 * Makineler (spec §3.4): list + create/edit form. Data comes from `/api/machines`.
 * `?yeni=1` opens the new-machine form directly (home page quick action, T106).
 */
export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { yeni } = await searchParams;
  return <MachinesView key={String(yeni)} t={messages.machines} startNew={yeni === '1'} />;
}
