'use client';

import type { BoardPart, Project } from '@nittcam/core';
import { Button, Measure } from '@nittcam/ui';
import { Copy, FlipHorizontal2, FlipVertical2, RotateCw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Messages } from '../../lib/messages';

export interface InspectorActions {
  mirrorH: () => void;
  mirrorV: () => void;
  rotate: () => void;
  duplicate: () => void;
  remove: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-row items-center justify-between gap-3 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

/**
 * Right inspector of the drawing board (compact density): what is selected, its size and board
 * position, and the edit actions. The full properties panel comes with T130.
 */
export function EditorInspector({
  t,
  project,
  selected,
  actions,
}: {
  t: Messages['editor']['inspector'];
  project: Project;
  selected: readonly BoardPart[];
  actions?: InspectorActions;
}) {
  const first = selected[0];
  const part = first ? project.parts.find((p) => p.id === first.id) : undefined;
  const box = selected.reduce(
    (a, x) => ({
      minX: Math.min(a.minX, x.box.minX),
      minY: Math.min(a.minY, x.box.minY),
      maxX: Math.max(a.maxX, x.box.maxX),
      maxY: Math.max(a.maxY, x.box.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  return (
    <section
      data-density="compact"
      className="flex flex-col gap-3 p-panel"
      aria-label={t.title}
      data-testid="editor-inspector"
    >
      <h2 className="text-sm font-semibold">
        {selected.length > 1
          ? t.many.replace('{count}', String(selected.length))
          : (part?.name.trim() ?? '') || t.title}
      </h2>
      {selected.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.none}</p>
      ) : (
        <>
          <div className="flex flex-col divide-y divide-border-subtle">
            {selected.length === 1 && part ? (
              <Row label={t.kind.title}>{t.kind[part.kind]}</Row>
            ) : null}
            <Row label={t.size}>
              <Measure
                value={[box.maxX - box.minX, box.maxY - box.minY]}
                unit="mm"
                mono
                data-testid="editor-size"
              />
            </Row>
            <Row label={t.position}>
              <span className="font-mono" data-testid="editor-position">
                X <Measure value={box.minX} mono /> · Y <Measure value={box.minY} mono />
              </span>
            </Row>
            {selected.length === 1 && part ? <Row label={t.qty}>{part.qty}</Row> : null}
          </div>
          {actions ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-fg-muted">{t.actions}</h3>
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" variant="outline" onClick={actions.mirrorH}>
                  <FlipHorizontal2 aria-hidden />
                  {t.mirrorH}
                </Button>
                <Button size="sm" variant="outline" onClick={actions.mirrorV}>
                  <FlipVertical2 aria-hidden />
                  {t.mirrorV}
                </Button>
                <Button size="sm" variant="outline" onClick={actions.rotate}>
                  <RotateCw aria-hidden />
                  {t.rotate}
                </Button>
                <Button size="sm" variant="outline" onClick={actions.duplicate}>
                  <Copy aria-hidden />
                  {t.duplicate}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="col-span-2 text-danger-text"
                  onClick={actions.remove}
                >
                  <Trash2 aria-hidden />
                  {t.remove}
                </Button>
              </div>
              <p className="text-xs text-fg-subtle">{t.keys}</p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
