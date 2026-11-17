import type { Metadata } from 'next';
import { ProjectWizard } from '../../../components/wizard/project-wizard';
import { toStep } from '../../../lib/wizard-steps';
import { getMessages } from '../../../lib/messages';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.projects.title} · ${messages.meta.title}`,
};

/** A saved project in the wizard (spec §3.6); `?adim=` keeps the step across reloads. */
export default async function ProjectPage({ params, searchParams }: PageProps<'/projeler/[id]'>) {
  const { id } = await params;
  const { adim } = await searchParams;
  return <ProjectWizard key={id} messages={messages} projectId={id} step={toStep(adim)} />;
}
