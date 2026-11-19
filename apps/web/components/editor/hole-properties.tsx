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
import { useEffect, useRef } from 'react';
import { formatMm } from '../../lib/canvas-labels';
import { fill } from '../../lib/draft-project';
import { holeDefaults } from '../../lib/editor/hole-tool';
import type { Messages } from '../../lib/messages';
import { useHoleIssues } from './hole-issues';
import { NumberRow, type Run } from './properties';

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
}: {
  t: T;
  part: Part;
  run: Run;
  /** Stock thickness, mm (default depths stay below it). */
  thickness: number;
  /** Diameter of the hole's default tool, mm (default groove width). */
  toolDiameter: number;
}) {
  const issues = useHoleIssues(part.id);
  const group = useRef<HTMLDivElement>(null);
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
            <div
              key={h.id}
              className="flex flex-col"
              data-testid={tid}
              data-error={errors.length > 0 ? errors.map((e) => e.code).join(' ') : undefined}
            >
              <div className="flex items-center justify-between pt-1">
                <h3
                  className={`flex items-center gap-1 text-xs font-medium ${errors.length > 0 ? 'text-danger-text' : 'text-fg-muted'}`}
                >
                  {errors.length > 0 ? (
                    <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                  ) : null}
                  {fill(t.holeN, { n: i + 1 })} · {t.type[h.type]}
                </h3>
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={fill(t.remove, { n: i + 1 })}
                  data-testid={`${tid}-remove`}
                  onClick={() => run('removeHole', { id: part.id, holeId: h.id })}
                >
                  <Trash2 aria-hidden />
                </IconButton>
              </div>
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
              {errors.map((e) => (
                <p
                  key={e.code}
                  role="alert"
                  data-testid={`${tid}-error`}
                  data-code={e.code}
                  className="mt-1 flex items-start gap-1.5 text-xs text-danger-text"
                >
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {holeErrorText(t, i + 1, h, e, issues.tools, thickness)}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </InspectorGroup>
  );
}
