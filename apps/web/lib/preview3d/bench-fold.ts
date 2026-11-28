/**
 * T391: the "Katla" state of the montaj tezgâhı applied to the bench items. Foldable parts (ACM
 * stock, at least one straight V-groove) get their folded mesh and box; every copy of a part folds
 * the same. The item pose is untouched (the fold is view state, never stored).
 */
import type { Project } from '@nittcam/core';
import {
  bendOf,
  foldCheck,
  foldedMesh,
  foldPlan,
  foldTransforms,
  pieceAsPart,
  type Bend,
  type FoldCheck,
  type FoldPlan,
  type FoldTool,
} from './acm-fold';
import { localBoxOf, type BenchItem } from './assembly-model';
import type { LocalBox } from './assembly-math';
import type { MeshData } from './part-mesh';
import type { FitHole } from './fit-check';
import type { VGrooveInfo } from '../vgroove-info';

export const DEFAULT_FOLD_DEG = 90;

/** View state: one slider for all (0 … 100 % of each target), per-groove angle and target. */
export interface FoldState {
  pct: number;
  /** `partId:hingeKey` → fold angle, degrees (set by a per-groove slider; wins over `pct`). */
  deg: Readonly<Record<string, number>>;
  /** `partId:hingeKey` → designed angle, degrees (default 90°). */
  target: Readonly<Record<string, number>>;
}

export const NO_FOLD: FoldState = { pct: 0, deg: {}, target: {} };

export interface FoldPart {
  partId: string;
  name: string;
  plan: FoldPlan;
  thickness: number;
  /** Per hinge: current angle, designed angle, bend at the designed angle. */
  angles: number[];
  targets: number[];
  bends: Bend[];
  /**
   * T427 (CTO #15 S5): the verdict, always at the designed angles (the sliders only move the
   * picture), so a flat part never reads "Kapanıyor" when it would clash once folded.
   */
  check: FoldCheck;
  /** True when the pieces clash in the pose shown now (the bench tints those parts red). */
  clashNow: boolean;
}

/** The fold tool of the project: the V-bit's angle and tip (90°, sharp when none). */
export function foldToolOf(
  project: { stock: Pick<Project['stock'], 'machinedFace'> },
  info: Pick<VGrooveInfo, 'traits' | 'tool'>,
): FoldTool {
  return {
    angleDeg: info.tool?.angleDeg ?? 90,
    tipDiameter: info.tool?.tipDiameter ?? 0,
    traits: info.traits,
    face: project.stock.machinedFace === 'back' ? 'back' : 'front',
  };
}

const plans = new WeakMap<object, FoldPlan>();
function planOf(item: BenchItem, tool: FoldTool): FoldPlan {
  const hit = plans.get(item.part);
  if (hit) return hit;
  const p = foldPlan(item.part, tool.traits);
  plans.set(item.part, p);
  return p;
}

export const foldKey = (partId: string, hinge: string) => `${partId}:${hinge}`;

type Folded = { mesh: MeshData; box: LocalBox; holes: FitHole[]; key: string };
const meshes = new Map<string, Folded>();
const MESH_CACHE = 64;

/**
 * The items with every foldable part folded, and the fold facts per part (also when flat, so the
 * panel can list them). Without V-groove traits (not ACM) the items come back unchanged.
 */
export function applyFold(
  items: readonly BenchItem[],
  tool: FoldTool | null,
  state: FoldState,
): { items: BenchItem[]; parts: FoldPart[] } {
  if (!tool?.traits) return { items: [...items], parts: [] };
  const parts = new Map<string, FoldPart>();
  const folded = new Map<string, Folded | null>();
  const out = items.map((it) => {
    let f = folded.get(it.partId);
    if (f === undefined) {
      f = null;
      const plan = planOf(it, tool);
      // A part whose grooves all fail to fold is still listed (the panel shows why).
      if (plan.hinges.length > 0 || plan.skipped > 0) {
        const targets = plan.hinges.map(
          (h) => state.target[foldKey(it.partId, h.key)] ?? DEFAULT_FOLD_DEG,
        );
        const angles = plan.hinges.map(
          (h, i) =>
            state.deg[foldKey(it.partId, h.key)] ??
            Math.round(((targets[i] ?? DEFAULT_FOLD_DEG) * state.pct) / 100),
        );
        const rigid = foldTransforms(plan, it.thickness, tool, angles, targets);
        const atTarget = angles.every((a, i) => a === targets[i])
          ? rigid
          : foldTransforms(plan, it.thickness, tool, targets, targets);
        const check = foldCheck(plan, it.thickness, atTarget);
        parts.set(it.partId, {
          partId: it.partId,
          name: it.part.name,
          plan,
          thickness: it.thickness,
          angles,
          targets,
          bends: plan.hinges.map((h, i) =>
            bendOf(Math.min(h.remaining, it.thickness), tool, targets[i] ?? DEFAULT_FOLD_DEG),
          ),
          check,
          clashNow:
            rigid === atTarget
              ? check.state === 'clash'
              : foldCheck(plan, it.thickness, rigid).state === 'clash',
        });
        if (angles.some((a) => a !== 0)) {
          const key = `fold:${it.partId}:${it.thickness}:${tool.face}:${tool.angleDeg}:${tool.tipDiameter}:${angles.join(',')}:${targets.join(',')}`;
          const hit = meshes.get(key);
          if (hit) f = hit;
          else {
            const base = plan.pieces.find((p) => p.hinge === -1);
            const mesh = foldedMesh(it.part, plan, it.thickness, rigid);
            f = {
              key,
              mesh,
              box: localBoxOf(mesh),
              holes: base
                ? pieceAsPart(it.part, base.ring).holes.map((h) => ({
                    cx: h.cx,
                    cy: h.cy,
                    d: h.d,
                    through: h.type === 'through',
                  }))
                : [],
            };
            meshes.set(key, f);
            if (meshes.size > MESH_CACHE) meshes.delete(meshes.keys().next().value as string);
          }
        }
      }
      folded.set(it.partId, f);
    }
    if (!f) return it;
    return { ...it, mesh: f.mesh, box: f.box, fold: { key: f.key, holes: f.holes } };
  });
  return { items: out, parts: [...parts.values()] };
}
