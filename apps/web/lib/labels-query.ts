/**
 * Label sheet settings (T174) and their URL form, shared by the export step (builds the link) and
 * the labels route (reads it). The settings live in the browser (the print offset belongs to the
 * printer next to this computer); the server only trusts what it validates here.
 */
import {
  LABEL_PRESETS,
  labelGridSchema,
  labelOffsetSchema,
  type LabelGrid,
  type LabelOffset,
  type LabelPreset,
} from '@nittcam/core';

export type LabelChoice = LabelPreset | 'custom';

export interface LabelSettings {
  preset: LabelChoice;
  /** Used when `preset` is `custom`. */
  custom: LabelGrid;
  offset: LabelOffset;
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  preset: 'a4-3x8',
  custom: { ...LABEL_PRESETS['a4-3x8'] },
  offset: { x: 0, y: 0 },
};

const GRID_KEYS = ['cols', 'rows', 'width', 'height', 'left', 'top', 'gapX', 'gapY'] as const;

/** The grid a setting stands for. */
export function gridOf(s: LabelSettings): LabelGrid {
  return s.preset === 'custom' ? s.custom : LABEL_PRESETS[s.preset];
}

/** Query string (without `?`) of the settings; `revision` first. */
export function labelQuery(revision: number, s: LabelSettings): string {
  const q = new URLSearchParams({ revision: String(revision), preset: s.preset });
  if (s.preset === 'custom') for (const k of GRID_KEYS) q.set(k, String(s.custom[k]));
  if (s.offset.x !== 0) q.set('dx', String(s.offset.x));
  if (s.offset.y !== 0) q.set('dy', String(s.offset.y));
  return q.toString();
}

const num = (v: string | null): number => (v === null || v.trim() === '' ? NaN : Number(v));

/** Reads and validates a label query; null when anything is missing or out of range. */
export function parseLabelQuery(
  q: URLSearchParams,
): { grid: LabelGrid; offset: LabelOffset } | null {
  const preset = q.get('preset') ?? 'a4-3x8';
  let grid: LabelGrid;
  if (preset === 'custom') {
    const raw = Object.fromEntries(GRID_KEYS.map((k) => [k, num(q.get(k))]));
    const parsed = labelGridSchema.safeParse(raw);
    if (!parsed.success) return null;
    grid = parsed.data;
  } else if (Object.hasOwn(LABEL_PRESETS, preset)) {
    grid = LABEL_PRESETS[preset as LabelPreset];
  } else {
    return null;
  }
  const offset = labelOffsetSchema.safeParse({
    x: q.has('dx') ? num(q.get('dx')) : 0,
    y: q.has('dy') ? num(q.get('dy')) : 0,
  });
  return offset.success ? { grid, offset: offset.data } : null;
}

/** Settings from storage (any shape) or the defaults; invalid parts fall back one by one. */
export function readLabelSettings(raw: unknown): LabelSettings {
  const d = DEFAULT_LABEL_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Partial<Record<keyof LabelSettings, unknown>>;
  const preset =
    r.preset === 'custom' ||
    (typeof r.preset === 'string' && Object.hasOwn(LABEL_PRESETS, r.preset))
      ? (r.preset as LabelChoice)
      : d.preset;
  const custom = labelGridSchema.safeParse(r.custom);
  const offset = labelOffsetSchema.safeParse(r.offset);
  return {
    preset,
    custom: custom.success ? custom.data : d.custom,
    offset: offset.success ? offset.data : d.offset,
  };
}

export const LABEL_STORAGE_KEY = 'nittcam-label-settings';

/** The settings remembered in this browser (defaults when missing, invalid or blocked). */
export function loadLabelSettings(): LabelSettings {
  try {
    if (typeof window === 'undefined') return DEFAULT_LABEL_SETTINGS;
    const raw = window.localStorage.getItem(LABEL_STORAGE_KEY);
    return readLabelSettings(raw ? (JSON.parse(raw) as unknown) : null);
  } catch {
    return DEFAULT_LABEL_SETTINGS;
  }
}

export function saveLabelSettings(s: LabelSettings): void {
  try {
    window.localStorage.setItem(LABEL_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: the next visit starts from the defaults.
  }
}
