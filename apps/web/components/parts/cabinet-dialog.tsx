'use client';

import {
  MATERIAL_KINDS,
  materialKindOf,
  cabinetFrontView,
  cabinetParamsSchema,
  cabinetParts,
  cabinetPartsForStock,
  DEFAULT_CABINET,
  type CabinetParams,
  type CabinetPart,
} from '@nittcam/core';
import {
  Button,
  Checkbox,
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
import { loadCabinetMemory, saveCabinetMemory } from '../../lib/cabinet-memory';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import type { SplitTarget } from '../../lib/split-project';

type Text = Messages['cutList']['cabinet'];

/** "Dolap N" with the first N not used as a group yet. */
export function nextCabinetName(pattern: string, groups: readonly (string | undefined)[]): string {
  const used = new Set(groups);
  for (let n = 1; ; n++) {
    const name = fill(pattern, { n });
    if (!used.has(name)) return name;
  }
}

export { cabinetRows } from '../../lib/cabinet-rows';

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
  hasGrain,
  defaultGroup,
  onAdd,
  split: splitOff,
}: {
  t: Text;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project's board thickness (the default carcass thickness). */
  thickness: number;
  /** Does the project's stock have a grain? Without one the rows are free to rotate (T260). */
  hasGrain: boolean;
  defaultGroup: string;
  /** Adds the rows; false when the command was rejected. */
  onAdd: (parts: CabinetPart[], group: string) => boolean;
  /**
   * T292: "Ayrı plaka parçalarını yeni projeye aktar". Present only for a saved project: the
   * project's material (the default target) and the call that creates the new project.
   */
  split?:
    | {
        material: string;
        materials: Messages['materials'];
        onSplit: (parts: CabinetPart[], target: SplitTarget, group: string) => void;
      }
    | undefined;
}) {
  const ids = {
    group: useId(),
    back: useId(),
    other: useId(),
    split: useId(),
    splitMaterial: useId(),
  };
  // T260: the last used shelves, back, doors, band and gap (per browser); the box size is fresh.
  const [memory] = useState(() => loadCabinetMemory());
  const [v, setV] = useState<Record<NumKey, number | null>>({
    width: DEFAULT_CABINET.width,
    height: DEFAULT_CABINET.height,
    depth: DEFAULT_CABINET.depth,
    thickness,
    shelves: memory?.shelves ?? DEFAULT_CABINET.shelves,
    doorGap: memory?.doorGap ?? DEFAULT_CABINET.doorGap,
    plinth: DEFAULT_CABINET.plinth,
    band: memory?.band ?? DEFAULT_CABINET.band,
  });
  const [back, setBack] = useState<CabinetParams['back']>({
    ...(memory?.back ?? DEFAULT_CABINET.back),
  });
  const [doors, setDoors] = useState<CabinetParams['doors']>(
    memory?.doors ?? DEFAULT_CABINET.doors,
  );
  const [group, setGroup] = useState(defaultGroup);
  // T260 (D-045): parts in another thickness are added only on purpose.
  const [includeOther, setIncludeOther] = useState(false);
  // T292: the other-thickness parts go to a new project (never both with includeOther).
  const [toNew, setToNew] = useState(false);
  const [target, setTarget] = useState<{ material: string; thickness: number | null }>({
    material: splitOff?.material ?? 'mdf',
    thickness: null,
  });

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
  const split = result?.ok
    ? cabinetPartsForStock(result.parts, { thickness, hasGrain }, includeOther)
    : null;
  const addCount = split ? split.rows.reduce((s, p) => s + p.qty, 0) : 0;
  const moving = splitOff && toNew && split ? split.other : [];
  const firstOther = split?.other[0]?.thickness ?? null;
  const targetThickness = target.thickness ?? firstOther;
  const moveCount = moving.reduce((s, p) => s + p.qty, 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!split || !parsed.success || split.rows.length === 0) return;
    if (moving.length > 0 && !(targetThickness !== null && targetThickness > 0)) return;
    if (onAdd(split.rows, group)) {
      if (splitOff && moving.length > 0 && targetThickness !== null) {
        splitOff.onSplit(moving, { material: target.material, thickness: targetThickness }, group);
      }
      const { shelves, back: b, doors: d, band, doorGap } = parsed.data;
      saveCabinetMemory({ shelves, back: b, doors: d, band, doorGap });
      onOpenChange(false);
    }
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
      <DialogContent className="max-w-4xl" data-testid="cabinet-dialog">
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
                      {/* T260: the short label fits the field; the list explains each mode. */}
                      <SelectValue>{t.backModesShort[back.mode]}</SelectValue>
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
                    className="flex min-h-control-sm flex-wrap items-center gap-x-4 gap-y-1"
                    aria-label={t.fields.doors}
                    data-testid="cabinet-doors"
                  >
                    {([0, 1, 2] as const).map((d) => (
                      <label
                        key={d}
                        className="flex items-center gap-1.5 text-sm whitespace-nowrap text-fg"
                      >
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
                  {result.parts.map((p) => {
                    const other = split?.other.some((o) => o.role === p.role) ?? false;
                    return (
                      <li
                        key={p.role}
                        data-part={p.role}
                        data-other={other ? '' : undefined}
                        className={`flex justify-between gap-2 tabular-nums ${other && !includeOther ? 'text-fg-subtle' : ''}`}
                      >
                        <span>
                          {p.qty} × {t.roles[p.role]}
                        </span>
                        <span className="text-right font-mono">
                          {fill(t.size, { w: fmt(p.w), h: fmt(p.h) })}
                          {other ? (
                            <span className="font-sans">
                              {' · '}
                              {fill(t.otherBoard, { t: fmt(p.thickness) })}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {split && split.other.length > 0 ? (
                <div
                  className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-subtle px-2.5 py-2 text-xs"
                  data-testid="cabinet-other"
                >
                  <p className="text-fg-muted">{fill(t.otherNote, { t: fmt(thickness) })}</p>
                  <label htmlFor={ids.other} className="flex items-center gap-2 text-sm text-fg">
                    <Checkbox
                      id={ids.other}
                      data-testid="cabinet-include-other"
                      checked={includeOther}
                      onCheckedChange={(c) => {
                        setIncludeOther(c === true);
                        if (c === true) setToNew(false);
                      }}
                    />
                    {t.includeOther}
                  </label>
                  {splitOff ? (
                    <>
                      <label
                        htmlFor={ids.split}
                        className="flex items-center gap-2 text-sm text-fg"
                      >
                        <Checkbox
                          id={ids.split}
                          data-testid="cabinet-split"
                          checked={toNew}
                          onCheckedChange={(c) => {
                            setToNew(c === true);
                            if (c === true) setIncludeOther(false);
                          }}
                        />
                        {t.split.action}
                      </label>
                      {toNew ? (
                        <div className="grid grid-cols-2 gap-2" data-testid="cabinet-split-target">
                          <div className="flex flex-col gap-1">
                            <label htmlFor={ids.splitMaterial} className="text-fg-muted">
                              {t.split.material}
                            </label>
                            <Select
                              value={target.material}
                              onValueChange={(m) => setTarget((x) => ({ ...x, material: m }))}
                            >
                              <SelectTrigger
                                id={ids.splitMaterial}
                                size="sm"
                                data-testid="cabinet-split-material"
                                data-value={target.material}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(MATERIAL_KINDS.some((k) => k === splitOff.material)
                                  ? [...MATERIAL_KINDS]
                                  : [splitOff.material, ...MATERIAL_KINDS]
                                ).map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {splitOff.materials[materialKindOf(m) ?? 'unknown'].replace(
                                      '{id}',
                                      m,
                                    )}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <FormField label={t.split.thickness}>
                            <NumberInput
                              data-testid="cabinet-split-thickness"
                              inputSize="sm"
                              value={targetThickness}
                              unit="mm"
                              min={0.1}
                              maxDecimals={1}
                              onValueChange={(n) => setTarget((x) => ({ ...x, thickness: n }))}
                            />
                          </FormField>
                          <p className="col-span-2 text-fg-muted" data-testid="cabinet-split-note">
                            {fill(t.split.note, { count: moveCount })}
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
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
            <Button type="submit" disabled={addCount === 0} data-testid="cabinet-add">
              {addCount > 0 ? fill(t.add, { count: addCount }) : t.addDisabled}
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
