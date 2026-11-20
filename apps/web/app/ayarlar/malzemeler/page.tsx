import type { Metadata } from 'next';
import { getMessages } from '../../../lib/messages';
import { MaterialsView } from './materials-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.materialLibrary.title} · ${messages.meta.title}`,
};

/** Ayarlar → Malzemeler (T121, spec §3.4): the company material & stock library. */
export default function MaterialsPage() {
  return <MaterialsView t={messages.materialLibrary} kinds={messages.materials} />;
}
