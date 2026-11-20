/** Test fixture of the PDF tests (T172–T174): a nested project without a database. */
import { applyCommand, type Project } from '@nittcam/core';

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
