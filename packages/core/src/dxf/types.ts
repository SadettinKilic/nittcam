/**
 * DXF import types (T144, spec §4.6). All lengths are millimetres after conversion.
 */
import type { BBox, Polyline } from '../geometry/types';

/** Length units the import understands (and the user can choose when asked). */
export type DxfUnit = 'mm' | 'cm' | 'dm' | 'm' | 'in' | 'ft' | 'yd' | 'mil' | 'um';

/** Units a user may pick in the unit question (the common ones). */
export const DXF_USER_UNITS: readonly DxfUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

/** Millimetres per drawing unit. */
export const DXF_UNIT_MM: Readonly<Record<DxfUnit, number>> = {
  mm: 1,
  cm: 10,
  dm: 100,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  yd: 914.4,
  mil: 0.0254,
  um: 0.001,
};

/** Why the unit is uncertain (spec §4.6 "yoksa veya şüpheliyse sorulur"). */
export type DxfUnitReason =
  /** No `$INSUNITS` in the header. */
  | 'missing'
  /** `$INSUNITS` = 0 (unitless). */
  | 'unitless'
  /** A unit code NittCam does not know (miles, light years, ...). */
  | 'unknown'
  /** The unit is known but the drawing comes out implausibly small or large. */
  | 'size';

export interface DxfUnits {
  /** `$INSUNITS` from the header; undefined when absent. */
  insunits: number | undefined;
  /** The unit used for this conversion. */
  unit: DxfUnit;
  /** Millimetres per drawing unit (DXF_UNIT_MM[unit]). */
  scale: number;
  /** Set when the user must confirm the unit (`UNIT_UNCERTAIN`). */
  uncertain?: { code: 'UNIT_UNCERTAIN'; reason: DxfUnitReason; suggested?: DxfUnit };
}

/** Why an entity of a supported kind was still left out. */
export type DxfSkipReason =
  /** An INSERT inside a block (only one level is supported, spec §4.6). */
  | 'NESTED_INSERT'
  /** An INSERT whose block is missing from the file. */
  | 'MISSING_BLOCK'
  /** Zero-length line, zero-radius arc or a polyline with fewer than 2 distinct points. */
  | 'DEGENERATE'
  /** Drawn in a tilted plane (extrusion not ±Z), a 3D polyline that is not flat, or a mesh. */
  | 'NOT_FLAT'
  /** Entity on a paper-space layout (not the model). */
  | 'PAPER_SPACE'
  /** SPLINE with broken data (no usable control or fit points). */
  | 'BAD_CURVE';

/** Counts for the import report (spec §4.6: supported / converted / ignored are reported). */
export interface DxfReport {
  /** Entities read exactly, by DXF type (LINE, ARC, ...). Block contents count once per insert. */
  supported: Record<string, number>;
  /** SPLINE / ELLIPSE approximated within CURVE_TOL, by DXF type. */
  converted: Record<string, number>;
  /** Fit-point splines (no control points): approximated through their fit points. */
  fitPointSplines: number;
  /** Entities NittCam does not cut (TEXT, MTEXT, DIMENSION, HATCH, ...), by DXF type. */
  ignored: Record<string, number>;
  /** Supported kinds left out anyway, by reason. */
  skipped: Partial<Record<DxfSkipReason, number>>;
  /** INSERT entities expanded (one level). */
  inserts: number;
}

/** One converted entity: a bulge polyline in millimetres, open or closed. */
export interface DxfPath {
  /** DXF layer name as written in the file ("0" inside a block takes the INSERT's layer). */
  layer: string;
  /** Source DXF type (LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, SPLINE, ELLIPSE). */
  type: string;
  poly: Polyline;
  /** Set for a full circle (CIRCLE, or a circular ELLIPSE): centre and diameter in mm. */
  circle?: { cx: number; cy: number; d: number };
}

/** A converted drawing. */
export interface DxfDrawing {
  units: DxfUnits;
  paths: DxfPath[];
  report: DxfReport;
  /** Layer names that carry at least one path, sorted. */
  layers: string[];
  /** Extent of all paths (mm); undefined when there is none. */
  bbox: BBox | undefined;
}

/** Why a file cannot be read at all. */
export type DxfFileError =
  /** A DWG file (spec §4.6: "DXF olarak kaydedin"). */
  | 'DWG'
  /** A binary DXF (only ASCII DXF is read). */
  | 'BINARY_DXF'
  /** Not a readable DXF. */
  | 'PARSE_FAILED'
  /** A DXF without any cuttable geometry. */
  | 'EMPTY';
