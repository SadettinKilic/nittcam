'use client';

/**
 * "Kullanılan … şablonu değişti. Güncellensin mi?" (T149, spec §4.7): asked once per newer
 * template version when a project that uses an older one is open. "Güncelle" = one
 * `updateTemplateVersion` (undoable); "Aynı kalsın" keeps the copy. Hand-changed params whose
 * template value also changed are listed as conflicts (the user's value is kept).
 */
import type { Project } from '@nittcam/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  formatMeasure,
  notify,
} from '@nittcam/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import { declineKey, pendingUpdates } from '../../lib/template-updates';
import { fetchTemplates, type TemplateItem } from '../../lib/templates-api';

type T = Messages['editor']['inspector']['template'];

function fieldName(t: T, key: string): string {
  if (key === 'count' || key === 'spacing' || key === 'edgeDistance') return t[key];
  return fill(t.diameter, { hole: key.slice(2) });
}

export function TemplateUpdatePrompt({
  t,
  project,
  run,
}: {
  t: T;
  project: Project;
  run: (command: string, params: unknown) => boolean;
}) {
  const uses = project.parts.some((p) => p.templates.length > 0);
  const [latest, setLatest] = useState<TemplateItem[] | null>(null);
  const [declined, setDeclined] = useState<ReadonlySet<string>>(() => new Set());

  // Checked once when a project with templates opens (and when its first template appears).
  useEffect(() => {
    if (!uses || latest !== null) return;
    let live = true;
    void fetchTemplates().then((items) => {
      if (live) setLatest(items ?? []);
    });
    return () => {
      live = false;
    };
  }, [uses, latest]);

  const update = useMemo(
    () => (latest ? (pendingUpdates(project, latest, declined)[0] ?? null) : null),
    [project, latest, declined],
  );
  if (!update) return null;
  const { item } = update;

  const decline = () => setDeclined((s) => new Set([...s, declineKey(item.id, item.version)]));
  const accept = () => {
    const ok = run('updateTemplateVersion', {
      templateId: item.id,
      version: item.version,
      geometry: item.geometry,
      defaults: item.params,
    });
    if (ok) notify.success(fill(t.update.done, { name: item.name }));
    else notify.error(t.refused);
    decline();
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && decline()}>
      <AlertDialogContent data-testid="template-update-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.update.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {fill(t.update.question, { name: item.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm text-fg-muted">
          {fill(t.update.detail, {
            part: update.parts.join(', '),
            from: update.from,
            to: item.version,
          })}
        </p>
        {update.conflicts.length > 0 ? (
          <ul
            className="flex flex-col gap-1 rounded-md border border-warning-border bg-warning-subtle p-3"
            data-testid="template-update-conflicts"
          >
            {update.conflicts.map((c) => (
              <li
                key={`${c.part}-${c.key}`}
                className="flex items-start gap-2 text-sm text-warning-text"
              >
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {c.part} ·{' '}
                  {fill(t.update.conflict, {
                    field: fieldName(t, c.key),
                    mine: formatMeasure(c.mine),
                    theirs: formatMeasure(c.theirs),
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="template-update-no">{t.update.no}</AlertDialogCancel>
          <AlertDialogAction data-testid="template-update-yes" onClick={accept}>
            {t.update.yes}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
