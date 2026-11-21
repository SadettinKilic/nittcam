'use client';

import type { BoardPart, Project } from '@nittcam/core';
import {
  IconButton,
  InspectorRow as Row,
  InspectorRows,
  Measure,
  Tooltip,
  cn,
  formatMeasure,
} from '@nittcam/ui';
import { Copy, FlipHorizontal2, FlipVertical2, RotateCw, Trash2 } from 'lucide-react';
import type { BoardSummary } from '../../lib/editor/summary';
import type { Messages } from '../../lib/messages';
import { ariaKeyShortcuts, shortcutById, shortcutText, type ShortcutId } from '../../lib/shortcuts';
import { HoleProperties } from './hole-properties';
import { PartProperties, type Run, type SubSelection } from './properties';
import { TemplateProperties } from './template-properties';
import type { PendingTemplate } from '../../lib/editor/template-place';
import { useIsMac } from '../shell/keys';

export interface InspectorActions {
  mirrorH: () => void;
  mirrorV: () => void;
  rotate: () => void;
  duplicate: () => void;
  remove: () => void;
}

const ACTIONS: readonly {
  id: keyof InspectorActions;
  shortcut: ShortcutId;
  Icon: typeof Copy;
}[] = [
  { id: 'mirrorH', shortcut: 'boardMirrorH', Icon: FlipHorizontal2 },
  { id: 'mirrorV', shortcut: 'boardMirrorV', Icon: FlipVertical2 },
  { id: 'rotate', shortcut: 'boardRotate', Icon: RotateCw },
  { id: 'duplicate', shortcut: 'boardDuplicate', Icon: Copy },
  { id: 'remove', shortcut: 'boardDelete', Icon: Trash2 },
];

/**
 * The selection's edit actions as one row of 32 px icon buttons (T242, D-039): tooltip
 * "Ad · kısayol", an aria-label and aria-keyshortcuts each; "Sil" after a separator in the
 * danger text colour. Used in the inspector and as the phone mini-toolbar over the selection.
 */
export function BoardActionBar({
  t,
  label,
  actions,
  className,
  testId = 'editor-actions',
}: {
  t: Messages['editor']['inspector'];
  label: string;
  actions: InspectorActions;
  className?: string;
  testId?: string;
}) {
  const isMac = useIsMac();
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-testid={testId}
      className={cn('flex items-center gap-0.5', className)}
    >
      {ACTIONS.map(({ id, shortcut, Icon }) => (
        <span key={id} className="contents">
          {id === 'remove' ? <span aria-hidden className="mx-1 h-5 w-px bg-border" /> : null}
          <Tooltip content={`${t[id]} · ${shortcutText(shortcut, isMac)}`}>
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={t[id]}
              aria-keyshortcuts={ariaKeyShortcuts(shortcutById(shortcut).keys, isMac)}
              data-testid={`${testId}-${id}`}
              className={cn(
                // 32 px also inside the compact panel (its control-sm is 28 px).
                'size-8 [--spacing-control-sm:2rem]',
                id === 'remove' ? 'text-danger-text hover:text-danger-text' : 'text-fg',
              )}
              onClick={actions[id]}
            >
              <Icon aria-hidden />
            </IconButton>
          </Tooltip>
        </span>
      ))}
    </div>
  );
}

/**
 * Right inspector of the drawing board (compact density): what is selected, its size and board
 * position, the edit actions and, for one part, the properties panel (T130).
 */
export function EditorInspector({
  t,
  project,
  selected,
  actions,
  summary,
  run,
  sub = null,
  onSub,
  toolRadius,
  pendingTemplate = null,
  onPendingTemplate,
}: {
  t: Messages['editor']['inspector'];
  project: Project;
  selected: readonly BoardPart[];
  actions?: InspectorActions;
  /** Runs a command (the properties panel edits, T130). Without it the panel is read-only. */
  run?: Run;
  /** Selected segment / vertex of the single selected part. */
  sub?: SubSelection;
  onSub?: (sub: SubSelection) => void;
  /** Tool radius of the selected machine, mm (T131/T132). */
  toolRadius?: number;
  /** With nothing selected: counts, total area and extents of the board (T242). */
  summary?: BoardSummary;
  /** The template being placed (T148), with its setter; without the setter no template group. */
  pendingTemplate?: PendingTemplate | null;
  onPendingTemplate?: (p: PendingTemplate | null) => void;
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
  // B50 (CTO #7, #8): holes and templates sit right under "Parça" as collapsed summary rows.
  const partExtras =
    selected.length === 1 && part && run ? (
      <>
        <HoleProperties
          t={t.hole}
          part={part}
          run={run}
          thickness={project.stock.thickness}
          toolDiameter={(toolRadius ?? 0) * 2}
          picked={sub?.kind === 'hole' ? sub.index : null}
        />
        {onPendingTemplate ? (
          <TemplateProperties
            t={t.template}
            part={part}
            run={run}
            pending={pendingTemplate}
            onPending={onPendingTemplate}
          />
        ) : null}
      </>
    ) : null;
  return (
    <section
      data-density="compact"
      className="flex flex-col gap-3 p-panel"
      aria-label={t.title}
      data-testid="editor-inspector"
    >
      <h2 className="text-sm font-semibold lg:hidden">
        {selected.length > 1
          ? t.many.replace('{count}', String(selected.length))
          : (part?.name.trim() ?? '') || t.title}
      </h2>
      {selected.length === 0 ? (
        <>
          {summary && summary.parts > 0 ? (
            <InspectorRows data-testid="editor-summary">
              <Row label={t.summary.parts}>
                <span className="font-mono tabular-nums">{summary.parts}</span>
              </Row>
              <Row label={t.summary.pieces}>
                <span className="font-mono tabular-nums">{summary.pieces}</span>
              </Row>
              <Row label={t.summary.area}>
                <span className="font-mono tabular-nums" data-testid="editor-summary-area">
                  {formatMeasure(summary.areaM2, { decimals: 2 })} {t.summary.areaUnit}
                </span>
              </Row>
              {summary.extents ? (
                <Row label={t.summary.extents}>
                  <Measure
                    value={[summary.extents.w, summary.extents.h]}
                    unit="mm"
                    mono
                    data-testid="editor-summary-extents"
                  />
                </Row>
              ) : null}
            </InspectorRows>
          ) : null}
          <p className="text-xs text-fg-subtle">{t.none}</p>
        </>
      ) : (
        <>
          <InspectorRows>
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
          </InspectorRows>
          {actions ? (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-fg-muted">{t.actions}</h3>
              <BoardActionBar t={t} label={t.actions} actions={actions} className="-ml-1" />
            </div>
          ) : null}
          {selected.length === 1 && part && first && run && onSub ? (
            <PartProperties
              t={t}
              part={part}
              at={first.at}
              run={run}
              sub={sub}
              onSub={onSub}
              toolRadius={toolRadius ?? 0}
              thickness={project.stock.thickness}
              afterPart={partExtras}
            />
          ) : (
            partExtras
          )}
        </>
      )}
    </section>
  );
}
