'use client';

/**
 * Hole properties (T138, spec §4.5): every hole of the selected part as a compact group of rows.
 * "İçini boşalt" on = a filled hole (blind pocket, or through with "Boydan boya"); off = "Sadece
 * çember (kanal)", a ring groove. Diameter, centre (part frame), depth, groove width and tool are
 * one `updateHole` each (one undo step); a refused value shows its error under the row.
 */
import type { Hole, Part, ValidationIssue } from '@nittcam/core';
import {
  IconButton,
  InspectorGroup,
  InspectorRow as Row,
  InspectorRows,
  Switch,
} from '@nittcam/ui';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatMm } from '../../lib/canvas-labels';
import { fill } from '../../lib/fill';
import { holeSummary, rowOpen } from '../../lib/editor/collapse';
import { holeDefaults } from '../../lib/editor/hole-tool';
import type { Messages } from '../../lib/messages';
import { useHoleIssues } from './hole-issues';
import { NumberRow, type Run } from './properties';
import { SummaryRow } from './summary-row';

type T = Messages['editor']['inspector']['hole'];

/**
 * T275: the error under a hole's rows, in workshop words ("Delik 3: Ø5, T2 takımından (Ø8) küçük.").
 * The code comes from the core validation (same rule as the toolpath); the numbers from the hole.
 */
export function holeErrorText(
  t: T,
  n: number,
  hole: Hole,
  issue: Pick<ValidationIssue, 'code'>,
  tools: readonly { number: number; diameter: number }[] | null,
  thickness: number,
): string {
  const td = tools?.find((x) => x.number === hole.tool)?.diameter;
  const values = {
    n,
    d: formatMm(hole.d),
    tool: hole.tool,
    td: td !== undefined ? formatMm(td) : '-',
    w: hole.type === 'groove' ? formatMm(hole.grooveWidth) : '-',
    depth: hole.type !== 'through' ? formatMm(hole.depth) : '-',
    t: formatMm(thickness),
  };
  const template =
    issue.code in t.errors ? t.errors[issue.code as keyof T['errors']] : t.errors.other;
  return fill(template, values);
}

export function HoleProperties({
  t,
  part,
  run,
  thickness,
  toolDiameter,
  picked = null,
}: {
  t: T;
  part: Part;
  run: Run;
  /** Stock thickness, mm (default depths stay below it). */
  thickness: number;
  /** Diameter of the hole's default tool, mm (default groove width). */
  toolDiameter: number;
  /** B52 (D-092): hole picked on the canvas (0-based): its row opens and scrolls into view. */
  picked?: number | null;
}) {
  const issues = useHoleIssues(part.id);
  const group = useRef<HTMLDivElement>(null);
  // B50: the person's own open / closed choice per hole id (default: newest and failing open).
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const pickedId = picked === null ? undefined : part.holes[picked]?.id;
  const [shownPick, setShownPick] = useState<string | undefined>(undefined);
  if (pickedId !== shownPick) {
    setShownPick(pickedId);
    if (pickedId) setOpen((o) => ({ ...o, [pickedId]: true }));
  }
  useEffect(() => {
    if (picked === null) return;
    group.current
      ?.querySelector(`[data-testid="prop-hole-${picked}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [picked]);
  // T275: "Çizimde aç" on a hole error brings that hole's rows into view.
  useEffect(() => {
    if (issues.focus === null) return;
    group.current
      ?.querySelector(`[data-testid="prop-hole-${issues.focus}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [issues.focus]);
  if (part.holes.length === 0) return null;
  const update = (h: Hole, patch: Record<string, unknown>) =>
    run('updateHole', { id: part.id, holeId: h.id, patch }) ? null : t.refused;
  const num =
    (h: Hole, key: string, positive = true) =>
    (v: number | null) =>
      v === null || !Number.isFinite(v) || (positive && v <= 0)
        ? t.invalid
        : update(h, { [key]: v });

  return (
    <InspectorGroup title={t.title} data-testid="prop-group-holes">
      <div ref={group} className="contents">
        {part.holes.map((h, i) => {
          const filled = h.type !== 'groove';
          const errors = issues.byHole.get(i) ?? [];
          const toolInfo = issues.tools?.find((x) => x.number === h.tool);
          const toolMissing = issues.tools !== null && toolInfo === undefined;
          const defaults = holeDefaults(h, thickness, toolDiameter);
          const tid = `prop-hole-${i}`;
          return (
            <SummaryRow
              key={h.id}
              testId={tid}
              dataError={errors.length > 0 ? errors.map((e) => e.code).join(' ') : undefined}
              title={fill(t.holeN, { n: i + 1 })}
              summary={[
                t.type[h.type],
                ...holeSummary(h),
                ...(toolMissing ? [t.missing] : []),
              ].join(' · ')}
              error={errors.length > 0}
              open={rowOpen(open[h.id], i, part.holes.length, errors.length > 0)}
              onToggle={() =>
                setOpen((o) => ({
                  ...o,
                  [h.id]: !rowOpen(o[h.id], i, part.holes.length, errors.length > 0),
                }))
              }
              action={
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={fill(t.remove, { n: i + 1 })}
                  data-testid={`${tid}-remove`}
                  onClick={() => run('removeHole', { id: part.id, holeId: h.id })}
                >
                  <Trash2 aria-hidden />
                </IconButton>
              }
              notes={errors.map((e) => (
                <p
                  key={e.code}
                  role="alert"
                  data-testid={`${tid}-error`}
                  data-code={e.code}
                  className="mb-1 flex items-start gap-1.5 text-xs text-danger-text"
                >
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {holeErrorText(t, i + 1, h, e, issues.tools, thickness)}
                </p>
              ))}
            >
              <InspectorRows>
                <Row
                  label={<label htmlFor={`${tid}-filled`}>{t.filled}</label>}
                  mono={false}
                  valueProps={{ className: 'overflow-visible' }}
                >
                  <Switch
                    id={`${tid}-filled`}
                    checked={filled}
                    data-testid={`${tid}-filled`}
                    onCheckedChange={(on) =>
                      update(
                        h,
                        on
                          ? { type: 'pocket', depth: defaults.depth }
                          : {
                              type: 'groove',
                              depth: defaults.depth,
                              grooveWidth: defaults.grooveWidth,
                            },
                      )
                    }
                  />
                </Row>
                {!filled ? (
                  <Row label={t.ringOnly} mono={false}>
                    {t.ringOnlyOn}
                  </Row>
                ) : (
                  <Row
                    label={<label htmlFor={`${tid}-through`}>{t.through}</label>}
                    mono={false}
                    valueProps={{ className: 'overflow-visible' }}
                  >
                    <Switch
                      id={`${tid}-through`}
                      checked={h.type === 'through'}
                      data-testid={`${tid}-through`}
                      onCheckedChange={(on) =>
                        update(
                          h,
                          on ? { type: 'through' } : { type: 'pocket', depth: defaults.depth },
                        )
                      }
                    />
                  </Row>
                )}
                <NumberRow label={t.d} value={h.d} testId={`${tid}-d`} onCommit={num(h, 'd')} />
                <NumberRow
                  label={t.cx}
                  value={h.cx}
                  testId={`${tid}-cx`}
                  onCommit={num(h, 'cx', false)}
                />
                <NumberRow
                  label={t.cy}
                  value={h.cy}
                  testId={`${tid}-cy`}
                  onCommit={num(h, 'cy', false)}
                />
                {h.type !== 'through' ? (
                  <NumberRow
                    label={t.depth}
                    value={h.depth}
                    testId={`${tid}-depth`}
                    onCommit={num(h, 'depth')}
                  />
                ) : null}
                {h.type === 'groove' ? (
                  <NumberRow
                    label={t.grooveWidth}
                    value={h.grooveWidth}
                    testId={`${tid}-width`}
                    onCommit={num(h, 'grooveWidth')}
                  />
                ) : null}
                <NumberRow
                  label={t.tool}
                  value={h.tool}
                  unit={
                    toolInfo
                      ? fill(t.toolDiameter, { d: formatMm(toolInfo.diameter) })
                      : toolMissing
                        ? t.toolMissing
                        : ''
                  }
                  invalid={toolMissing}
                  maxDecimals={0}
                  testId={`${tid}-tool`}
                  onCommit={(v) =>
                    v === null || !Number.isInteger(v) || v < 1 ? t.invalid : update(h, { tool: v })
                  }
                />
              </InspectorRows>
            </SummaryRow>
          );
        })}
      </div>
    </InspectorGroup>
  );
}
