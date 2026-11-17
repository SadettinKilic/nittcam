import type { Metadata } from 'next';
import { SimulationView } from '../../../../components/simulation/simulation-view';
import { getMessages } from '../../../../lib/messages';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.simulation.title} · ${messages.meta.title}`,
};

/**
 * Oluştur → Önizleme / simülasyon (spec §3.6 step 4, §6.5): the draft project of the parts step,
 * drawn from the generated and read-back G-code. A standalone page until the wizard (T023).
 */
export default function SimulationPage() {
  return <SimulationView t={messages.simulation} />;
}
