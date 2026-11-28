'use client';

import {
  ALUMINIUM_FINISHES,
  MATERIAL_KINDS,
  propsFieldsOf,
  traitsOf,
  materialToneSchema,
  type MaterialKind,
  type MaterialProps,
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
  IconButton,
  Input,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nittcam/ui';
import { Plus, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { MaterialSwatch } from '../../../components/materials/swatch';
import { fill } from '../../../lib/fill';
import { getMessages } from '../../../lib/messages';
import {
  toMaterial,
  type MaterialDraft,
  type MaterialFormErrors,
} from '../../../lib/material-form';
import type { Messages } from '../../../lib/messages';
import type { LibraryMaterial } from '@nittcam/core';

type Text = Messages['materialLibrary'];
type KindText = Messages['materials'];

const TONES = materialToneSchema.options;
const MAX_ROWS = 8;

/** New / edit dialog of a library entry (T121). Enter in any field saves; Esc cancels. */
export function MaterialDialog({
  t,
  kinds,
  open,
  title,
  initial,
  busy,
  onSave,
  onOpenChange,
}: {
  t: Text;
  kinds: KindText;
  open: boolean;
  title: string;
  initial: MaterialDraft;
  busy: boolean;
  onSave: (material: LibraryMaterial) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const f = t.form;
  const ids = { name: useId(), kind: useId(), tone: useId(), grain: useId() };
  const [d, setD] = useState<MaterialDraft>(initial);
  const [errors, setErrors] = useState<MaterialFormErrors>({});
  const traits = traitsOf(d.kind);
  const grainable = traits.direction.kind !== 'none';
  // T350: the direction wording of the kind (Damar / Yüzey yönü / Film oku yönü)
  const dir = getMessages().direction[traits.direction.label];
  const woodWords = traits.direction.label === 'grain';
  const fields = propsFieldsOf(d.kind);
  const p = f.props;
  const setProp = <K extends keyof MaterialProps>(k: K, v: MaterialProps[K] | undefined) =>
    setD((x) => {
      const empty = v === undefined || v === '' || v === false;
      const rest = Object.fromEntries(Object.entries(x.props).filter(([key]) => key !== k));
      return { ...x, props: empty ? rest : { ...rest, [k]: v } };
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = toMaterial(d);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    onSave(r.material);
  }

  const setThickness = (i: number, v: number | null) =>
    setD((x) => ({ ...x, thicknesses: x.thicknesses.map((o, j) => (j === i ? v : o)) }));
  const setSheet = (i: number, key: 'width' | 'height' | 'qty', v: number | null) =>
    setD((x) => ({ ...x, sheets: x.sheets.map((s, j) => (j === i ? { ...s, [key]: v } : s)) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="material-dialog">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{f.description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.name} id={ids.name} error={errors.name ? f.errors.name : undefined}>
              <Input
                id={ids.name}
                data-testid="material-name"
                value={d.name}
                maxLength={60}
                placeholder={f.namePlaceholder}
                autoFocus
                onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))}
              />
            </FormField>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.kind} className="text-sm font-medium text-fg">
                {f.kind}
              </label>
              <Select
                value={d.kind}
                onValueChange={(v) => setD((x) => ({ ...x, kind: v as MaterialKind }))}
              >
                <SelectTrigger id={ids.kind} data-testid="material-kind" data-value={d.kind}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {kinds[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor={ids.tone} className="text-sm font-medium text-fg">
                {f.tone}
              </label>
              <Select
                value={d.tone}
                onValueChange={(v) => setD((x) => ({ ...x, tone: v as MaterialDraft['tone'] }))}
              >
                <SelectTrigger id={ids.tone} data-testid="material-tone" data-value={d.tone}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((tone) => (
                    <SelectItem key={tone} value={tone}>
                      <span className="flex items-center gap-2">
                        <MaterialSwatch tone={tone} />
                        {t.tones[tone]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2" data-testid="material-thicknesses">
            <legend className="mb-1.5 text-sm font-medium text-fg">{f.thicknesses}</legend>
            <div className="flex flex-wrap items-center gap-2">
              {d.thicknesses.map((v, i) => (
                <div key={i} className="flex items-center gap-1">
                  <NumberInput
                    aria-label={fill(f.thicknessLabel, { n: i + 1 })}
                    className="w-28"
                    inputSize="sm"
                    value={v}
                    unit="mm"
                    min={0.1}
                    max={200}
                    maxDecimals={1}
                    onValueChange={(n) => setThickness(i, n)}
                  />
                  {d.thicknesses.length > 1 ? (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={fill(f.removeThickness, { value: v ?? '' })}
                      onClick={() =>
                        setD((x) => ({
                          ...x,
                          thicknesses: x.thicknesses.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      <X aria-hidden />
                    </IconButton>
                  ) : null}
                </div>
              ))}
              {d.thicknesses.length < MAX_ROWS ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setD((x) => ({ ...x, thicknesses: [...x.thicknesses, null] }))}
                >
                  <Plus aria-hidden />
                  {f.addThickness}
                </Button>
              ) : null}
            </div>
            {errors.thicknesses ? (
              <p role="alert" className="text-xs text-danger-text">
                {f.errors.thicknesses}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-2" data-testid="material-sheets">
            <legend className="mb-1.5 text-sm font-medium text-fg">{f.sheets}</legend>
            {d.sheets.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <NumberInput
                  aria-label={fill(f.sheetWidth, { n: i + 1 })}
                  className="w-32"
                  inputSize="sm"
                  value={s.width}
                  unit="mm"
                  min={1}
                  max={10000}
                  maxDecimals={1}
                  onValueChange={(n) => setSheet(i, 'width', n)}
                />
                <span aria-hidden className="text-fg-muted">
                  ×
                </span>
                <NumberInput
                  aria-label={fill(f.sheetHeight, { n: i + 1 })}
                  className="w-32"
                  inputSize="sm"
                  value={s.height}
                  unit="mm"
                  min={1}
                  max={10000}
                  maxDecimals={1}
                  onValueChange={(n) => setSheet(i, 'height', n)}
                />
                <NumberInput
                  aria-label={fill(f.sheetQty, { n: i + 1 })}
                  className="w-28"
                  inputSize="sm"
                  value={s.qty}
                  unit={f.qtyUnit}
                  placeholder={f.qtyUnlimited}
                  min={1}
                  max={100000}
                  maxDecimals={0}
                  onValueChange={(n) => setSheet(i, 'qty', n)}
                />
                {d.sheets.length > 1 ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={fill(f.removeSheet, { n: i + 1 })}
                    onClick={() =>
                      setD((x) => ({ ...x, sheets: x.sheets.filter((_, j) => j !== i) }))
                    }
                  >
                    <X aria-hidden />
                  </IconButton>
                ) : null}
              </div>
            ))}
            {d.sheets.length < MAX_ROWS ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() =>
                  setD((x) => ({
                    ...x,
                    sheets: [...x.sheets, { width: null, height: null, qty: null }],
                  }))
                }
              >
                <Plus aria-hidden />
                {f.addSheet}
              </Button>
            ) : null}
            {errors.sheets ? (
              <p role="alert" className="text-xs text-danger-text">
                {f.errors.sheets}
              </p>
            ) : null}
          </fieldset>

          {/* T350 (analysis §4.4): the kind's own properties (aluminium alloy, ACM colour code). */}
          {fields.length > 0 ? (
            <fieldset className="flex flex-col gap-2" data-testid="material-props">
              <legend className="mb-1.5 text-sm font-medium text-fg">{p.title}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.includes('alloy') ? (
                  <FormField label={p.alloy} id={`${ids.name}-alloy`}>
                    <Input
                      id={`${ids.name}-alloy`}
                      data-testid="material-alloy"
                      value={d.props.alloy ?? ''}
                      maxLength={20}
                      placeholder={p.alloyPlaceholder}
                      onChange={(e) => setProp('alloy', e.target.value)}
                    />
                  </FormField>
                ) : null}
                {fields.includes('temper') ? (
                  <FormField label={p.temper} id={`${ids.name}-temper`}>
                    <Input
                      id={`${ids.name}-temper`}
                      data-testid="material-temper"
                      value={d.props.temper ?? ''}
                      maxLength={10}
                      placeholder={p.temperPlaceholder}
                      onChange={(e) => setProp('temper', e.target.value)}
                    />
                  </FormField>
                ) : null}
                {fields.includes('finish') ? (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${ids.name}-finish`} className="text-sm font-medium text-fg">
                      {p.finish}
                    </label>
                    <Select
                      value={d.props.finish ?? 'none'}
                      onValueChange={(v) =>
                        setProp(
                          'finish',
                          v === 'none' ? undefined : (v as NonNullable<MaterialProps['finish']>),
                        )
                      }
                    >
                      <SelectTrigger id={`${ids.name}-finish`} data-testid="material-finish">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{p.finishNone}</SelectItem>
                        {ALUMINIUM_FINISHES.map((x) => (
                          <SelectItem key={x} value={x}>
                            {p.finishes[x]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {fields.includes('colorCode') ? (
                  <FormField label={p.colorCode} id={`${ids.name}-colorCode`}>
                    <Input
                      id={`${ids.name}-colorCode`}
                      data-testid="material-color-code"
                      value={d.props.colorCode ?? ''}
                      maxLength={30}
                      placeholder={p.colorCodePlaceholder}
                      onChange={(e) => setProp('colorCode', e.target.value)}
                    />
                  </FormField>
                ) : null}
                {fields.includes('skin') ? (
                  <FormField label={p.skin} id={`${ids.name}-skin`}>
                    <NumberInput
                      id={`${ids.name}-skin`}
                      data-testid="material-skin"
                      inputSize="sm"
                      unit="mm"
                      value={d.props.skin ?? null}
                      min={0.1}
                      max={2}
                      maxDecimals={2}
                      onValueChange={(n) => setProp('skin', n ?? undefined)}
                    />
                  </FormField>
                ) : null}
                {fields.includes('film') ? (
                  <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
                    <Checkbox
                      data-testid="material-film"
                      checked={d.props.film === true}
                      onCheckedChange={(c) => setProp('film', c === true)}
                    />
                    {p.film}
                  </label>
                ) : null}
                {fields.includes('metallic') ? (
                  <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
                    <Checkbox
                      data-testid="material-metallic"
                      checked={d.props.metallic === true}
                      onCheckedChange={(c) => setProp('metallic', c === true)}
                    />
                    {p.metallic}
                  </label>
                ) : null}
              </div>
              {fields.includes('skin') ? (
                <p className="text-xs text-fg-muted">{p.skinHint}</p>
              ) : null}
              {errors.props ? (
                <p role="alert" className="text-xs text-danger-text">
                  {p.invalid}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-fg">
              {woodWords ? f.grain : dir.title}
            </legend>
            {grainable ? (
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-fg">
                  <Checkbox
                    data-testid="material-grain-on"
                    checked={d.grainOn}
                    onCheckedChange={(c) => setD((x) => ({ ...x, grainOn: c === true }))}
                  />
                  {woodWords ? f.grainOn : fill(f.directionOn, { direction: dir.title })}
                </label>
                {d.grainOn ? (
                  <NumberInput
                    id={ids.grain}
                    aria-label={woodWords ? f.grainAngle : dir.label}
                    data-testid="material-grain"
                    className="w-28"
                    inputSize="sm"
                    value={d.grain}
                    unit="°"
                    min={0}
                    max={179}
                    maxDecimals={1}
                    onValueChange={(n) => setD((x) => ({ ...x, grain: n }))}
                  />
                ) : null}
                <p className="w-full text-xs text-fg-muted">
                  {f.grainHint}
                  {woodWords ? null : ` ${dir.note}`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-fg-muted">{f.grainPlastic}</p>
            )}
            {errors.grain ? (
              <p role="alert" className="text-xs text-danger-text">
                {f.errors.grain}
              </p>
            ) : null}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {f.cancel}
            </Button>
            <Button type="submit" disabled={busy} data-testid="material-save">
              {f.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
