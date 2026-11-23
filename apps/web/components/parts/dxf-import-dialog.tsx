'use client';

/**
 * "DXF içe aktar" (T146, spec §4.6): file → preview + report → unit question when needed →
 * layer mapping → confirm. The confirmed parts arrive in one `importDxf` (one undo step); the
 * chosen layer operations are saved as the company's mapping.
 */
import {
  DXF_LAYER_OPS_READY,
  defaultOnlineDepth,
  DXF_USER_UNITS,
  planDxfImport,
  type DxfDrawing,
  type DxfLayerMap,
  type DxfLayerOp,
  type DxfUnit,
} from '@nittcam/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatMeasure,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nittcam/ui';
import { FileUp, TriangleAlert } from 'lucide-react';
import { useContext, useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { HoleIssuesContext } from '../editor/hole-issues';
import { fill } from '../../lib/fill';
import {
  baseName,
  checkDxfFile,
  effectiveMap,
  importParams,
  layerCounts,
  loadDxf,
  summarize,
  svgPath,
  viewBox,
  type DxfFileProblem,
} from '../../lib/dxf-import';
import type { Messages } from '../../lib/messages';
import { Callout } from '../wizard/panels';

type Text = Messages['dxfImport'];

/** The chosen file: its name and text (parsed in the browser). */
interface Picked {
  name: string;
  text: string;
}

async function loadStoredMap(): Promise<DxfLayerMap> {
  try {
    const res = await fetch('/api/settings/dxf-layers', { cache: 'no-store' });
    if (!res.ok) return {};
    const body = (await res.json()) as { map?: DxfLayerMap };
    return body.map ?? {};
  } catch {
    return {};
  }
}

function saveChoices(layers: Record<string, DxfLayerOp>): void {
  if (Object.keys(layers).length === 0) return;
  void fetch('/api/settings/dxf-layers', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ layers }),
  }).catch(() => undefined);
}

export function DxfImportDialog({
  t,
  open,
  onOpenChange,
  onImport,
  newId,
  holeTool,
  thickness,
}: {
  t: Text;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs `importDxf` with these params; false when the command was rejected. */
  onImport: (params: { parts: unknown[] }, fileName: string, count: number) => boolean;
  newId: () => string;
  /** Tool number for holes made from circles on a "Delik" layer. */
  holeTool?: number;
  /** Stock thickness, mm: the depth of "Çizgi üzerinden" lines (T277). */
  thickness?: number;
}) {
  const ids = { file: useId(), unit: useId() };
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<DxfFileProblem | null>(null);
  const [reading, setReading] = useState(false);
  const [unit, setUnit] = useState<DxfUnit | undefined>(undefined);
  const [stored, setStored] = useState<DxfLayerMap>({});
  const [chosen, setChosen] = useState<Record<string, DxfLayerOp>>({});
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadStoredMap().then((m) => {
      if (live) setStored(m);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // The file as written (its own unit): decides whether the unit question is shown at all.
  const asRead = useMemo(() => (picked ? loadDxf(picked.text) : null), [picked]);
  const loaded = useMemo(
    () => (picked && unit ? loadDxf(picked.text, unit) : asRead),
    [picked, unit, asRead],
  );
  const drawing: DxfDrawing | null = loaded?.ok ? loaded.drawing : null;
  const map = useMemo(() => effectiveMap(stored, chosen), [stored, chosen]);
  const plan = useMemo(() => (drawing ? planDxfImport(drawing, map) : null), [drawing, map]);
  const summary = drawing && plan ? summarize(drawing, plan, holeTool) : null;
  const uncertain = asRead?.ok ? asRead.drawing.units.uncertain : undefined;
  const needsUnit = uncertain !== undefined && unit === undefined;
  const shownProblem = problem ?? (loaded && !loaded.ok ? loaded.problem : null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setPicked(null);
    setUnit(undefined);
    setChosen({});
    setReading(true);
    try {
      const head = await file.slice(0, 32).text();
      const bad = checkDxfFile(file.name, file.size, head);
      if (bad) {
        setProblem(bad);
        return;
      }
      setPicked({ name: file.name, text: await file.text() });
    } catch {
      setProblem('parse');
    } finally {
      setReading(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void pick(e.dataTransfer.files[0]);
  }

  // T320: drill-layer holes take this machine's best compatible tool (when the wizard provides it).
  const machineTools = useContext(HoleIssuesContext).tools;

  function confirm() {
    if (!drawing || !picked || needsUnit) return;
    const base = baseName(picked.name);
    const { parts } = importParams(
      drawing,
      map,
      base,
      newId,
      holeTool,
      defaultOnlineDepth(thickness ?? 18),
      machineTools,
    );
    if (parts.length === 0) return;
    if (onImport({ parts }, picked.name, parts.length)) {
      saveChoices(chosen);
      onOpenChange(false);
    }
  }

  const sizeText = (() => {
    const b = drawing?.bbox;
    if (!b) return '';
    return `${formatMeasure(b.maxX - b.minX)} × ${formatMeasure(b.maxY - b.minY)} mm`;
  })();

  const reportRows: [keyof Text['report'], number, 'warning' | 'info' | null][] = summary
    ? [
        ['parts', summary.parts, null],
        ['inners', summary.inners, null],
        ['holes', summary.holes, null],
        ['lines', summary.lines, null],
        ['supported', summary.supported, null],
        ['converted', summary.converted, summary.converted > 0 ? 'info' : null],
        ['ignored', summary.ignored, null],
        ['skipped', summary.skipped, summary.skipped > 0 ? 'warning' : null],
        ['duplicates', summary.duplicates, null],
        ['open', summary.open, summary.open > 0 ? 'warning' : null],
        ['pending', summary.pending, summary.pending > 0 ? 'warning' : null],
        ['orphans', summary.orphans, summary.orphans > 0 ? 'warning' : null],
        ['lineOrphans', summary.lineOrphans, summary.lineOrphans > 0 ? 'warning' : null],
      ]
    : [];

  const count = plan?.parts.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl"
        data-testid="dxf-dialog"
        // P3 (tester B16): the dialog has no Radix trigger, so focus goes back to "DXF içe aktar"
        // (the toolbar button) when it is on screen; from a menu item the default applies.
        onCloseAutoFocus={(e) => {
          const back = document.querySelector<HTMLElement>('button[data-testid="dxf-open"]');
          if (back && back.offsetParent !== null) {
            e.preventDefault();
            back.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          <div
            className={`flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 ${
              dragging
                ? 'border-accent-border bg-accent-subtle'
                : 'border-border-strong bg-surface-subtle'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-testid="dxf-drop"
          >
            <input
              ref={input}
              id={ids.file}
              type="file"
              accept=".dxf,.dwg"
              className="sr-only"
              // B53 (tester B16): out of the tab order, so the dialog's first focus lands on the
              // visible "Dosya seç" button (with its ring), not on this invisible input.
              tabIndex={-1}
              aria-label={t.fileLabel}
              data-testid="dxf-file"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              size="sm"
              variant={picked ? 'outline' : 'primary'}
              data-testid="dxf-choose"
              onClick={() => input.current?.click()}
            >
              <FileUp aria-hidden />
              {picked ? t.back : t.choose}
            </Button>
            {picked ? (
              <span
                className="min-w-0 truncate font-mono text-sm text-fg"
                data-testid="dxf-file-name"
              >
                {picked.name}
              </span>
            ) : (
              <span className="text-sm text-fg-muted">{reading ? t.reading : t.dropHint}</span>
            )}
          </div>

          {shownProblem ? (
            <Callout
              tone="danger"
              icon={<TriangleAlert aria-hidden />}
              role="alert"
              data-testid="dxf-problem"
            >
              {t.problems[shownProblem]}
            </Callout>
          ) : null}

          {drawing && plan && summary ? (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <section aria-label={t.preview} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-fg">{t.preview}</h3>
                  <span
                    className="font-mono text-xs text-fg-muted tabular-nums"
                    data-testid="dxf-size"
                  >
                    {sizeText}
                  </span>
                </div>
                <svg
                  role="img"
                  aria-label={fill(t.previewLabel, { file: picked?.name ?? '', parts: count })}
                  viewBox={viewBox(drawing.bbox)}
                  className="aspect-[4/3] w-full rounded-lg border border-border bg-canvas"
                  data-testid="dxf-preview"
                  data-parts={count}
                  data-open={summary.open}
                >
                  {plan.parts.map((p, i) => (
                    <path
                      key={`p${i}`}
                      d={[svgPath(p.outline), ...p.inners.map((inner) => svgPath(inner.poly))].join(
                        ' ',
                      )}
                      fillRule="evenodd"
                      className="fill-part stroke-part-stroke"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {plan.open.map((o, i) => (
                    <path
                      key={`o${i}`}
                      d={svgPath(o.poly)}
                      fill="none"
                      className="stroke-warning"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      vectorEffect="non-scaling-stroke"
                      data-testid="dxf-open-path"
                    />
                  ))}
                  {plan.parts.flatMap((p, k) =>
                    p.lines.map((l, i) => (
                      <path
                        key={`l${k}-${i}`}
                        d={svgPath(l.poly)}
                        fill="none"
                        className="stroke-part-stroke"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        data-testid="dxf-line"
                      />
                    )),
                  )}
                  {[...plan.pending, ...plan.orphans, ...plan.lineOrphans].map((c, i) => (
                    <path
                      key={`x${i}`}
                      d={svgPath(c.poly)}
                      fill="none"
                      className="stroke-info"
                      strokeWidth={1.5}
                      strokeDasharray="2 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-3 rounded-sm border border-part-stroke bg-part"
                    />
                    {t.legend.part}
                  </li>
                  {summary.open > 0 ? (
                    <li className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-0 w-4 border-t-2 border-dashed border-warning"
                      />
                      {t.legend.open}
                    </li>
                  ) : null}
                  {summary.pending + summary.orphans + summary.lineOrphans > 0 ? (
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden className="h-0 w-4 border-t-2 border-dotted border-info" />
                      {t.legend.pending}
                    </li>
                  ) : null}
                </ul>
                {summary.open > 0 ? (
                  <Callout
                    tone="warning"
                    icon={<TriangleAlert aria-hidden />}
                    data-testid="dxf-open-warning"
                  >
                    {fill(t.openWarning, { count: summary.open })}
                  </Callout>
                ) : null}
              </section>

              <div className="flex flex-col gap-4">
                <section aria-labelledby={`${ids.unit}-h`} className="flex flex-col gap-2">
                  <h3 id={`${ids.unit}-h`} className="text-sm font-semibold text-fg">
                    {t.unit.title}
                  </h3>
                  {uncertain ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-subtle p-3">
                      <p className="text-sm text-warning-text">
                        {t.unit.question}{' '}
                        {uncertain.reason === 'size'
                          ? fill(t.unit.reasons.size, { size: sizeText })
                          : t.unit.reasons[uncertain.reason]}
                      </p>
                      <label htmlFor={ids.unit} className="text-xs font-medium text-fg">
                        {t.unit.label}
                      </label>
                      <Select value={unit ?? ''} onValueChange={(v) => setUnit(v as DxfUnit)}>
                        <SelectTrigger
                          id={ids.unit}
                          size="sm"
                          data-testid="dxf-unit"
                          data-value={unit ?? ''}
                        >
                          <SelectValue placeholder={t.unit.placeholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {DXF_USER_UNITS.map((u) => (
                            <SelectItem key={u} value={u}>
                              {t.unit.names[u]}
                              {u === uncertain.suggested ? ` (${t.unit.suggested})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p className="text-sm text-fg-muted" data-testid="dxf-unit-known">
                      {fill(t.unit.fromFile, { unit: t.unit.names[drawing.units.unit] })}
                    </p>
                  )}
                </section>

                <section aria-label={t.report.title} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-fg">{t.report.title}</h3>
                  <dl className="flex flex-col text-sm" data-testid="dxf-report">
                    {reportRows
                      .filter(([key, value]) => value > 0 || key === 'parts')
                      .map(([key, value, tone]) => (
                        <div
                          key={key}
                          className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1 last:border-b-0"
                          data-testid={`dxf-report-${key}`}
                          data-value={value}
                        >
                          <dt className="text-fg-muted">
                            {t.report[key]}
                            {key === 'ignored' ? (
                              <span className="block font-mono text-2xs text-fg-subtle">
                                {summary.ignoredTypes.map(([type, n]) => `${type} ${n}`).join(', ')}
                              </span>
                            ) : null}
                          </dt>
                          <dd
                            className={`font-medium tabular-nums ${
                              tone === 'warning'
                                ? 'text-warning-text'
                                : tone === 'info'
                                  ? 'text-info-text'
                                  : 'text-fg'
                            }`}
                          >
                            {value}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </section>
              </div>

              <section aria-label={t.layers.title} className="flex flex-col gap-2 lg:col-span-2">
                <h3 className="text-sm font-semibold text-fg">{t.layers.title}</h3>
                <p className="text-xs text-fg-muted">{t.layers.hint}</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm" data-testid="dxf-layers">
                    <thead className="bg-surface-subtle text-left text-xs text-fg-muted">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {t.layers.layer}
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          {t.layers.count}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {t.layers.op}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {layerCounts(drawing).map(({ layer, count: n }) => {
                        const op = map[layer.trim().toUpperCase()] ?? 'auto';
                        const options: readonly DxfLayerOp[] = DXF_LAYER_OPS_READY.includes(op)
                          ? DXF_LAYER_OPS_READY
                          : [...DXF_LAYER_OPS_READY, op];
                        return (
                          <tr key={layer} className="border-t border-border-subtle">
                            <th
                              scope="row"
                              className="px-3 py-1.5 text-left font-mono font-normal text-fg"
                            >
                              {layer}
                            </th>
                            <td className="px-3 py-1.5 text-right text-fg-muted tabular-nums">
                              {n}
                            </td>
                            <td className="px-3 py-1.5">
                              <Select
                                value={op}
                                onValueChange={(v) =>
                                  setChosen((c) => ({ ...c, [layer]: v as DxfLayerOp }))
                                }
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="min-w-64"
                                  aria-label={`${t.layers.op}: ${layer}`}
                                  data-testid={`dxf-layer-${layer}`}
                                  data-value={op}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {options.map((o) => (
                                    <SelectItem key={o} value={o}>
                                      {t.layers.ops[o]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            onClick={confirm}
            disabled={!drawing || needsUnit || count === 0}
            data-testid="dxf-confirm"
          >
            {drawing && count === 0 ? t.confirmNone : fill(t.confirm, { count })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
