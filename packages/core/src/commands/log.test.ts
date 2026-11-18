import { describe, expect, it } from 'vitest';
import type { Project } from '../schema';
import {
  CommandStack,
  MAX_LOG_ENTRIES,
  parseCommandLog,
  replayLog,
  type CommandLogEntry,
} from './index';

const AT = '2026-11-17T10:00:00.000+03:00';

function empty(): Project {
  return {
    schemaVersion: 2,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as Project;
}

const entry = (command: string, params: unknown): CommandLogEntry => ({
  command,
  params,
  actor: 'user',
  at: AT,
});

describe('parseCommandLog (D-029)', () => {
  it('accepts commands and history events and fills param defaults', () => {
    const r = parseCommandLog([
      entry('addPart', { id: 'a', params: { w: 100, h: 200, r: 0 } }),
      entry('undo', {}),
      entry('redo', {}),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0]?.params).toMatchObject({ id: 'a', qty: 1, name: '' });
    expect(r.entries.map((e) => e.command)).toEqual(['addPart', 'undo', 'redo']);
  });

  it.each([
    ['not an array', {}],
    ['unknown command', [entry('formatDisk', {})]],
    ['bad params', [entry('setThickness', { thickness: -1 })]],
    ['undo with params', [entry('undo', { n: 1 })]],
    ['bad actor', [{ ...entry('undo', {}), actor: 'root' }]],
    ['bad time', [{ ...entry('undo', {}), at: 'yesterday' }]],
    ['not an object', ['undo']],
    ['too many', Array.from({ length: MAX_LOG_ENTRIES + 1 }, () => entry('undo', {}))],
  ])('rejects %s', (_label, raw) => {
    expect(parseCommandLog(raw).ok).toBe(false);
  });
});

describe('replayLog', () => {
  it('replays commands, undo and redo to the same project as the live stack', () => {
    const live = new CommandStack(empty());
    const log: CommandLogEntry[] = [];
    const run = (name: string, params: unknown) => {
      const r = live.execute(name, params, { actor: 'user', at: AT });
      if (r.ok && r.changed) log.push(r.entry);
    };
    run('addPart', { id: 'a', params: { w: 100, h: 200, r: 0 } });
    run('addPart', { id: 'b', params: { w: 300, h: 200, r: 0 } });
    live.undo();
    log.push(entry('undo', {}));
    live.redo();
    log.push(entry('redo', {}));
    live.undo();
    log.push(entry('undo', {}));
    run('setGrain', { grain: 90 });

    const again = new CommandStack(empty());
    expect(replayLog(again, log)).toBe(log.length);
    expect(again.project).toEqual(live.project);
  });

  it('stops at the first entry that cannot apply', () => {
    const stack = new CommandStack(empty());
    expect(replayLog(stack, [entry('undo', {}), entry('setGrain', { grain: 90 })])).toBe(0);
    expect(stack.project.stock.sheet.grain).toBe(0);
  });
});
