'use client';

/**
 * Hole properties (T138, spec §4.5): every hole of the selected part as a compact group of rows.
 * "İçini boşalt" on = a filled hole (blind pocket, or through with "Boydan boya"); off = "Sadece
 * çember (kanal)", a ring groove. Diameter, centre (part frame), depth, groove width and tool are
 * one `updateHole` each (one undo step); a refused value shows its error under the row.
 */
import type { Hole, Part } from '@nittcam/core';
import {
  IconButton,
  InspectorGroup,
  InspectorRow as Row,
  InspectorRows,
  Switch,
} from '@nittcam/ui';
import { Trash2 } from 'lucide-react';
import { fill } from '../../lib/draft-project';
import { holeDefaults } from '../../lib/editor/hole-tool';
import type { Messages } from '../../lib/messages';
import { NumberRow, type Run } from './properties';

type T = Messages['editor']['inspector']['hole'];

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
      {part.holes.map((h, i) => {
        const filled = h.type !== 'groove';
        const defaults = holeDefaults(h, thickness, toolDiameter);
        const tid = `prop-hole-${i}`;
        return (
          <div key={h.id} className="flex flex-col" data-testid={tid}>
            <div className="flex items-center justify-between pt-1">
              <h3 className="text-xs font-medium text-fg-muted">
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
                unit=""
                maxDecimals={0}
                testId={`${tid}-tool`}
                onCommit={(v) =>
                  v === null || !Number.isInteger(v) || v < 1 ? t.invalid : update(h, { tool: v })
                }
              />
            </InspectorRows>
          </div>
        );
      })}
    </InspectorGroup>
  );
}
