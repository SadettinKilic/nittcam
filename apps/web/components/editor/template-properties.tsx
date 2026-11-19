'use client';

/**
 * Templates of the selected part (T147, T148, spec §4.7): "Şablon ekle" (pick a company template →
 * ghost on the canvas → "Yerleştir" = one `addTemplate`), the placed instances with their params
 * and placement (each change one `updateTemplateInstance`), and "Şablon olarak kaydet" (holes and
 * inner contours of the part → a new company template, version 1).
 */
import {
  localBox,
  templateFromPart,
  type Part,
  type TemplateEdge,
  type TemplateParams,
  type TemplatePlacement,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  InspectorGroup,
  InspectorRow as Row,
  InspectorRows,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  formatMeasure,
  notify,
} from '@nittcam/ui';
import { LayoutTemplate, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { fill } from '../../lib/draft-project';
import {
  addTemplateParams,
  placementAlong,
  startPlacement,
  type PendingTemplate,
} from '../../lib/editor/template-place';
import type { Messages } from '../../lib/messages';
import { createTemplate, fetchTemplates, type TemplateItem } from '../../lib/templates-api';
import { NumberRow, type Run } from './properties';

type T = Messages['editor']['inspector']['template'];
type Edge = TemplateEdge | 'free';
const EDGES: readonly Edge[] = ['left', 'right', 'bottom', 'top', 'free'];

/** Default rotation per anchored edge: local +x points into the part. */
const EDGE_ROT: Record<TemplateEdge, number> = { left: 0, bottom: 90, right: 180, top: 270 };

interface Value {
  params: TemplateParams;
  placement: TemplatePlacement;
  geometry: PendingTemplate['geometry'];
}

/** Params patch → null when accepted, else the error text. */
type ParamsChange = (patch: Partial<TemplateParams>) => string | null;
type PlacementChange = (patch: Partial<TemplatePlacement>) => string | null;

/** The editable fields of a pending or placed template. */
function TemplateFields({
  t,
  tid,
  value,
  onParams,
  onPlacement,
}: {
  t: T;
  tid: string;
  value: Value;
  onParams: ParamsChange;
  onPlacement: PlacementChange;
}) {
  const edgeId = useId();
  const mirrorId = useId();
  const { params, placement: pl, geometry } = value;
  const edge: Edge = pl.edge ?? 'free';
  const positive =
    (key: 'spacing' | 'edgeDistance', min = 0) =>
    (v: number | null) =>
      v === null || !Number.isFinite(v) || v < min ? t.invalid : onParams({ [key]: v });
  return (
    <InspectorRows>
      <Row
        label={<label htmlFor={edgeId}>{t.edge}</label>}
        mono={false}
        valueProps={{ className: 'overflow-visible' }}
      >
        <Select
          value={edge}
          onValueChange={(v) => {
            const e = v as Edge;
            onPlacement(e === 'free' ? { edge: null } : { edge: e, rot: EDGE_ROT[e] });
          }}
        >
          <SelectTrigger
            id={edgeId}
            className="h-control-sm w-36"
            data-testid={`${tid}-edge`}
            data-value={edge}
          >
            <SelectValue>{t.edges[edge]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {EDGES.map((e) => (
              <SelectItem key={e} value={e}>
                {t.edges[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {pl.edge ? (
        <>
          <NumberRow
            label={t.edgeDistance}
            value={params.edgeDistance}
            testId={`${tid}-edge-distance`}
            onCommit={positive('edgeDistance')}
          />
          <NumberRow
            label={t.along}
            value={placementAlong(pl)}
            testId={`${tid}-along`}
            onCommit={(v) =>
              v === null || !Number.isFinite(v)
                ? t.invalid
                : onPlacement(pl.edge === 'bottom' || pl.edge === 'top' ? { x: v } : { y: v })
            }
          />
        </>
      ) : (
        <>
          <NumberRow
            label={t.x}
            value={pl.x}
            testId={`${tid}-x`}
            onCommit={(v) =>
              v === null || !Number.isFinite(v) ? t.invalid : onPlacement({ x: v })
            }
          />
          <NumberRow
            label={t.y}
            value={pl.y}
            testId={`${tid}-y`}
            onCommit={(v) =>
              v === null || !Number.isFinite(v) ? t.invalid : onPlacement({ y: v })
            }
          />
        </>
      )}
      <NumberRow
        label={t.count}
        value={params.count}
        unit=""
        maxDecimals={0}
        testId={`${tid}-count`}
        onCommit={(v) =>
          v === null || !Number.isInteger(v) || v < 1 || v > 50 ? t.invalid : onParams({ count: v })
        }
      />
      {params.count > 1 ? (
        <NumberRow
          label={t.spacing}
          value={params.spacing}
          testId={`${tid}-spacing`}
          onCommit={positive('spacing')}
        />
      ) : null}
      {geometry.holes.map((h) => (
        <NumberRow
          key={h.id}
          label={fill(t.diameter, { hole: h.id })}
          value={params.d[h.id] ?? h.d}
          testId={`${tid}-d-${h.id}`}
          onCommit={(v) =>
            v === null || !Number.isFinite(v) || v <= 0
              ? t.invalid
              : onParams({ d: { ...params.d, [h.id]: v } })
          }
        />
      ))}
      <Row
        label={<label htmlFor={mirrorId}>{t.mirror}</label>}
        mono={false}
        valueProps={{ className: 'flex items-center justify-end gap-1 overflow-visible' }}
      >
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t.rotate}
          data-testid={`${tid}-rotate`}
          onClick={() => onPlacement({ rot: (pl.rot + 90) % 360 })}
        >
          <RotateCcw aria-hidden />
        </IconButton>
        <Switch
          id={mirrorId}
          checked={pl.mirror}
          data-testid={`${tid}-mirror`}
          onCheckedChange={(on) => onPlacement({ mirror: on })}
        />
      </Row>
    </InspectorRows>
  );
}

/** "Şablon olarak kaydet": name, reference edge and the holes / inner contours to take. */
function SaveDialog({
  t,
  part,
  open,
  onOpenChange,
  onSaved,
}: {
  t: T;
  part: Part;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: TemplateItem) => void;
}) {
  const nameId = useId();
  const edgeId = useId();
  const [name, setName] = useState('');
  const [edge, setEdge] = useState<Edge>('left');
  const [holes, setHoles] = useState<Set<string>>(() => new Set(part.holes.map((h) => h.id)));
  const [inners, setInners] = useState<Set<number>>(() => new Set(part.inners.map((_, i) => i)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) return setError(t.nameRequired);
    const r = templateFromPart(part, {
      holeIds: part.holes.filter((h) => holes.has(h.id)).map((h) => h.id),
      inners: [...inners].sort((a, b) => a - b),
      edge: edge === 'free' ? null : edge,
    });
    if (typeof r === 'string') return setError(t.nothing);
    setBusy(true);
    const item = await createTemplate({ name: name.trim(), ...r });
    setBusy(false);
    if (!item) return setError(t.saveError);
    notify.success(fill(t.saved, { name: item.name }));
    onSaved(item);
    onOpenChange(false);
  }

  const toggle = <K,>(set: Set<K>, k: K, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(k);
    else next.delete(k);
    return next;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="template-save-dialog">
        <form onSubmit={save} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t.save}</DialogTitle>
            <DialogDescription>{t.saveDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor={nameId} className="text-sm font-medium text-fg">
              {t.name}
            </label>
            <Input
              id={nameId}
              value={name}
              maxLength={80}
              data-testid="template-save-name"
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={edgeId} className="text-sm font-medium text-fg">
              {t.refEdge}
            </label>
            <Select value={edge} onValueChange={(v) => setEdge(v as Edge)}>
              <SelectTrigger id={edgeId} data-testid="template-save-edge" data-value={edge}>
                <SelectValue>{t.edges[edge]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EDGES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t.edges[e]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-fg-muted">{t.refEdgeHint}</p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-fg">{t.include}</legend>
            {part.holes.map((h, i) => (
              <label key={h.id} className="flex items-center gap-2 text-sm text-fg">
                <Checkbox
                  checked={holes.has(h.id)}
                  data-testid={`template-save-hole-${i}`}
                  onCheckedChange={(on) => setHoles((s) => toggle(s, h.id, on === true))}
                />
                {fill(t.holeItem, { n: i + 1, d: formatMeasure(h.d) })}
              </label>
            ))}
            {part.inners.map((_, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-fg">
                <Checkbox
                  checked={inners.has(i)}
                  data-testid={`template-save-inner-${i}`}
                  onCheckedChange={(on) => setInners((s) => toggle(s, i, on === true))}
                />
                {fill(t.innerItem, { n: i + 1 })}
              </label>
            ))}
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-danger-text" data-testid="template-save-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={busy} data-testid="template-save-submit">
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TemplateProperties({
  t,
  part,
  run,
  pending,
  onPending,
}: {
  t: T;
  part: Part;
  run: Run;
  /** The template being placed (ghost on the canvas), if any. */
  pending: PendingTemplate | null;
  onPending: (p: PendingTemplate | null) => void;
}) {
  const [items, setItems] = useState<TemplateItem[] | null | 'loading' | 'error'>(null);
  const [saving, setSaving] = useState(false);
  const mine = pending?.partId === part.id ? pending : null;

  async function load() {
    setItems('loading');
    setItems((await fetchTemplates()) ?? 'error');
  }

  function place() {
    if (!mine) return;
    const ok = run('addTemplate', addTemplateParams(mine));
    if (ok) onPending(null);
    else notify.error(t.refused);
  }

  const update = (instanceId: string, patch: Record<string, unknown>) =>
    run('updateTemplateInstance', { id: part.id, instanceId, ...patch }) ? null : t.refused;

  const canSave = part.holes.length + part.inners.length > 0;

  return (
    <InspectorGroup title={t.title} data-testid="prop-group-templates">
      <div className="flex flex-wrap gap-2 pb-1">
        <DropdownMenu onOpenChange={(open) => open && void load()}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="secondary" data-testid="template-add">
              <Plus aria-hidden />
              {t.add}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="template-menu">
            {items === 'loading' || items === null ? (
              <DropdownMenuItem disabled>{t.loading}</DropdownMenuItem>
            ) : items === 'error' ? (
              <DropdownMenuItem disabled>{t.loadError}</DropdownMenuItem>
            ) : items.length === 0 ? (
              <DropdownMenuItem disabled className="max-w-64 whitespace-normal">
                {t.empty}
              </DropdownMenuItem>
            ) : (
              items.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  data-testid="template-menu-item"
                  onSelect={() => onPending(startPlacement(part.id, item, localBox(part)))}
                >
                  <LayoutTemplate aria-hidden />
                  {fill(t.instance, { name: item.name, v: item.version })}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {canSave ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="template-save"
            onClick={() => setSaving(true)}
          >
            <Save aria-hidden />
            {t.save}
          </Button>
        ) : null}
      </div>

      {mine ? (
        <div
          className="flex flex-col gap-1 rounded-md border border-accent-border bg-accent-subtle p-2"
          data-testid="template-pending"
        >
          <h3 className="text-xs font-medium text-fg">{fill(t.placing, { name: mine.name })}</h3>
          <p className="text-xs text-fg-muted">{t.placingHint}</p>
          <TemplateFields
            t={t}
            tid="template-pending"
            value={mine}
            onParams={(patch) => {
              onPending({ ...mine, params: { ...mine.params, ...patch } });
              return null;
            }}
            onPlacement={(patch) => {
              onPending({ ...mine, placement: { ...mine.placement, ...patch } });
              return null;
            }}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => onPending(null)}>
              {t.cancel}
            </Button>
            <Button size="sm" data-testid="template-place" onClick={place}>
              {t.place}
            </Button>
          </div>
        </div>
      ) : null}

      {part.templates.map((ref, i) => (
        <div key={ref.instanceId} className="flex flex-col" data-testid={`template-instance-${i}`}>
          <div className="flex items-center justify-between pt-1">
            <h3 className="text-xs font-medium text-fg-muted">
              {fill(t.instance, { name: ref.name, v: ref.version })}
            </h3>
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={fill(t.remove, { name: ref.name })}
              data-testid={`template-instance-${i}-remove`}
              onClick={() =>
                run('removeTemplateInstance', { id: part.id, instanceId: ref.instanceId })
              }
            >
              <Trash2 aria-hidden />
            </IconButton>
          </div>
          <TemplateFields
            t={t}
            tid={`template-instance-${i}`}
            value={ref}
            onParams={(patch) => update(ref.instanceId, { params: patch })}
            onPlacement={(patch) => update(ref.instanceId, { placement: patch })}
          />
        </div>
      ))}

      {saving ? (
        <SaveDialog
          t={t}
          part={part}
          open={saving}
          onOpenChange={setSaving}
          onSaved={(item) => setItems((cur) => (Array.isArray(cur) ? [...cur, item] : cur))}
        />
      ) : null}
    </InspectorGroup>
  );
}
