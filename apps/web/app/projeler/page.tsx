import type { Metadata } from 'next';
import { getMessages } from '../../lib/messages';
import { projectTabOf } from '../../lib/project-list';
import { ProjectsView } from './projects-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.projects.title} · ${messages.meta.title}`,
};

/**
 * Projeler (spec §3.4): the company's saved projects. Data comes from `/api/projects`;
 * `?sekme=artik|silinenler` opens the offcut stock or the deleted projects (T178).
 */
export default async function ProjectsPage({ searchParams }: PageProps<'/projeler'>) {
  const { sekme } = await searchParams;
  return (
    <ProjectsView
      t={messages.projects}
      materials={messages.materials}
      materialHead={messages.materialHead}
      initialTab={projectTabOf(sekme)}
    />
  );
}
