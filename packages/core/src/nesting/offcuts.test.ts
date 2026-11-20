/** T168: offcut proposals, offcut-first nesting, AI cannot pass offcuts. */
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandStack, commandToolDefinitions } from '../commands';
import type { Project } from '../schema';
import { projectOf } from '../toolpath/toolpath.testing';
import { nestProject } from './nest';
import { proposeOffcuts, usableOffcuts, usedOffcutIds, type OffcutRow } from './offcuts';

const ctx = { actor: 'user' as const, at: '2026-11-20T10:00:00Z' };

function base(useOffcuts = true, grain: number | null = 0): Project {
  const p = projectOf({
    parts: [
      { id: 'a', w: 500, h: 400, qty: 2 },
      { id: 'b', w: 300, h: 300 },
    ],
    gap: 4,
    margin: 10,
  });
  return { ...p, stock: { ...p.stock, useOffcuts, sheet: { ...p.stock.sheet, grain } } };
}

const row = (o: Partial<OffcutRow> & { id: string }): OffcutRow => ({
  material: 'mdf',
  thickness: 18,
  width: 1200,
  height: 900,
  grain: 0,
  status: 'available',
  ...o,
});

describe('usableOffcuts', () => {
  it('keeps available rows of the same material and thickness, smallest first', () => {
    const rows = [
      row({ id: 'big', width: 1500, height: 1000 }),
      row({ id: 'small', width: 800, height: 700 }),
      row({ id: 'used', status: 'used' }),
      row({ id: 'oak', material: 'oak' }),
      row({ id: 'thin', thickness: 8 }),
    ];
    expect(usableOffcuts(base(), rows).map((o) => o.id)).toEqual(['small', 'big']);
  });

  it('turns a 90° offcut onto a 0° sheet; skips grainless offcuts on a grained sheet', () => {
    const rows = [
      row({ id: 'r', grain: 90, width: 1200, height: 900 }),
      row({ id: 'n', grain: null }),
    ];
    expect(usableOffcuts(base(), rows)).toEqual([{ id: 'r', width: 900, height: 1200 }]);
    expect(usableOffcuts(base(true, null), rows).map((o) => o.id)).toEqual(['n', 'r']);
    expect(usableOffcuts(base(true, 30), rows)).toEqual([]);
  });
});

describe('offcut-first nesting', () => {
  const offcuts = [{ id: 'off-1', width: 1100, height: 900 }];

  it('uses the offcut before a full sheet and marks the layout sheet', () => {
    const r = nestProject(base(), { toolDiameter: 8, offcuts });
    expect(r.unplaced).toHaveLength(0);
    expect(r.layout.sheets[0]?.offcutId).toBe('off-1');
    expect(r.layout.sheets[0]?.size).toEqual({ width: 1100, height: 900 });
    expect(usedOffcutIds({ layout: r.layout })).toEqual(['off-1']);
  });

  it('ignores offcuts when useOffcuts is off: layout identical to the no-offcut run', () => {
    const off = base(false);
    expect(nestProject(off, { toolDiameter: 8, offcuts }).layout).toEqual(
      nestProject(off, { toolDiameter: 8 }).layout,
    );
  });

  it('an offcut is used at most once (qty 1)', () => {
    const p = projectOf({ parts: [{ id: 'a', w: 1000, h: 800, qty: 3 }], gap: 4, margin: 10 });
    const r = nestProject(
      { ...p, stock: { ...p.stock, useOffcuts: true } },
      { toolDiameter: 8, offcuts },
    );
    expect(r.layout.sheets.filter((s) => s.offcutId === 'off-1')).toHaveLength(1);
    expect(r.unplaced).toHaveLength(0);
  });

  it('runNesting records the offcuts in the log and replays the same layout', () => {
    const stack = new CommandStack(base());
    const res = stack.execute('runNesting', { toolDiameter: 8, offcuts }, ctx);
    expect(res.ok).toBe(true);
    expect(stack.project.layout.sheets[0]?.offcutId).toBe('off-1');
    const replay = applyCommand(base(), 'runNesting', { toolDiameter: 8, offcuts });
    expect(replay.ok && replay.project.layout).toEqual(stack.project.layout);
  });

  it('the AI cannot pass offcuts', () => {
    const tool = commandToolDefinitions().find((t) => t.name === 'runNesting');
    expect(Object.keys(tool?.inputSchema['properties'] as object)).not.toContain('offcuts');
    const stack = new CommandStack(base());
    const r = stack.execute('runNesting', { toolDiameter: 8, offcuts }, { ...ctx, actor: 'ai' });
    expect(r.ok).toBe(false);
  });

  it('setNestingOptions toggles useOffcuts in one undo step', () => {
    const stack = new CommandStack(base(false));
    expect(stack.execute('setNestingOptions', { useOffcuts: true }, ctx).ok).toBe(true);
    expect(stack.project.stock.useOffcuts).toBe(true);
    stack.undo();
    expect(stack.project.stock.useOffcuts).toBe(false);
  });
});

describe('proposeOffcuts', () => {
  it('proposes the right and top strips ≥ 300 mm, inside the sheet, clear of every part', () => {
    const nested = applyCommand(base(), 'runNesting', { toolDiameter: 8 });
    if (!nested.ok) throw new Error('nesting failed');
    const props = proposeOffcuts(nested.project, 8);
    expect(props.length).toBeGreaterThan(0);
    for (const o of props) {
      expect(o.width).toBeGreaterThanOrEqual(300);
      expect(o.height).toBeGreaterThanOrEqual(300);
      expect(o.x + o.width).toBeLessThanOrEqual(2440 + 1e-9);
      expect(o.y + o.height).toBeLessThanOrEqual(1220 + 1e-9);
      expect(o.grain).toBe(0);
      for (const pl of nested.project.layout.sheets[o.sheet]?.placements ?? []) {
        const w = pl.partId === 'b' ? 300 : 500;
        const h = pl.partId === 'b' ? 300 : 400;
        const sw = pl.rot % 180 === 0 ? w : h;
        const sh = pl.rot % 180 === 0 ? h : w;
        const apart =
          pl.x + sw <= o.x || o.x + o.width <= pl.x || pl.y + sh <= o.y || o.y + o.height <= pl.y;
        expect(apart).toBe(true);
      }
    }
    // Proposals never overlap each other.
    const [p, q] = props;
    if (p && q) {
      expect(
        p.x + p.width <= q.x ||
          q.x + q.width <= p.x ||
          p.y + p.height <= q.y ||
          q.y + q.height <= p.y,
      ).toBe(true);
    }
  });

  it('nothing for a free-angle sheet grain (not storable) or a full sheet', () => {
    const nested = applyCommand(base(true, 30), 'runNesting', { toolDiameter: 8 });
    expect(nested.ok && proposeOffcuts(nested.project, 8)).toEqual([]);
    const big = projectOf({ parts: [{ id: 'a', w: 2400, h: 1180 }], gap: 4, margin: 10 });
    const r = applyCommand(big, 'runNesting', { toolDiameter: 8 });
    expect(r.ok && proposeOffcuts(r.project, 8)).toEqual([]);
  });
});
