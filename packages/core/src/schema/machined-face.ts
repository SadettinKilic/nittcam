/**
 * Machined face (T348, spec §3.6 "İşlenen yüz"). A composite panel is machined from its back: the
 * sheet lies face down, so every part is cut as its mirror image. The mirror happens once, in the
 * layout stage (`toCutSizes` calls `machinedProject`), so nesting, toolpath, G-code, simulation,
 * DXF and PDF all read the same mirrored parts; the drawing board keeps the front view.
 *
 * Each part is mirrored left ↔ right inside its own bounding box (x → minX + maxX − x), so its
 * footprint is unchanged: outline, cut-outs, holes, open lines and dimensions flip, edge bands swap
 * left ↔ right, and the grain line reflects. The sheet grain reflects as well (the sheet is turned
 * over). On a directed material (ACM film arrow, T347) the arrows reflect as directions, which can
 * flip a part's arrow (`grain.flip`). Template refs stay as front-view metadata; the holes,
 * contours and lines they derived are mirrored with the part. Stored layout placements are in
 * this machined frame (`setMachinedFace` turns them over with the sheet).
 */
import { normalizeGrain, normalizeRotation } from '../geometry/grain';
import { bbox, contour, normalize } from '../geometry/polyline';
import { mirror, rotate, translate } from '../geometry/transform';
import { materialKindOf } from '../machine/material';
import { traitsOf } from '../machine/material-traits';
import { deriveOutline } from './outline';
import { defaultSheet } from './sheet-size';
import type { Layout, Part, Project, Vertex } from './project';

/** True when the stock is machined from its back face (absent = front). */
export function isBackFace(project: Pick<Project, 'stock'>): boolean {
  // Partial projects (tests, older callers) may lack the stock: absent = front.
  const stock = project.stock as Project['stock'] | undefined;
  return stock?.machinedFace === 'back';
}

/** Width of a part's local bounding box after turning it by `rot` (the placed footprint width). */
function turnedWidth(part: Part, rot: number): number {
  const local = normalize(contour(deriveOutline(part)), 'outer');
  // The same turn as placedOutline (exact quarter turns).
  const turned = rotate(local, rot);
  const box = bbox(turned);
  return box.maxX - box.minX;
}

/** Direction of a grain (degrees, [0, 360)) after reflecting x → −x and taking `offset` off. */
function reflectedDirection(dir: number, offset: number): number {
  return normalizeRotation(180 - dir - offset);
}

const mapVs = (vs: readonly Vertex[], sx: number): Vertex[] =>
  vs.map((v) => ({ x: sx - v.x, y: v.y, bulge: -v.bulge }));

/**
 * One part mirrored left ↔ right in its own frame. `directed`: the stock is a directed material;
 * `offset`: 180 when the reflected sheet arrow could not be stored as is (see `machinedProject`).
 */
export function mirrorPartForBack(part: Part, directed = false, offset = 0): Part {
  const box = bbox(contour(deriveOutline(part)));
  const sx = box.minX + box.maxX;
  const flipContour = (vs: readonly Vertex[], role: 'outer' | 'inner'): Vertex[] =>
    normalize(translate(mirror(contour(vs.map((v) => ({ ...v }))), 'x'), sx, 0), role).vertices;
  const band = part.edgeBand;
  let grain: Part['grain'];
  if (directed) {
    const dir = reflectedDirection(part.grain.angle + (part.grain.flip === true ? 180 : 0), offset);
    const flip = dir >= 180;
    grain = { ...part.grain, angle: normalizeGrain(dir) };
    if (flip) grain.flip = true;
    else if (grain.flip !== undefined) delete grain.flip;
  } else {
    grain = { ...part.grain, angle: normalizeGrain(-part.grain.angle) };
  }
  const common = {
    holes: part.holes.map((h) => ({ ...h, cx: sx - h.cx })),
    inners: part.inners.map((c) => flipContour(c, 'inner')),
    // Open lines keep their direction (no re-normalising), like the board's mirror (T125).
    ...(part.lines
      ? { lines: part.lines.map((l) => ({ ...l, vertices: mapVs(l.vertices, sx) })) }
      : {}),
    ...(part.dims
      ? {
          dims: part.dims.map((d) => ({
            ...d,
            a: { x: sx - d.a.x, y: d.a.y },
            b: { x: sx - d.b.x, y: d.b.y },
          })),
        }
      : {}),
    edgeBand: { ...band, left: band.right, right: band.left },
    grain,
  };
  if (part.kind === 'rect') {
    // A rectangle is its own mirror; the cached outline is dropped (deriveOutline is the source).
    const rest = { ...part };
    delete rest.outline;
    return { ...rest, ...common };
  }
  return { ...part, ...common, outline: flipContour(part.outline, 'outer') };
}

type FaceSource = Pick<Project, 'stock' | 'parts'>;
const machined = new WeakMap<FaceSource, FaceSource>();
const mirroredProjects = new WeakSet<FaceSource>();

/**
 * The project as the machine sees it (T348): with `stock.machinedFace === 'back'` every part
 * mirrored left ↔ right in its own frame and the sheet grain reflected; otherwise the same object.
 * Idempotent (a mirrored project is returned as is) and memoised per project object.
 */
export function machinedProject<P extends FaceSource>(project: P): P {
  if (!isBackFace(project) || mirroredProjects.has(project)) return project;
  const hit = machined.get(project);
  if (hit) return hit as P;
  const directed = traitsOf(materialKindOf(project.stock.material)).direction.kind === 'directed';
  const sheet = defaultSheet(project);
  const g = sheet.grain;
  let sheetGrain = g;
  let offset = 0;
  if (g !== null) {
    if (directed) {
      // The reflected sheet arrow 180 − g is stored in [0, 180); for g = 0 that is 180, kept as 0
      // with every part arrow turned by 180 too, so the relation part + rot ≡ sheet holds.
      const dir = reflectedDirection(g, 0);
      sheetGrain = normalizeGrain(dir);
      offset = dir - sheetGrain;
    } else {
      sheetGrain = normalizeGrain(-g);
    }
  }
  const out: P = {
    ...project,
    stock: { ...project.stock, sheet: { ...sheet, grain: sheetGrain } },
    parts: project.parts.map((p) => mirrorPartForBack(p, directed, offset)),
  };
  mirroredProjects.add(out);
  machined.set(project, out);
  return out;
}

/**
 * The layout turned over with the sheet (T348): each placement mirrored about the sheet's
 * vertical centre line, x → width − x − footprint width, rot → −rot. A layout made for the front
 * parts stays valid (same gaps, margins, grain relation) for the mirrored parts and back.
 * `parts` are the cut-size parts in either face (a mirror keeps every footprint width).
 */
export function turnLayoutOver(
  layout: Layout,
  parts: readonly Part[],
  sheetWidth: (sheetIndex: number) => number,
): Layout {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return {
    sheets: layout.sheets.map((sheet, i) => ({
      ...sheet,
      placements: sheet.placements.map((pl) => {
        const part = byId.get(pl.partId);
        if (!part) return pl;
        const w = turnedWidth(part, pl.rot);
        return {
          ...pl,
          x: Math.round((sheetWidth(i) - pl.x - w) * 1e6) / 1e6,
          rot: normalizeRotation(-pl.rot),
        };
      }),
    })),
  };
}

/**
 * The face to name on the PDF and labels (T348): `back` on a back-face stock, `front` on a
 * material machined from the back by default but set to front, null otherwise (wood, plastic:
 * nothing to say, documents unchanged).
 */
export function faceUpOf(project: Pick<Project, 'stock'>): 'front' | 'back' | null {
  if (isBackFace(project)) return 'back';
  return traitsOf(materialKindOf(project.stock.material)).machinedFace === 'back' ? 'front' : null;
}
