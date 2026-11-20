'use client';

/**
 * Properties panel of the drawing board (T130, spec §4.4, D-040): the selected part's values as
 * collapsible groups of `InspectorRow`s, compact density. Part: name, qty, W/H/R (rectangles),
 * grain, operation summary; segment: length, angle, radius; vertex: X/Y. Every edit is one
 * command (one undo step) run on Enter or blur; a refused value shows a Turkish error under its
 * group and runs nothing.
 */
import {
  bbox,
  bulgeForRadius,
  contour,
  deriveOutline,
  segmentInfo,
  withSegmentAngle,
  withSegmentLength,
  withVertexAt,
  ALLOWED_OPERATIONS,
  contourOperation,
  defaultOnlineDepth,
  type ContourRef,
  type OutlineEdit,
  type Part,
  type Point,
} from '@nittcam/core';
import {
  Button,
  GrainDial,
  IconButton,
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
import { CircleAlert, Move, Plus, X } from 'lucide-react';
import { useInnerIssues } from './inner-issues';
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatMm, sizeText } from '../../lib/canvas-labels';
import { fill } from '../../lib/fill';
import { grainDialLabels } from '../../lib/grain-labels';
import { useMessages } from '../../lib/messages-context';
import type { Messages } from '../../lib/messages';
import { CornerTools, TightCornerNotice } from './corner-tools';

type T = Messages['editor']['inspector'];
export type Run = (command: string, params: unknown) => boolean;

/** A segment or vertex of the selected part's outline (UI state, T130). */
/** B52 (D-092): or a hole / cut-out picked on the canvas. */
export type SubSelection = { kind: 'segment' | 'vertex' | 'hole' | 'inner'; index: number } | null;

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
  invalid = false,
}: {
  label: string;
  value: number | null;
  unit?: string;
  onCommit: Commit;
  testId: string;
  allowEmpty?: boolean;
  maxDecimals?: number;
  /** Shows the field as invalid although the value was accepted (e.g. a tool the machine lacks, T275). */
  invalid?: boolean;
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
          invalid={invalid || error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className="w-36 max-w-full"
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

/**
 * Operation of one contour (T142): a picker of the kinds the contour allows and, for `online`,
 * the depth. Both run `setOperation` (DXF layer mapping, T145, writes the same field).
 */
function OperationRow({
  t,
  part,
  run,
  label,
  contour,
  testId,
  thickness,
}: {
  t: T;
  part: Part;
  run: Run;
  label: string;
  contour: ContourRef;
  testId: string;
  /** Stock thickness, mm: the default on-line depth stays below it (T277). */
  thickness: number;
}) {
  const id = useId();
  const current = contourOperation(part, contour);
  if (!current) return null;
  const kinds = ALLOWED_OPERATIONS[contour.type];
  return (
    <>
      <Row
        label={<label htmlFor={id}>{label}</label>}
        mono={false}
        valueProps={{ className: 'overflow-visible' }}
      >
        <Select
          value={current.kind}
          onValueChange={(kind) =>
            run('setOperation', {
              id: part.id,
              contour,
              kind,
              ...(kind === 'online' ? { depth: defaultOnlineDepth(thickness) } : {}),
            })
          }
        >
          <SelectTrigger
            id={id}
            className="w-44 max-w-full"
            data-testid={testId}
            data-value={current.kind}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((k) => (
              <SelectItem key={k} value={k}>
                {t.operation.kinds[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {current.kind === 'online' ? (
        <NumberRow
          label={t.operation.depth}
          value={current.depth}
          testId={`${testId}-depth`}
          onCommit={(v) =>
            v === null || v <= 0
              ? t.errors.length
              : run('setOperation', { id: part.id, contour, kind: 'online', depth: v })
                ? null
                : t.operation.depthError
          }
        />
      ) : null}
    </>
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
  thickness = 18,
  afterPart,
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
  /** Stock thickness, mm (default on-line depth, T277). */
  thickness?: number;
  /** Groups right under "Parça" (B50: holes and templates, collapsed rows). */
  afterPart?: ReactNode;
}) {
  const grainText = useMessages().grainDial;
  const outline = deriveOutline(part);
  const n = outline.length;
  const seg = sub?.kind === 'segment' && sub.index < n ? sub.index : null;
  const ver = sub?.kind === 'vertex' && sub.index < n ? sub.index : null;
  const info = seg === null ? undefined : segmentInfo(outline, seg);
  const vertex = ver === null ? undefined : outline[ver];
  const fixed = part.grain.mode === 'fixed';
  const [liveGrain, setLiveGrain] = useState<number | null>(null);
  const op = t.operation;
  // T270: cut-outs whose slug has no room for 2 tabs (the wizard's validation).
  const innerIssues = useInnerIssues(part.id);
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
      {afterPart}

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
            labels={grainDialLabels(grainText, { note: false })}
            className="self-center"
            data-testid="prop-grain-dial"
          />
        ) : null}
      </InspectorGroup>

      <InspectorGroup title={t.groups.operation} data-testid="prop-group-operation">
        <InspectorRows>
          <OperationRow
            t={t}
            part={part}
            run={run}
            label={op.outer}
            contour={{ type: 'outline' }}
            testId="prop-op-outline"
            thickness={thickness}
          />
          {part.inners.length > 0 ? (
            <Row label={op.inners} valueProps={{ 'data-testid': 'prop-op-inners' }}>
              {part.inners.length}
            </Row>
          ) : null}
          {part.inners.map((_, i) => (
            <OperationRow
              key={`inner${i}`}
              t={t}
              part={part}
              run={run}
              label={fill(t.innerN, { n: i + 1 })}
              contour={{ type: 'inner', index: i }}
              testId={`prop-op-inner-${i}`}
              thickness={thickness}
            />
          ))}
          {(part.lines ?? []).map((_, i) => (
            <OperationRow
              key={`line${i}`}
              t={t}
              part={part}
              run={run}
              label={fill(op.lineN, { n: i + 1 })}
              contour={{ type: 'line', index: i }}
              testId={`prop-op-line-${i}`}
              thickness={thickness}
            />
          ))}
          {part.holes.length > 0 ? (
            <Row label={op.holes} valueProps={{ 'data-testid': 'prop-op-holes' }}>
              {part.holes.length}
            </Row>
          ) : null}
        </InspectorRows>
      </InspectorGroup>

      {part.inners.length > 0 ? (
        <InspectorGroup title={t.groups.inners} data-testid="prop-group-inners">
          <InspectorRows>
            {part.inners.map((inner, i) => {
              const b = bbox(contour(inner));
              const bad = innerIssues.has(i);
              const picked = sub?.kind === 'inner' && sub.index === i;
              // B52 (D-092): the picked cut-out's box (part frame), one `updateInnerContour` each.
              const place = (patch: Record<string, number>) =>
                run('updateInnerContour', {
                  id: part.id,
                  index: i,
                  toolDiameter: toolRadius * 2,
                  ...patch,
                })
                  ? null
                  : t.innerRefused;
              const field = (key: 'x' | 'y' | 'width' | 'height', label: string, v: number) => (
                <NumberRow
                  label={label}
                  value={v}
                  testId={`prop-inner-${key}`}
                  onCommit={(n) =>
                    n === null || ((key === 'width' || key === 'height') && n <= 0)
                      ? t.errors.length
                      : place({ [key]: n })
                  }
                />
              );
              return (
                <Fragment key={i}>
                  <Row
                    label={fill(t.innerN, { n: i + 1 })}
                    valueProps={{ className: 'flex items-center justify-end gap-1' }}
                    data-testid="prop-inner"
                    data-error={bad ? 'slug' : undefined}
                  >
                    {bad ? (
                      <CircleAlert
                        role="img"
                        aria-label={fill(t.innerSlugUnsecured, { n: i + 1 })}
                        className="size-4 shrink-0 text-danger-text"
                      />
                    ) : null}
                    <span className={bad ? 'text-danger-text' : undefined}>
                      {sizeText(b.maxX - b.minX, b.maxY - b.minY)}
                    </span>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={fill(t.innerEdit, { n: i + 1 })}
                      aria-pressed={picked}
                      data-testid="prop-inner-edit"
                      onClick={() => onSub(picked ? null : { kind: 'inner', index: i })}
                    >
                      <Move aria-hidden />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={fill(t.innerRemove, { n: i + 1 })}
                      data-testid="prop-inner-remove"
                      onClick={() => run('removeInnerContour', { id: part.id, index: i })}
                    >
                      <X aria-hidden />
                    </IconButton>
                  </Row>
                  {picked ? (
                    <>
                      {field('x', t.innerX, b.minX)}
                      {field('y', t.innerY, b.minY)}
                      {field('width', t.innerW, b.maxX - b.minX)}
                      {field('height', t.innerH, b.maxY - b.minY)}
                    </>
                  ) : null}
                </Fragment>
              );
            })}
          </InspectorRows>
          {[...innerIssues]
            .sort((a, b) => a - b)
            .map((i) => (
              <p
                key={i}
                role="alert"
                data-testid="prop-inner-error"
                className="mt-1 flex items-start gap-1.5 text-xs text-danger-text"
              >
                <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {fill(t.innerSlugUnsecured, { n: i + 1 })}
              </p>
            ))}
        </InspectorGroup>
      ) : null}

      {part.dims && part.dims.length > 0 ? (
        <InspectorGroup title={t.groups.dims} data-testid="prop-group-dims">
          <InspectorRows>
            {part.dims.map((d, i) => (
              <Row
                key={d.id}
                label={fill(t.dimN, { n: i + 1 })}
                valueProps={{ className: 'flex items-center justify-end gap-1' }}
                data-testid="prop-dim"
              >
                <span>{formatMm(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y))}</span>
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label={fill(t.dimRemove, { n: i + 1 })}
                  data-testid="prop-dim-remove"
                  onClick={() => run('removeDimension', { id: part.id, dimId: d.id })}
                >
                  <X aria-hidden />
                </IconButton>
              </Row>
            ))}
          </InspectorRows>
        </InspectorGroup>
      ) : null}

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
        {seg !== null ? (
          // B50 (CTO #5): a corner in the middle of the edge, picked at once so it can be moved
          // (an L or a notch without redrawing).
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            data-testid="prop-seg-split"
            onClick={() => {
              if (run('splitSegment', { id: part.id, index: seg }))
                onSub({ kind: 'vertex', index: seg + 1 });
            }}
          >
            <Plus aria-hidden />
            {t.splitSegment}
          </Button>
        ) : null}
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
