/** Test fixture of the PDF tests (T172–T174): a nested project without a database. */
import { applyCommand, parseProject, type Project } from '@nittcam/core';

export function pdfTestProject(names: [string, string] = ['Kapak ğüşıöç İ', 'Raf']): Project {
  let p = {
    schemaVersion: 2,
    machine: { machineId: 'm1', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 1220, height: 1000, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as Project;
  const run = (name: string, params: unknown) => {
    const r = applyCommand(p, name, params);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    p = r.project;
  };
  run('addPart', {
    id: 'kapak',
    name: names[0],
    qty: 3,
    params: { w: 400, h: 600, r: 0 },
    grain: { mode: 'fixed', angle: 90 },
  });
  run('addPart', { id: 'raf', name: names[1], qty: 4, params: { w: 500, h: 300, r: 0 } });
  run('runNesting', { toolDiameter: 8 });
  return p;
}

/**
 * T355: an ACM 4 mm tray (the golden tray of T353: four V-grooves, machined from the back) with a
 * film arrow, nested; `grooves: false` gives the same part without the grooves.
 */
export function acmTrayPdfProject(grooves = true): Project {
  const v = (x: number, y: number) => ({ x, y, bulge: 0 });
  const fold = (a: [number, number], b: [number, number]) => ({
    vertices: [v(...a), v(...b)],
    op: { kind: 'vgroove' as const },
  });
  const parsed = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'm1', profileVersion: 1 },
    stock: {
      material: 'acm',
      thickness: 4,
      sheet: { width: 500, height: 400, grain: 0 },
      useOffcuts: false,
      machinedFace: 'back',
    },
    parts: [
      {
        id: 'tray',
        name: 'Tepsi',
        qty: 2,
        grain: { mode: 'fixed', angle: 0 },
        kind: 'freeform',
        outline: [
          v(25, 0),
          v(225, 0),
          v(225, 25),
          v(250, 25),
          v(250, 225),
          v(225, 225),
          v(225, 250),
          v(25, 250),
          v(25, 225),
          v(0, 225),
          v(0, 25),
          v(25, 25),
        ],
        inners: [],
        holes: [],
        lines: grooves
          ? [
              fold([25, 25], [225, 25]),
              fold([225, 25], [225, 225]),
              fold([225, 225], [25, 225]),
              fold([25, 225], [25, 25]),
            ]
          : [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 10, margin: 12 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'conventional' },
    settings: { dimensionMode: 'cut' },
  });
  if (!parsed.ok) throw new Error(`tray fixture invalid: ${JSON.stringify(parsed.issues)}`);
  const r = applyCommand(parsed.project, 'runNesting', { toolDiameter: 6 });
  if (!r.ok) throw new Error(`runNesting: ${r.error.message}`);
  return r.project;
}
