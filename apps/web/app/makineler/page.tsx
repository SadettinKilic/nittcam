import type { Metadata } from 'next';
import { parseParamFix } from '../../lib/machine-form';
import { getMessages } from '../../lib/messages';
import { MachinesView } from './machines-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.machines.title} · ${messages.meta.title}`,
};

/**
 * Makineler (spec §3.4): list + create/edit form. Data comes from `/api/machines`.
 * `?yeni=1` opens the new-machine form directly (home page quick action, T106).
 * `?duzenle=<id>&ayar=<kind>-<mm>&donus=<path>` opens that machine with a new parameter set and
 * offers the way back after saving (step 1 "Kesim ayarı ekle", T258).
 */
export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const fix = parseParamFix(query);
  return (
    <MachinesView
      key={`${String(query.yeni)}|${fix ? JSON.stringify(fix) : ''}`}
      t={messages.machines}
      startNew={query.yeni === '1'}
      fix={fix}
    />
  );
}
