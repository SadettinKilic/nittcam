'use client';

import { Link2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Messages } from '../../lib/messages';
import type { ProjectLinks } from '../../lib/project-links';
import { focusRing } from '../page/page-header';

/**
 * T292: on Parçalar, the project this one was split off from ("Kaynak proje") and the projects
 * split off from it ("Ayrı plaka projeleri"). Nothing when there are none or the load fails.
 * `version` reloads after a new split.
 */
export function ProjectLinksBar({
  t,
  projectId,
  version,
}: {
  t: Messages['wizard']['links'];
  projectId: string;
  version: number;
}) {
  const [links, setLinks] = useState<ProjectLinks | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/links`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<ProjectLinks>) : null))
      .catch(() => null)
      .then((l) => {
        if (live) setLinks(l);
      });
    return () => {
      live = false;
    };
  }, [projectId, version]);

  if (!links || (!links.source && links.derived.length === 0)) return null;
  const link = (l: { id: string; name: string }) => (
    <Link
      key={l.id}
      href={`/projeler/${l.id}?adim=parcalar`}
      className={`font-medium text-fg underline underline-offset-2 hover:text-accent-text ${focusRing}`}
      data-testid="project-link"
    >
      {l.name}
    </Link>
  );
  return (
    <p
      data-testid="project-links"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted"
    >
      <Link2 aria-hidden className="size-4 shrink-0" />
      {links.source ? (
        <span data-testid="project-links-source">
          {t.source}: {link(links.source)}
        </span>
      ) : null}
      {links.derived.length > 0 ? (
        <span data-testid="project-links-derived" className="flex flex-wrap gap-x-2">
          {t.derived}:{' '}
          {links.derived.map((l, i) => (
            <span key={l.id}>
              {link(l)}
              {i < links.derived.length - 1 ? ',' : ''}
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}
