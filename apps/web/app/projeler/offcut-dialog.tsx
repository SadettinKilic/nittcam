'use client';

import { MATERIAL_KINDS, propsFieldsOf, traitsOf, materialKindOf } from '@nittcam/core';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nittcam/ui';
import { useId, useState, type FormEvent } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import {
  OFFCUT_MAX_MM,
  emptyOffcutForm,
  offcutBody,
  offcutChanges,
  offcutFormOf,
  type OffcutFormValues,
} from '../../lib/offcut-form';
import type { NewOffcut, OffcutItem } from '../../lib/offcuts-api';
import { materialLabel } from './projects-view';

type Text = Messages['projects']['offcuts'];
type Body = Omit<NewOffcut, 'sourceProjectId'>;
const GRAIN_NONE = 'none';

/**
 * "Artık parça ekle" / "Düzelt" (T291): material, thickness, width (en), length (boy), grain.
 * `item` = edit that offcut (only the changed fields are sent); none = a new stock offcut.
 * `onSubmit` returns false when the request failed (the dialog stays open).
 */
export function OffcutDialog({
  t,
  materials,
  item,
  onClose,
  onSubmit,
}: {
  t: Text;
  materials: Messages['materials'];
  item: OffcutItem | null;
  onClose: () => void;
  onSubmit: (body: Body | Partial<Body>) => Promise<boolean>;
}) {
  const f = t.form;
  const [v, setV] = useState<OffcutFormValues>(() =>
    item ? offcutFormOf(item) : emptyOffcutForm(),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // P3 (CTO #12): a typed size outside the range is not taken; the field says the range.
  const [rangeError, setRangeError] = useState<
    Partial<Record<'thickness' | 'width' | 'height', boolean>>
  >({});
  const ids = { material: useId(), grain: useId() };
  const kind = materialKindOf(v.material);
  const grainable = traitsOf(kind).direction.kind !== 'none';
  // T350: the kind's matching property (aluminium alloy, ACM colour code)
  const fields = propsFieldsOf(kind);
  // A stored material that is not a known kind stays selectable as itself.
  const options: string[] = kind || !item ? [...MATERIAL_KINDS] : [v.material, ...MATERIAL_KINDS];

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (Object.values(rangeError).some(Boolean)) return setMessage(f.invalid);
    const body = offcutBody(v);
    if (!body) return setMessage(f.invalid);
    const send = item ? offcutChanges(item, body) : body;
    if (Object.keys(send).length === 0) return setMessage(f.unchanged);
    setBusy(true);
    const ok = await onSubmit(send);
    setBusy(false);
    if (!ok) setMessage(t.toast.failed);
  }

  const size = (key: 'thickness' | 'width' | 'height') => (
    <FormField
      label={f[key]}
      error={
        rangeError[key] ? fill(f.range, { max: OFFCUT_MAX_MM.toLocaleString('tr-TR') }) : undefined
      }
    >
      <NumberInput
        data-testid={`offcut-form-${key}`}
        value={v[key]}
        onValueChange={(n) => setV((x) => ({ ...x, [key]: n }))}
        onValidityChange={(e) => setRangeError((r) => ({ ...r, [key]: e !== null }))}
        min={0.1}
        max={OFFCUT_MAX_MM}
        unit="mm"
        required
      />
    </FormField>
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-lg" data-testid="offcut-dialog">
        <form onSubmit={(ev) => void save(ev)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{item ? f.titleEdit : f.titleNew}</DialogTitle>
            <DialogDescription>{f.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.material} className="text-sm font-medium text-fg">
                {f.material}
              </label>
              <Select
                value={v.material}
                onValueChange={(m) =>
                  setV((x) => ({
                    ...x,
                    material: m,
                    grain:
                      traitsOf(materialKindOf(m)).direction.kind !== 'none' ? (x.grain ?? 0) : null,
                  }))
                }
              >
                <SelectTrigger
                  id={ids.material}
                  data-testid="offcut-form-material"
                  data-value={v.material}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((m) => (
                    <SelectItem key={m} value={m}>
                      {materialLabel(materials, m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {size('thickness')}
            {size('width')}
            {size('height')}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor={ids.grain} className="text-sm font-medium text-fg">
                {f.grain}
              </label>
              <Select
                value={v.grain === null ? GRAIN_NONE : String(v.grain)}
                disabled={!grainable}
                onValueChange={(g) =>
                  setV((x) => ({ ...x, grain: g === '0' ? 0 : g === '90' ? 90 : null }))
                }
              >
                <SelectTrigger
                  id={ids.grain}
                  data-testid="offcut-form-grain"
                  data-value={v.grain === null ? GRAIN_NONE : String(v.grain)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{f.grain0}</SelectItem>
                  <SelectItem value="90">{f.grain90}</SelectItem>
                  <SelectItem value={GRAIN_NONE}>{f.grainNone}</SelectItem>
                </SelectContent>
              </Select>
              {grainable ? null : <p className="text-xs text-fg-muted">{f.grainNoneHint}</p>}
            </div>
          </div>
          {fields.includes('alloy') ? (
            <FormField label={f.alloy} hint={f.alloyHint}>
              <Input
                data-testid="offcut-form-alloy"
                value={v.alloy}
                maxLength={20}
                onChange={(e) => setV((x) => ({ ...x, alloy: e.target.value }))}
              />
            </FormField>
          ) : null}
          {fields.includes('colorCode') ? (
            <FormField label={f.colorCode} hint={f.colorCodeHint}>
              <Input
                data-testid="offcut-form-colorCode"
                value={v.colorCode}
                maxLength={30}
                onChange={(e) => setV((x) => ({ ...x, colorCode: e.target.value }))}
              />
            </FormField>
          ) : null}
          {message ? (
            <p role="alert" className="text-sm text-danger-text" data-testid="offcut-form-message">
              {message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {f.cancel}
            </Button>
            <Button type="submit" loading={busy} disabled={busy} data-testid="offcut-form-save">
              {f.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
