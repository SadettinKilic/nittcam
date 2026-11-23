import type { Metadata } from 'next';
import { getMessages } from '../../../../lib/messages';
import { FieldKitView } from './field-kit-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.fieldKit.metaTitle} · ${messages.meta.title}`,
};

/**
 * Saha testi kiti (T191, D-092): the printable machine-day checklist for one machine, filled from
 * its profile, with the extended test program, the paper measurement form and the recorded test
 * downloads. "Yazdır" prints only the kit (the browser can save it as PDF).
 */
export default async function FieldKitPage({ params }: PageProps<'/makineler/[id]/saha-kiti'>) {
  const { id } = await params;
  return (
    <FieldKitView
      key={id}
      machineId={id}
      t={messages.fieldKit}
      verification={messages.verification}
      options={messages.machines.form.options}
    />
  );
}
