'use client';

import { OFFCUT_MIN_SIZE, proposeOffcuts, type Project } from '@nittcam/core';
import { Button, Checkbox } from '@nittcam/ui';
import { useMemo, useState } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import type { NewOffcut } from '../../lib/offcuts-api';

type Text = Messages['wizard']['layout']['offcuts'];

/**
 * T168: after nesting, the leftovers ≥ 300 × 300 mm are proposed; the user picks and confirms
 * ("Stoğa kaydet") and they are stored as `offcuts` rows. Nothing is saved without the click.
 */
export function OffcutsPanel({
  t,
  project,
  projectId,
  toolDiameter,
  disabled,
}: {
  t: Text;
  project: Project;
  projectId: string | null;
  toolDiameter: number;
  disabled: boolean;
}) {
  const proposals = useMemo(() => proposeOffcuts(project, toolDiameter), [project, toolDiameter]);
  // One decision per layout: a new layout shows its own proposals again.
  const layoutKey = useMemo(() => JSON.stringify(project.layout), [project.layout]);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [state, setState] = useState<{
    key: string;
    kind: 'saving' | 'saved' | 'failed';
    n: number;
  } | null>(null);
  const current = state?.key === layoutKey ? state : null;
  if (proposals.length === 0) return null;
  const chosen = proposals.filter((_, i) => !skipped.has(i));

  async function save() {
    const offcuts: NewOffcut[] = chosen.map((o) => ({
      material: project.stock.material,
      thickness: project.stock.thickness,
      width: o.width,
      height: o.height,
      grain: o.grain,
      sourceProjectId: projectId,
    }));
    setState({ key: layoutKey, kind: 'saving', n: offcuts.length });
    try {
      const res = await fetch('/api/offcuts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offcuts }),
      });
      setState({ key: layoutKey, kind: res.ok ? 'saved' : 'failed', n: offcuts.length });
    } catch {
      setState({ key: layoutKey, kind: 'failed', n: offcuts.length });
    }
  }

  return (
    <section
      aria-labelledby="offcuts-title"
      className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface p-3"
      data-testid="offcut-proposals"
    >
      <h3 id="offcuts-title" className="text-sm font-semibold text-fg">
        {t.title}
      </h3>
      {current?.kind === 'saved' ? (
        <p role="status" className="text-sm text-fg-muted" data-testid="offcut-saved">
          {fill(t.saved, { count: current.n })}
        </p>
      ) : (
        <>
          <p className="text-xs text-fg-muted">{fill(t.hint, { min: OFFCUT_MIN_SIZE })}</p>
          <ul className="flex flex-col gap-1">
            {proposals.map((o, i) => (
              <li key={`${o.sheet}-${o.x}-${o.y}`}>
                <label className="flex items-center gap-2 text-sm text-fg tabular-nums">
                  <Checkbox
                    checked={!skipped.has(i)}
                    onCheckedChange={(v) =>
                      setSkipped((s) => {
                        const n = new Set(s);
                        if (v === true) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                    data-testid="offcut-proposal"
                  />
                  {fill(t.item, { sheet: o.sheet + 1, w: o.width, h: o.height })}
                </label>
              </li>
            ))}
          </ul>
          {current?.kind === 'failed' ? (
            <p role="alert" className="text-xs text-danger-text">
              {t.failed}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || chosen.length === 0 || current?.kind === 'saving'}
            onClick={() => void save()}
            data-testid="offcut-save"
          >
            {current?.kind === 'saving' ? t.saving : fill(t.save, { count: chosen.length })}
          </Button>
        </>
      )}
    </section>
  );
}
