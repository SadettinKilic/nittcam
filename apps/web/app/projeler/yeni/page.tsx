import type { Metadata } from 'next';
import { ProjectWizard, toStep } from '../../../components/wizard/project-wizard';
import { getMessages } from '../../../lib/messages';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.wizard.titleNew} · ${messages.meta.title}`,
};

/**
 * Oluştur / + Yeni proje (spec §3.3, §3.6): the wizard on a new project. Nothing is stored until
 * the first change; the first autosave creates the project and the URL becomes `/projeler/<id>`.
 */
export default async function NewProjectPage({ searchParams }: PageProps<'/projeler/yeni'>) {
  const { adim } = await searchParams;
  return <ProjectWizard messages={messages} projectId={null} step={toStep(adim)} />;
}
