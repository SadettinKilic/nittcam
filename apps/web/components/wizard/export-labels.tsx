'use client';

import { labelGridSchema, labelOffsetSchema, type LabelGrid } from '@nittcam/core';
import {
  Button,
  buttonVariants,
  FormField,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nittcam/ui';
import { Download, Tags } from 'lucide-react';
import { useState } from 'react';
import { fill } from '../../lib/fill';
import {
  gridOf,
  labelQuery,
  validStart,
  loadLabelSettings,
  saveLabelSettings,
  type LabelChoice,
  type LabelSettings,
} from '../../lib/labels-query';
import type { Messages } from '../../lib/messages';

type Text = Messages['wizard']['documents']['labels'];

const CHOICES: LabelChoice[] = ['a4-3x8', 'a4-2x7', 'custom'];
const GRID_FIELDS: { key: keyof LabelGrid; int: boolean; unit?: string }[] = [
  { key: 'cols', int: true },
  { key: 'rows', int: true },
  { key: 'width', int: false, unit: 'mm' },
  { key: 'height', int: false, unit: 'mm' },
  { key: 'left', int: false, unit: 'mm' },
  { key: 'top', int: false, unit: 'mm' },
  { key: 'gapX', int: false, unit: 'mm' },
  { key: 'gapY', int: false, unit: 'mm' },
];

/** URL of the label sheet PDF of a saved revision (T174). */
export function labelsPdfUrl(projectId: string, revision: number, s: LabelSettings): string {
  return `/api/projects/${encodeURIComponent(projectId)}/labels?${labelQuery(revision, s)}`;
}

/**
 * Label sheet settings of the export step (T174, spec §2.4): preset or custom mm grid, print offset
 * calibration (remembered in this browser, it belongs to the printer here), and the link to the
 * label PDF the server generates from the saved revision.
 */
export function ExportLabels({
  t,
  projectId,
  revision,
  pieces,
  ready,
  onDownload,
  busy = false,
}: {
  t: Text;
  projectId: string | null;
  revision: number;
  /** Total pieces = labels. */
  pieces: number;
  ready: boolean;
  /** T176: stores the label sheet as an export record and downloads it (query of the settings). */
  onDownload?: (labels: string) => void;
  busy?: boolean;
}) {
  // The export step renders on the client only (after the project loaded), so storage is readable.
  const [settings, setSettings] = useState<LabelSettings>(loadLabelSettings);
  const update = (next: LabelSettings) => {
    setSettings(next);
    saveLabelSettings(next);
  };
  const valid =
    (settings.preset !== 'custom' || labelGridSchema.safeParse(settings.custom).success) &&
    labelOffsetSchema.safeParse(settings.offset).success &&
    validStart(settings.start, gridOf(settings));
  const grid = gridOf(settings);
  const perPage = grid.cols * grid.rows;
  const pages = Math.max(1, Math.ceil((pieces + Math.max(0, settings.start - 1)) / perPage));
  const link = buttonVariants({ variant: 'outline', size: 'sm' });

  const setGrid = (key: keyof LabelGrid, v: number | null) =>
    update({ ...settings, custom: { ...settings.custom, [key]: v ?? Number.NaN } });
  const setOffset = (key: 'x' | 'y', v: number | null) =>
    update({ ...settings, offset: { ...settings.offset, [key]: v ?? 0 } });

  return (
    <div
      className="flex flex-col gap-3 border-t border-border-subtle pt-3"
      data-testid="export-labels"
    >
      <h3 className="text-sm font-semibold text-fg">{t.title}</h3>
      <FormField label={t.preset}>
        <Select
          value={settings.preset}
          onValueChange={(v) => update({ ...settings, preset: v as LabelChoice })}
        >
          <SelectTrigger size="sm" data-testid="labels-preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHOICES.map((c) => (
              <SelectItem key={c} value={c}>
                {t.presets[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {settings.preset === 'custom' ? (
        <div className="grid grid-cols-2 gap-2" data-testid="labels-custom">
          {GRID_FIELDS.map((f) => (
            <FormField key={f.key} label={t[f.key]}>
              <NumberInput
                inputSize="sm"
                value={Number.isFinite(settings.custom[f.key]) ? settings.custom[f.key] : null}
                onValueChange={(v) => setGrid(f.key, v)}
                min={0}
                maxDecimals={f.int ? 0 : 2}
                {...(f.unit ? { unit: f.unit } : {})}
                data-testid={`labels-${f.key}`}
              />
            </FormField>
          ))}
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-fg">{t.offsetTitle}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['x', 'y'] as const).map((k) => (
            <FormField key={k} label={k === 'x' ? t.offsetX : t.offsetY}>
              <NumberInput
                inputSize="sm"
                value={settings.offset[k]}
                onValueChange={(v) => setOffset(k, v)}
                min={-20}
                max={20}
                step={0.5}
                maxDecimals={1}
                unit="mm"
                data-testid={`labels-offset-${k}`}
              />
            </FormField>
          ))}
        </div>
        <p className="text-xs text-fg-muted">{t.offsetHint}</p>
      </fieldset>
      {/* B51: a half-used label sheet starts at its first free label. */}
      <FormField label={t.start} hint={fill(t.startHint, { max: perPage })}>
        <NumberInput
          inputSize="sm"
          value={Number.isFinite(settings.start) ? settings.start : null}
          onValueChange={(v) => update({ ...settings, start: v ?? Number.NaN })}
          min={1}
          maxDecimals={0}
          data-testid="labels-start"
        />
      </FormField>
      {!valid ? (
        <p
          className="text-xs font-medium text-danger-text"
          role="alert"
          data-testid="labels-invalid"
        >
          {t.invalid}
        </p>
      ) : null}
      {ready && valid && projectId !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            className={link}
            href={labelsPdfUrl(projectId, revision, settings)}
            target="_blank"
            rel="noopener"
            data-testid="export-labels-open"
          >
            <Tags aria-hidden />
            {t.open}
          </a>
          {onDownload ? (
            <Button
              variant="outline"
              size="sm"
              loading={busy}
              data-testid="export-labels-download"
              // D-040: the footer has the one primary "İndir"; this one is named for its document.
              aria-label={`${t.download}: ${t.title}`}
              onClick={() => onDownload(labelQuery(revision, settings))}
            >
              <Download aria-hidden />
              {t.download}
            </Button>
          ) : null}
          <span className="text-xs text-fg-muted" data-testid="labels-count">
            {fill(t.count, { count: pieces, pages })}
          </span>
        </div>
      ) : null}
    </div>
  );
}
