'use client';

import type { SimFile } from '@nittcam/core';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '../../lib/draft-project';
import type { SimText } from './model';

const ROW = 22;
const OVERSCAN = 12;

type Row =
  | { kind: 'file'; file: number; name: string }
  | { kind: 'line'; file: number; line: number; text: string };

/**
 * Scrolling G-code panel (T020): the program as written, the line of the playhead highlighted
 * and kept in view, a click on a line seeks there. Virtualised (fixed row height), so a program of
 * tens of thousands of lines renders only the visible rows.
 */
export const GcodePanel = memo(function GcodePanel({
  t,
  files,
  current,
  height,
  onSeek,
}: {
  t: SimText;
  files: readonly SimFile[];
  current: { file: number; line: number } | null;
  height: number;
  onSeek: (file: number, line: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const { rows, offsets } = useMemo(() => {
    const out: Row[] = [];
    const starts: number[] = [];
    files.forEach((f, file) => {
      out.push({ kind: 'file', file, name: f.name });
      starts.push(out.length);
      f.lines.forEach((text, i) => out.push({ kind: 'line', file, line: i + 1, text }));
    });
    return { rows: out, offsets: starts };
  }, [files]);

  const currentRow = current ? (offsets[current.file] ?? 0) + current.line - 1 : -1;

  // Keep the highlighted line in view (centred when it leaves the visible window).
  useEffect(() => {
    const el = box.current;
    if (!el || currentRow < 0) return;
    const top = currentRow * ROW;
    if (top < el.scrollTop + ROW || top > el.scrollTop + el.clientHeight - 2 * ROW) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2);
    }
  }, [currentRow]);

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const digits = String(Math.max(...files.map((f) => f.lines.length), 1)).length;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 id="gcode-title" className="text-sm font-semibold">
        {t.gcode.title}
      </h3>
      <p id="gcode-help" className="sr-only">
        {t.gcode.label}
      </p>
      <div
        ref={box}
        role="region"
        aria-labelledby="gcode-title"
        aria-describedby="gcode-help"
        data-testid="gcode-panel"
        data-current-line={current?.line ?? ''}
        data-current-file={current?.file ?? ''}
        tabIndex={0}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="relative overflow-auto rounded-lg border border-border bg-bg font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ height }}
      >
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(first, last).map((row, i) => {
            const index = first + i;
            const style = { top: index * ROW, height: ROW } as const;
            if (row.kind === 'file') {
              return (
                <div
                  key={`f${row.file}`}
                  style={style}
                  className="absolute inset-x-0 flex items-center truncate bg-sidebar px-2 font-sans font-semibold text-fg-muted"
                >
                  {fill(t.gcode.file, { name: row.name })}
                </div>
              );
            }
            const active = index === currentRow;
            return (
              <button
                key={`${row.file}:${row.line}`}
                type="button"
                style={style}
                data-line={row.line}
                data-file={row.file}
                aria-current={active ? 'true' : undefined}
                aria-label={fill(t.gcode.line, { line: row.line, text: row.text })}
                onClick={() => onSeek(row.file, row.line)}
                className={`absolute inset-x-0 flex items-center gap-2 px-2 text-left whitespace-pre focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${active ? 'bg-accent text-accent-fg' : 'hover:bg-sidebar'} ${!active && row.text.trimStart().startsWith('(') ? 'text-fg-muted' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className={`shrink-0 text-right tabular-nums ${active ? 'opacity-90' : 'text-fg-muted'}`}
                  style={{ width: `${digits + 0.5}ch` }}
                >
                  {row.line}
                </span>
                <span className="truncate">{row.text}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
