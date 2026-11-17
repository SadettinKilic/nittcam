import type { Metadata } from 'next';
import { getMessages } from '../../lib/messages';
import { ProjectsView } from './projects-view';

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.projects.title} · ${messages.meta.title}`,
};

/** Projeler (spec §3.4): the company's saved projects. Data comes from `/api/projects`. */
export default function ProjectsPage() {
  return <ProjectsView t={messages.projects} materials={messages.materials} />;
}
