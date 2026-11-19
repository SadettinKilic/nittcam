'use client';

/**
 * Properties panel of the drawing board (T130, spec §4.4, D-040): the selected part's values as
 * collapsible groups of `InspectorRow`s, compact density. Part: name, qty, W/H/R (rectangles),
 * grain, operation summary; segment: length, angle, radius; vertex: X/Y. Every edit is one
 * command (one undo step) run on Enter or blur; a refused value shows a Turkish error under its
 * group and runs nothing.
 */
import {
  bulgeForRadius,
  deriveOutline,
  segmentInfo,
  withSegmentAngle,
  withSegmentLength,
  withVertexAt,
  type OutlineEdit,
  type Part,
  type Point,
} from '@nittcam/core';
import {
  Button,
  GrainDial,
  Input,
  InspectorGroup,
  InspectorRow as Row,
  InspectorRows,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip,
} from '@nittcam/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { fill } from '../../lib/draft-project';
import { grainDialLabels } from '../../lib/grain-labels';
import type { Messages } from '../../lib/messages';
import { CornerTools, TightCornerNotice } from './corner-tools';

type T = Messages['editor']['inspector'];
export type Run = (command: string, params: unknown) => boolean;

/** A segment or vertex of the selected part's outline (UI state, T130). */
export type SubSelection = { kind: 'segment' | 'vertex'; index: number } | null;

/** Error text of a refused value, or null when the edit ran. */
type Commit = (value: number | null) => string | null;

/**
 * One editable number row: label left, a 32 px NumberInput right. The value is committed on
 * Enter or blur (one command); Esc puts the stored value back.
 */
export function NumberRow({
  label,
  value,
  unit = 'mm',
  onCommit,
  testId,
  allowEmpty = false,
  maxDecimals = 2,
}: {
  label: string;
  value: number | null;
  unit?: string;
  onCommit: Commit;
  testId: string;
  allowEmpty?: boolean;
  maxDecimals?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState<number | null>(value);
  const [shown, setShown] = useState<number | null>(value);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skip = useRef(false);
  if (!focused && value !== shown) {
    setShown(value);
    setDraft(value);
    setError(null);
  }
  function commit() {
    if (draft === value || (draft === null && !allowEmpty)) {
      if (draft === null) setDraft(value);
      setError(null);
      return;
    }
    setError(onCommit(draft));
  }
  return (
    <div className="flex flex-col">
      <Row
        label={<label htmlFor={id}>{label}</label>}
        valueProps={{ className: 'overflow-visible' }}
      >
        <NumberInput
          id={id}
          value={draft}
          onValueChange={setDraft}
          unit={unit}
          maxDecimals={maxDecimals}
          invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className="w-36"
          data-testid={testId}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (skip.current) {
              skip.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              skip.current = true;
              setDraft(value);
              setError(null);
              e.currentTarget.blur();
            }
          }}
        />
      </Row>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="pb-1 text-right text-xs text-danger-text"
          data-testid={`${testId}-error`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Editable name row (Enter / blur commits, Esc reverts). */
function NameRow({ t, part, run }: { t: T; part: Part; run: Run }) {
  const id = useId();
  const [draft, setDraft] = useState(part.name);
  const [shown, setShown] = useState(part.name);
  const [focused, setFocused] = useState(false);
  const skip = useRef(false);
  if (!focused && part.name !== shown) {
    setShown(part.name);
    setDraft(part.name);
  }
  const commit = () => {
    const name = draft.trim();
    if (name !== part.name.trim()) run('updatePart', { id: part.id, name });
  };
  return (
    <Row
      label={<label htmlFor={id}>{t.name}</label>}
      mono={false}
      valueProps={{ className: 'overflow-visible' }}
    >
      <Input
        id={id}
        value={draft}
        maxLength={120}
        className="w-36"
        data-testid="prop-name"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (skip.current) skip.current = false;
          else commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            skip.current = true;
            setDraft(part.name);
            e.currentTarget.blur();
          }
        }}
      />
    </Row>
  );
}

function editError(t: T, r: OutlineEdit): string | null {
  return r.ok ? null : t.errors[r.error];
}

/** Runs an outline command after the same check the command does; Turkish error when refused. */
function outlineRun(t: T, run: Run, check: OutlineEdit, command: string, params: unknown) {
  const err = editError(t, check);
  if (err) return err;
  return run(command, params) ? null : t.errors.failed;
}

function Picker({
  label,
  items,
  value,
  onChange,
  testId,
}: {
  label: string;
  items: string[];
  value: number | null;
  onChange: (i: number) => void;
  testId: string;
}) {
  const id = useId();
  return (
    <Row
      label={<label htmlFor={id}>{label}</label>}
      mono={false}
      valueProps={{ className: 'overflow-visible' }}
    >
      <Select
        value={value === null ? '' : String(value)}
        onValueChange={(v) => onChange(Number(v))}
      >
        <SelectTrigger id={id} className="w-36" data-testid={testId} data-value={value ?? ''}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {items.map((name, i) => (
            <SelectItem key={i} value={String(i)}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

/** The single selected part's properties. */
export function PartProperties({
  t,
  part,
  at,
  run,
  sub,
  onSub,
  toolRadius = 0,
}: {
  t: T;
  part: Part;
  /** Board position of the part's local origin (vertex X/Y are shown in board mm). */
  at: Point;
  run: Run;
  sub: SubSelection;
  onSub: (sub: SubSelection) => void;
  /** Tool radius of the selected machine, mm (inner-corner rule, dogbone; T131/T132). */
  toolRadius?: number;
}) {
  const outline = deriveOutline(part);
  const n = outline.length;
  const seg = sub?.kind === 'segment' && sub.index < n ? sub.index : null;
  const ver = sub?.kind === 'vertex' && sub.index < n ? sub.index : null;
  const info = seg === null ? undefined : segmentInfo(outline, seg);
  const vertex = ver === null ? undefined : outline[ver];
  const fixed = part.grain.mode === 'fixed';
  const [liveGrain, setLiveGrain] = useState<number | null>(null);
  const op = t.operation;
  const segName = (i: number) => fill(t.segmentN, { n: i + 1 });
  const verName = (i: number) => fill(t.vertexN, { n: i + 1 });

  // T266: a corner picked on the canvas or in the list brings the "Köşe" group (radius,
  // "Köşeyi yuvarla", "Taşma aç") into the panel's view; it is the last group.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ver === null) return;
    const raf = requestAnimationFrame(() => {
      root.current
        ?.querySelector('[data-testid="prop-group-vertex"]')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [ver, part.id]);

  return (
    <div ref={root} className="flex flex-col gap-1" data-testid="editor-properties">
      {toolRadius > 0 ? (
        <TightCornerNotice t={t} part={part} toolRadius={toolRadius} run={run} />
      ) : null}
      <InspectorGroup title={t.groups.part} data-testid="prop-group-part">
        <InspectorRows>
          <NameRow t={t} part={part} run={run} />
          <Row label={t.kind.title} mono={false}>
            {t.kind[part.kind]}
          </Row>
          <NumberRow
            label={t.qty}
            value={part.qty}
            unit=""
            maxDecimals={0}
            testId="prop-qty"
            onCommit={(v) =>
              v === null || !Number.isInteger(v) || v < 1
                ? t.errors.qty
                : run('updatePart', { id: part.id, qty: v })
                  ? null
                  : t.errors.failed
            }
          />
          {part.kind === 'rect' ? (
            <>
              <NumberRow
                label={t.width}
                value={part.params.w}
                testId="prop-w"
                onCommit={(v) =>
                  v === null || v <= 0
                    ? t.errors.length
                    : part.params.r > Math.min(v, part.params.h) / 2
                      ? t.errors.rectRadius
                      : run('updatePart', { id: part.id, params: { w: v } })
                        ? null
                        : t.errors.failed
                }
              />
              <NumberRow
                label={t.height}
                value={part.params.h}
                testId="prop-h"
                onCommit={(v) =>
                  v === null || v <= 0
                    ? t.errors.length
                    : part.params.r > Math.min(part.params.w, v) / 2
                      ? t.errors.rectRadius
                      : run('updatePart', { id: part.id, params: { h: v } })
                        ? null
                        : t.errors.failed
                }
              />
              <NumberRow
                label={t.radius}
                value={part.params.r}
                testId="prop-r"
                onCommit={(v) =>
                  v === null || v < 0
                    ? t.errors.length
                    : v > Math.min(part.params.w, part.params.h) / 2
                      ? t.errors.rectRadius
                      : run('updatePart', { id: part.id, params: { r: v } })
                        ? null
                        : t.errors.failed
                }
              />
            </>
          ) : null}
        </InspectorRows>
        {part.kind === 'rect' ? (
          <Tooltip content={t.convertHint}>
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              data-testid="prop-convert"
              onClick={() => run('convertToFreeform', { id: part.id })}
            >
              {t.convert}
            </Button>
          </Tooltip>
        ) : null}
      </InspectorGroup>

      <InspectorGroup title={t.groups.grain} data-testid="prop-group-grain">
        <InspectorRows>
          <Row
            label={<label htmlFor={`grain-${part.id}`}>{t.grainFixed}</label>}
            mono={false}
            valueProps={{ className: 'overflow-visible' }}
          >
            <Switch
              id={`grain-${part.id}`}
              checked={fixed}
              data-testid="prop-grain-fixed"
              onCheckedChange={(on) =>
                run('setPartGrain', {
                  id: part.id,
                  mode: on ? 'fixed' : 'free',
                  angle: part.grain.angle,
                })
              }
            />
          </Row>
        </InspectorRows>
        {fixed ? (
          <GrainDial
            size="sm"
            value={liveGrain ?? part.grain.angle}
            onValueChange={setLiveGrain}
            onValueCommit={(a) => {
              setLiveGrain(null);
              if (a !== part.grain.angle)
                run('setPartGrain', { id: part.id, mode: 'fixed', angle: a });
            }}
            labels={grainDialLabels(undefined, { note: false })}
            className="self-center"
            data-testid="prop-grain-dial"
          />
        ) : null}
      </InspectorGroup>

      <InspectorGroup title={t.groups.operation} data-testid="prop-group-operation">
        <InspectorRows>
          <Row label={op.outer} mono={false}>
            {op.outerCut}
          </Row>
          {part.inners.length > 0 ? (
            <Row label={op.inners} valueProps={{ 'data-testid': 'prop-op-inners' }}>
              {part.inners.length}
            </Row>
          ) : null}
          {part.holes.length > 0 ? (
            <Row label={op.holes} valueProps={{ 'data-testid': 'prop-op-holes' }}>
              {part.holes.length}
            </Row>
          ) : null}
        </InspectorRows>
      </InspectorGroup>

      <InspectorGroup title={t.groups.segment} data-testid="prop-group-segment">
        <InspectorRows>
          <Picker
            label={t.segmentPick}
            items={outline.map((_, i) => segName(i))}
            value={seg}
            onChange={(i) => onSub({ kind: 'segment', index: i })}
            testId="prop-segment-pick"
          />
          {seg !== null && info ? (
            <>
              <NumberRow
                label={t.length}
                value={info.length}
                testId="prop-seg-length"
                onCommit={(v) =>
                  v === null || v <= 0
                    ? t.errors.length
                    : outlineRun(t, run, withSegmentLength(outline, seg, v), 'setSegmentLength', {
                        id: part.id,
                        index: seg,
                        length: v,
                      })
                }
              />
              <NumberRow
                label={t.angle}
                value={info.angle}
                unit="°"
                testId="prop-seg-angle"
                onCommit={(v) =>
                  v === null
                    ? t.errors.length
                    : outlineRun(t, run, withSegmentAngle(outline, seg, v), 'setSegmentAngle', {
                        id: part.id,
                        index: seg,
                        angle: v,
                      })
                }
              />
              <NumberRow
                label={t.arcRadius}
                value={info.radius ?? null}
                allowEmpty
                testId="prop-seg-radius"
                onCommit={(v) => {
                  const a = outline[seg];
                  const b = outline[(seg + 1) % n];
                  if (!a || !b) return t.errors.index;
                  const bulge = v === null || v === 0 ? 0 : bulgeForRadius(a, b, v, a.bulge);
                  if (bulge === undefined)
                    return v !== null && v < 0 ? t.errors.length : t.errors.radius;
                  return run('setSegmentBulge', {
                    id: part.id,
                    index: seg,
                    bulge: Math.round(bulge * 1e9) / 1e9,
                  })
                    ? null
                    : t.errors.degenerate;
                }}
              />
            </>
          ) : (
            <p className="py-1 text-xs text-fg-subtle">{t.pickHint}</p>
          )}
        </InspectorRows>
      </InspectorGroup>

      <InspectorGroup title={t.groups.vertex} data-testid="prop-group-vertex">
        <InspectorRows>
          <Picker
            label={t.vertexPick}
            items={outline.map((_, i) => verName(i))}
            value={ver}
            onChange={(i) => onSub({ kind: 'vertex', index: i })}
            testId="prop-vertex-pick"
          />
          {ver !== null && vertex ? (
            <>
              <NumberRow
                label="X"
                value={vertex.x + at.x}
                testId="prop-vertex-x"
                onCommit={(v) =>
                  v === null
                    ? t.errors.length
                    : outlineRun(
                        t,
                        run,
                        withVertexAt(outline, ver, { x: v - at.x, y: vertex.y }),
                        'moveVertex',
                        { id: part.id, index: ver, x: v - at.x, y: vertex.y },
                      )
                }
              />
              <NumberRow
                label="Y"
                value={vertex.y + at.y}
                testId="prop-vertex-y"
                onCommit={(v) =>
                  v === null
                    ? t.errors.length
                    : outlineRun(
                        t,
                        run,
                        withVertexAt(outline, ver, { x: vertex.x, y: v - at.y }),
                        'moveVertex',
                        { id: part.id, index: ver, x: vertex.x, y: v - at.y },
                      )
                }
              />
            </>
          ) : null}
        </InspectorRows>
        {ver !== null ? (
          <CornerTools t={t} part={part} vertex={ver} toolRadius={toolRadius} run={run} />
        ) : null}
      </InspectorGroup>
    </div>
  );
}
