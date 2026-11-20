import type { Metadata } from 'next';
import { getMessages } from '../../../lib/messages';
import { DxfLayersView } from './dxf-layers-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.settings.dxf.title} · ${messages.meta.title}`,
};

/** Ayarlar → DXF katmanları (T182, spec §3.4, §4.6): the company layer mapping editor. */
export default function DxfLayersPage() {
  return <DxfLayersView t={messages.settings} ops={messages.dxfImport.layers.ops} />;
}
