'use client';

import {
  MATERIAL_KINDS,
  materialHasGrain,
  materialToneSchema,
  type MaterialKind,
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
  const grainable = materialHasGrain(d.kind);

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

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium text-fg">{f.grain}</legend>
            {grainable ? (
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-fg">
                  <Checkbox
                    data-testid="material-grain-on"
                    checked={d.grainOn}
                    onCheckedChange={(c) => setD((x) => ({ ...x, grainOn: c === true }))}
                  />
                  {f.grainOn}
                </label>
                {d.grainOn ? (
                  <NumberInput
                    id={ids.grain}
                    aria-label={f.grainAngle}
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
                <p className="w-full text-xs text-fg-muted">{f.grainHint}</p>
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
