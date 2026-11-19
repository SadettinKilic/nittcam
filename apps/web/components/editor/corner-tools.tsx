'use client';

/**
 * Corner tools of the properties panel (T131, T132, spec §4.4): fillet the picked corner (or all
 * sharp corners), the inner-corner warning with "otomatik düzelt", and the dogbone / T-bone
 * overcut on a concave corner. Each action is one command; the geometry comes from core, so the
 * panel can say why an action is refused before it runs.
 */
import {
  cornerTurn,
  deriveOutline,
  dogboneOutline,
  filletOutline,
  fixTightCorners,
  isSharpLineCorner,
  tightCorners,
  type DogboneStyle,
  type Part,
} from '@nittcam/core';
import {
  Button,
  InspectorRow as Row,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  formatNumberTr,
  notify,
} from '@nittcam/ui';
import { TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import { Callout } from '../wizard/panels';
import type { Run } from './properties';

type T = Messages['editor']['inspector'];

const mm = (v: number) => formatNumberTr(v, { maxDecimals: 2 });

function errorText(t: T, error: string): string {
  if (error === 'corner') return t.errors.fillet;
  return error in t.errors ? t.errors[error as keyof T['errors']] : t.errors.failed;
}

/**
 * Inner-corner rule (spec §4.4 "İç köşe"): concave corners tighter than the tool radius, with
 * "Otomatik düzelt" (fillet the sharp ones to the tool radius). Nothing when every corner is fine.
 */
export function TightCornerNotice({
  t,
  part,
  toolRadius,
  run,
}: {
  t: T;
  part: Part;
  toolRadius: number;
  run: Run;
}) {
  const outline = deriveOutline(part);
  const tight = tightCorners(outline, toolRadius);
  if (tight.length === 0) return null;
  const fixable = tight.filter((c) => c.kind === 'corner' && c.fixable).map((c) => c.index);
  return (
    <Callout tone="warning" icon={<TriangleAlert aria-hidden />} data-testid="prop-concave">
      <span className="font-medium">{t.concave.title}</span>
      <span className="text-xs">
        {fill(t.concave.body, { count: tight.length, r: mm(toolRadius) })}
      </span>
      {fixable.length > 0 ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          data-testid="prop-concave-fix"
          onClick={() => {
            const res = fixTightCorners(outline, toolRadius);
            if (!res?.ok) {
              notify.error(res ? errorText(t, res.error) : t.errors.failed);
              return;
            }
            if (run('filletCorners', { id: part.id, corners: fixable, r: toolRadius })) {
              notify.success(fill(t.concave.fixed, { count: fixable.length, r: mm(toolRadius) }));
            }
          }}
        >
          {t.concave.fix}
        </Button>
      ) : null}
    </Callout>
  );
}

/** Fillet (all corners or the picked one) and dogbone / T-bone for the picked vertex. */
export function CornerTools({
  t,
  part,
  vertex,
  toolRadius,
  run,
}: {
  t: T;
  part: Part;
  /** The picked outline vertex. */
  vertex: number;
  /** Tool radius of the selected machine, mm (0 when unknown). */
  toolRadius: number;
  run: Run;
}) {
  const radiusId = useId();
  const styleId = useId();
  const [r, setR] = useState<number | null>(toolRadius > 0 ? toolRadius : 5);
  const [note, setNote] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null);
  const [style, setStyle] = useState<DogboneStyle>('dogbone');
  const outline = deriveOutline(part);
  const sharp = outline.map((_, i) => i).filter((i) => isSharpLineCorner(outline, i));
  const canFillet = sharp.includes(vertex);
  const concave = canFillet && cornerTurn(outline, vertex) < 0;

  function fillet(corners: number[]) {
    if (r === null || !(r > 0)) {
      setNote({ tone: 'danger', text: t.errors.length });
      return;
    }
    const res = filletOutline(outline, corners, r);
    if (!res.ok) {
      setNote({ tone: 'danger', text: errorText(t, res.error) });
      return;
    }
    if (!run('filletCorners', { id: part.id, corners, r })) {
      setNote({ tone: 'danger', text: t.errors.failed });
      return;
    }
    // Radius clamped to the neighbouring segments: say what was applied (spec §4.4).
    setNote(
      res.clamped
        ? { tone: 'warning', text: fill(t.filletClamped, { r: mm(Math.min(...res.radii)) }) }
        : null,
    );
  }

  function dogbone() {
    const res = dogboneOutline(outline, vertex, toolRadius, style);
    if (!res.ok) {
      setNote({ tone: 'danger', text: errorText(t, res.error) });
      return;
    }
    if (run('addDogbone', { id: part.id, corner: vertex, r: toolRadius, style })) {
      setNote(null);
      notify.success(fill(t.dogbone.added, { r: mm(toolRadius) }));
    } else setNote({ tone: 'danger', text: t.errors.failed });
  }

  return (
    <div className="flex flex-col gap-1.5 pt-1" data-testid="prop-corner-tools">
      <Row
        label={<label htmlFor={radiusId}>{t.filletRadius}</label>}
        valueProps={{ className: 'overflow-visible' }}
      >
        <NumberInput
          id={radiusId}
          value={r}
          onValueChange={(v) => {
            setR(v);
            setNote(null);
          }}
          unit="mm"
          min={0}
          className="w-36"
          data-testid="prop-fillet-r"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canFillet) {
              e.preventDefault();
              fillet([vertex]);
            }
          }}
        />
      </Row>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={!canFillet}
          data-testid="prop-fillet"
          onClick={() => fillet([vertex])}
        >
          {t.fillet}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={sharp.length === 0}
          data-testid="prop-fillet-all"
          onClick={() => fillet(sharp)}
        >
          {t.filletAll}
        </Button>
      </div>
      {concave && toolRadius > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-1.5">
          <Row
            label={<label htmlFor={styleId}>{t.dogbone.title}</label>}
            mono={false}
            valueProps={{ className: 'overflow-visible' }}
          >
            <Select value={style} onValueChange={(v) => setStyle(v as DogboneStyle)}>
              <SelectTrigger
                id={styleId}
                className="w-36"
                data-testid="prop-dogbone-style"
                data-value={style}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dogbone">{t.dogbone.dogbone}</SelectItem>
                <SelectItem value="tbone-prev">{`${t.dogbone.tbone} · ${t.dogbone.prev}`}</SelectItem>
                <SelectItem value="tbone-next">{`${t.dogbone.tbone} · ${t.dogbone.next}`}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            data-testid="prop-dogbone"
            onClick={dogbone}
          >
            {fill(t.dogbone.add, { r: mm(toolRadius) })}
          </Button>
        </div>
      ) : null}
      {note ? (
        <p
          role={note.tone === 'danger' ? 'alert' : 'status'}
          className={
            note.tone === 'danger' ? 'text-xs text-danger-text' : 'text-xs text-warning-text'
          }
          data-testid="prop-corner-note"
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
