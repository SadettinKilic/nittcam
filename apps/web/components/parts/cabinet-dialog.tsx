'use client';

import {
  cabinetFrontView,
  cabinetParamsSchema,
  cabinetParts,
  DEFAULT_CABINET,
  type CabinetParams,
  type CabinetPart,
} from '@nittcam/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  NumberInput,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nittcam/ui';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';

type Text = Messages['cutList']['cabinet'];

/** "Dolap N" with the first N not used as a group yet. */
export function nextCabinetName(pattern: string, groups: readonly (string | undefined)[]): string {
  const used = new Set(groups);
  for (let n = 1; ; n++) {
    const name = fill(pattern, { n });
    if (!used.has(name)) return name;
  }
}

/** Generated rows as `importCutList` input: a plain row each (D-041), the group only a label. */
export function cabinetRows(
  parts: readonly CabinetPart[],
  names: Text['roles'],
  group: string,
  newId: () => string,
) {
  return parts.map((p) => ({
    id: newId(),
    name: names[p.role],
    qty: p.qty,
    ...(group.trim() ? { group: group.trim() } : {}),
    grain: p.grain,
    params: { w: p.w, h: p.h, r: 0 },
    edgeBand: p.edgeBand,
  }));
}

type NumKey =
  'width' | 'height' | 'depth' | 'thickness' | 'shelves' | 'doorGap' | 'plinth' | 'band';

/**
 * "Dolap ekle" (T122): box sizes with sensible defaults and a live 2D front view. Enter in any
 * field adds the parts (one undo step), Esc closes. The rows it adds are ordinary rows.
 */
export function CabinetDialog({
  t,
  open,
  onOpenChange,
  thickness,
  defaultGroup,
  onAdd,
}: {
  t: Text;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project's board thickness (the default carcass thickness). */
  thickness: number;
  defaultGroup: string;
  /** Adds the rows; false when the command was rejected. */
  onAdd: (parts: CabinetPart[], group: string) => boolean;
}) {
  const ids = { group: useId(), back: useId() };
  const [v, setV] = useState<Record<NumKey, number | null>>({
    width: DEFAULT_CABINET.width,
    height: DEFAULT_CABINET.height,
    depth: DEFAULT_CABINET.depth,
    thickness,
    shelves: DEFAULT_CABINET.shelves,
    doorGap: DEFAULT_CABINET.doorGap,
    plinth: DEFAULT_CABINET.plinth,
    band: DEFAULT_CABINET.band,
  });
  const [back, setBack] = useState<CabinetParams['back']>({ ...DEFAULT_CABINET.back });
  const [doors, setDoors] = useState<CabinetParams['doors']>(DEFAULT_CABINET.doors);
  const [group, setGroup] = useState(defaultGroup);

  const parsed = useMemo(
    () => cabinetParamsSchema.safeParse({ ...v, back, doors }),
    [v, back, doors],
  );
  const result = parsed.success ? cabinetParts(parsed.data) : null;
  const error = !parsed.success
    ? t.errors.invalid
    : result && !result.ok
      ? t.errors[result.error]
      : null;
  const view = parsed.success ? cabinetFrontView(parsed.data) : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (result?.ok && onAdd(result.parts, group)) onOpenChange(false);
  }

  const num = (key: NumKey, label: string, unit = 'mm', opts: { int?: boolean } = {}) => (
    <NumberInput
      aria-label={label}
      data-testid={`cabinet-${key}`}
      inputSize="sm"
      value={v[key]}
      unit={unit}
      min={0}
      maxDecimals={opts.int ? 0 : 1}
      onValueChange={(n) => setV((x) => ({ ...x, [key]: n }))}
    />
  );
  const field = (key: NumKey, label: string, unit?: string, opts?: { int?: boolean }) => (
    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
      <span>{label}</span>
      {num(key, label, unit, opts)}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="cabinet-dialog">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                {field('width', t.fields.width)}
                {field('height', t.fields.height)}
                {field('depth', t.fields.depth)}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {field('thickness', t.fields.thickness)}
                {field('shelves', t.fields.shelves, t.units.pieces, { int: true })}
                {field('plinth', t.fields.plinth)}
              </div>
              <div className="grid grid-cols-3 items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor={ids.back} className="text-sm font-medium text-fg">
                    {t.fields.back}
                  </label>
                  <Select
                    value={back.mode}
                    onValueChange={(m) =>
                      setBack((b) => ({ ...b, mode: m as CabinetParams['back']['mode'] }))
                    }
                  >
                    <SelectTrigger
                      id={ids.back}
                      className="h-control-sm"
                      data-testid="cabinet-back"
                      data-value={back.mode}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['none', 'inset', 'overlay'] as const).map((m) => (
                        <SelectItem key={m} value={m}>
                          {t.backModes[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {back.mode !== 'none' ? (
                  <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                    <span>{t.fields.backThickness}</span>
                    <NumberInput
                      aria-label={t.fields.backThickness}
                      data-testid="cabinet-back-thickness"
                      inputSize="sm"
                      value={back.thickness}
                      unit="mm"
                      min={0}
                      maxDecimals={1}
                      onValueChange={(n) => setBack((b) => ({ ...b, thickness: n ?? 0 }))}
                    />
                  </label>
                ) : (
                  <span />
                )}
                {field('band', t.fields.band)}
              </div>
              <div className="grid grid-cols-3 items-end gap-3">
                <div className="col-span-2 flex flex-col gap-1">
                  <span aria-hidden className="text-sm font-medium text-fg">
                    {t.fields.doors}
                  </span>
                  <RadioGroup
                    value={String(doors)}
                    onValueChange={(d) => setDoors(Number(d) as CabinetParams['doors'])}
                    className="flex h-control-sm items-center gap-4"
                    aria-label={t.fields.doors}
                    data-testid="cabinet-doors"
                  >
                    {([0, 1, 2] as const).map((d) => (
                      <label key={d} className="flex items-center gap-1.5 text-sm text-fg">
                        <RadioGroupItem value={String(d)} aria-label={t.doorCount[d]} />
                        {t.doorCount[d]}
                      </label>
                    ))}
                  </RadioGroup>
                </div>
                {doors > 0 ? field('doorGap', t.fields.doorGap) : <span />}
              </div>
              <FormField label={t.fields.group} id={ids.group} hint={t.groupHint}>
                <Input
                  id={ids.group}
                  data-testid="cabinet-group"
                  value={group}
                  maxLength={60}
                  onChange={(e) => setGroup(e.target.value)}
                />
              </FormField>
            </div>
            <figure className="flex flex-col gap-2" data-testid="cabinet-preview">
              <figcaption className="text-sm font-medium text-fg">{t.preview}</figcaption>
              <FrontView rects={view} params={parsed.success ? parsed.data : null} t={t} />
              {result?.ok ? (
                <ul
                  className="flex flex-col gap-0.5 text-xs text-fg-muted"
                  data-testid="cabinet-summary"
                >
                  {result.parts.map((p) => (
                    <li key={p.role} className="flex justify-between gap-2 tabular-nums">
                      <span>
                        {p.qty} × {t.roles[p.role]}
                      </span>
                      <span className="font-mono">
                        {fill(t.size, { w: fmt(p.w), h: fmt(p.h) })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </figure>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger-text" data-testid="cabinet-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={!result?.ok} data-testid="cabinet-add">
              {result?.ok
                ? fill(t.add, { count: result.parts.reduce((s, p) => s + p.qty, 0) })
                : t.addDisabled}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const fmt = (v: number) => nf.format(v);

/** 2D front view (y up), token colours only. */
function FrontView({
  rects,
  params,
  t,
}: {
  rects: ReturnType<typeof cabinetFrontView>;
  params: CabinetParams | null;
  t: Text;
}) {
  if (!params || rects.length === 0) {
    return (
      <div className="aspect-[3/4] w-full rounded-lg border border-dashed border-border bg-canvas" />
    );
  }
  const { width: W, height: H } = params;
  const pad = Math.max(W, H) * 0.06;
  const sw = Math.max(W, H) / 250;
  return (
    <svg
      role="img"
      aria-label={fill(t.previewLabel, { w: fmt(W), h: fmt(H) })}
      viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`}
      className="max-h-72 w-full rounded-lg bg-canvas"
    >
      {rects.map((r, i) => (
        <rect
          key={i}
          data-role={r.role}
          x={r.x}
          y={H - r.y - r.h}
          width={r.w}
          height={r.h}
          strokeWidth={sw}
          className={
            r.role === 'door' ? 'fill-none stroke-accent-text' : 'fill-part stroke-part-stroke'
          }
          strokeDasharray={r.role === 'door' ? `${sw * 6} ${sw * 4}` : undefined}
        />
      ))}
    </svg>
  );
}
