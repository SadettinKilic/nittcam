/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Sheet frame → machine frame (T017, D-025): all 4 origin corners × both Z-zero references ×
 * both axis signs, against an independent physical-table model, plus the D-025 worked examples
 * and whole programs on mirrored frames.
 */
import { describe, expect, it } from 'vitest';
import type { OriginCorner } from '../machine';
import { machineArcDirection, machineFrame, toMachine, envelopeViolation } from './frame';
import { profileFor, readMoves, run, sampleToolpath, SHEET } from './post.testing';

const CORNERS: OriginCorner[] = ['frontLeft', 'frontRight', 'backLeft', 'backRight'];
const TABLE = { width: 3000, depth: 2000 };
const STOCK = { thickness: 18, sheetWidth: 1000, sheetHeight: 500 };
const OFFSET = { x: 10, y: 20 };

/**
 * Independent model: physical table coordinates (u right, v back) from the front-left table
 * corner; program zero at the chosen corner; the sheet's nearest corner OFFSET from it, inward.
 */
function expected(
  corner: OriginCorner,
  xPositive: 'right' | 'left',
  yPositive: 'back' | 'front',
  zRef: 'table' | 'materialTop',
  p: { x: number; y: number; z: number },
) {
  const left = corner.endsWith('Left');
  const front = corner.startsWith('front');
  const zero = { u: left ? 0 : TABLE.width, v: front ? 0 : TABLE.depth };
  const sheetU = left ? zero.u + OFFSET.x : zero.u - OFFSET.x - STOCK.sheetWidth;
  const sheetV = front ? zero.v + OFFSET.y : zero.v - OFFSET.y - STOCK.sheetHeight;
  const u = sheetU + p.x;
  const v = sheetV + p.y;
  return {
    x: (u - zero.u) * (xPositive === 'right' ? 1 : -1),
    y: (v - zero.v) * (yPositive === 'back' ? 1 : -1),
    z: zRef === 'table' ? p.z + STOCK.thickness : p.z,
  };
}

function profileWith(
  corner: OriginCorner,
  xPositive: 'right' | 'left',
  yPositive: 'back' | 'front',
  reference: 'table' | 'materialTop',
) {
  const p = profileFor();
  p.origin = { corner, xPositive, yPositive, sheetOffset: { ...OFFSET } };
  p.zZero = { reference, spoilboardAllowance: 0.5 };
  return p;
}

const POINTS = [
  { x: 0, y: 0, z: 0 },
  { x: 1000, y: 500, z: -18.5 },
  { x: 123.456, y: 78.9, z: 20 },
  { x: -4, y: 503, z: 2 },
];

describe('frame conversion', () => {
  for (const corner of CORNERS) {
    for (const reference of ['table', 'materialTop'] as const) {
      for (const xPositive of ['right', 'left'] as const) {
        for (const yPositive of ['back', 'front'] as const) {
          it(`${corner}, Z zero ${reference}, X+ ${xPositive}, Y+ ${yPositive}`, () => {
            const f = machineFrame(profileWith(corner, xPositive, yPositive, reference), STOCK);
            for (const p of POINTS) {
              const m = toMachine(f, p);
              const e = expected(corner, xPositive, yPositive, reference, p);
              expect(m.x).toBeCloseTo(e.x, 9);
              expect(m.y).toBeCloseTo(e.y, 9);
              expect(m.z).toBeCloseTo(e.z, 9);
            }
            expect(f.mirrored).toBe((xPositive === 'right') !== (yPositive === 'back'));
          });
        }
      }
    }
  }

  it('D-025 worked examples', () => {
    // Front-left, natural axes, Z0 material top: sheet (0, 0, 0) → (10, 20, 0).
    let f = machineFrame(profileWith('frontLeft', 'right', 'back', 'materialTop'), STOCK);
    expect(toMachine(f, { x: 0, y: 0, z: 0 })).toEqual({ x: 10, y: 20, z: 0 });
    // Same with Z0 = table: the final pass at −18.5 is −0.5 (into the spoilboard), safe Z 20 → 38.
    f = machineFrame(profileWith('frontLeft', 'right', 'back', 'table'), STOCK);
    expect(toMachine(f, { x: 100, y: 50, z: -18.5 }).z).toBeCloseTo(-0.5, 12);
    expect(toMachine(f, { x: 100, y: 50, z: 20 }).z).toBe(38);
    // Back-right, X+ left, Y+ front (zero at the back-right corner, axes into the table):
    // sheet (0, 0) = its front-left corner = 1010 left and 520 in front of zero.
    f = machineFrame(profileWith('backRight', 'left', 'front', 'materialTop'), STOCK);
    expect(toMachine(f, { x: 0, y: 0, z: 0 })).toEqual({ x: 1010, y: 520, z: 0 });
    expect(toMachine(f, { x: 1000, y: 500, z: 0 })).toEqual({ x: 10, y: 20, z: 0 });
    // Front-right, X+ left, Y+ back: one axis mirrored → arcs swap direction.
    f = machineFrame(profileWith('frontRight', 'left', 'back', 'materialTop'), STOCK);
    expect(toMachine(f, { x: 0, y: 0, z: 0 })).toEqual({ x: 1010, y: 20, z: 0 });
    expect(f.mirrored).toBe(true);
    expect(machineArcDirection(f, 'cw')).toBe('ccw');
  });

  it('envelope is measured into the table from program zero, for every corner', () => {
    for (const corner of CORNERS) {
      const p = profileWith(corner, 'right', 'back', 'materialTop');
      p.workEnvelope = { x: 1010, y: 520, z: 100 };
      const f = machineFrame(p, STOCK);
      expect(envelopeViolation(f, { x: 0, y: 0, z: 0 })).toBeNull();
      expect(envelopeViolation(f, { x: 1000, y: 500, z: 0 })).toBeNull();
      const out = corner.endsWith('Left') ? { x: 1000.1, y: 0, z: 0 } : { x: -0.1, y: 0, z: 0 };
      expect(envelopeViolation(f, out)).toMatch(/X travel/);
      expect(envelopeViolation(f, { x: 0, y: 0, z: -19 })).toMatch(/below the table/);
      expect(envelopeViolation(f, { x: 0, y: 0, z: 83 })).toMatch(/above the table/);
    }
  });
});

describe('frame conversion in whole programs', () => {
  const tableProfile = () => {
    const p = profileFor();
    p.zZero.reference = 'table';
    return p;
  };

  it('Z zero = table: every Z is the sheet Z + thickness', () => {
    const top = readMoves(run().files[0]!.content);
    const p = tableProfile();
    const table = readMoves(run({ profile: p, toolpath: sampleToolpath(p) }).files[0]!.content);
    expect(table.length).toBe(top.length);
    top.forEach((m, k) => {
      if (!Number.isNaN(m.to.z)) expect(table[k]!.to.z).toBeCloseTo(m.to.z + 18, 9);
    });
  });

  it('front-right with X+ left: positions mirror and arc directions swap', () => {
    const p = profileFor();
    p.workEnvelope = { x: 2500, y: 1300, z: 150 };
    p.origin = {
      corner: 'frontRight',
      xPositive: 'left',
      yPositive: 'back',
      sheetOffset: { x: 0, y: 0 },
    };
    const r = run({ profile: p });
    expect(r.ok).toBe(true);
    const base = readMoves(run().files[0]!.content);
    const mir = readMoves(r.files[0]!.content);
    base.forEach((m, k) => {
      const n = mir[k]!;
      if (!Number.isNaN(m.to.x)) expect(n.to.x).toBeCloseTo(SHEET.width - m.to.x, 9);
      if (!Number.isNaN(m.to.y)) expect(n.to.y).toBeCloseTo(m.to.y, 9);
      if (m.kind === 'cw') expect(n.kind).toBe('ccw');
      if (m.kind === 'ccw') expect(n.kind).toBe('cw');
      if (m.i !== undefined) expect(n.i).toBeCloseTo(-m.i, 9);
    });
  });
});
