'use client';

import {
  operationToolsOf,
  type MachineProfile,
  type OperationToolRow,
  type Project,
  type Tool,
} from '@nittcam/core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  formatNumberTr,
} from '@nittcam/ui';
import { useId } from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';

type Text = Messages['simulation']['cutting']['tools'];
type Run = (name: string, params: unknown) => boolean;

/** Select value of the default choice (no project tool). */
const DEFAULT = 'default';

/**
 * T308 (D-099): "Takım (işleme göre)" in the Simülasyon "Kesim ayarları", before the T307 spindle
 * rows: one picker per operation of the job (dış kontur, iç kontur, cep, delik) listing only the
 * machine's tools that suit it on this job (`operationToolsOf`). The first entry is the default
 * (the material set's tool, or each hole's own tool); any other is one `setOperationTool` command
 * (undoable). The spindle rows follow the chosen tool.
 */
export function OperationTools({
  t,
  project,
  machine,
  run,
}: {
  t: Text;
  project: Project;
  machine: MachineProfile | null;
  run: Run;
}) {
  if (!machine) return null;
  const rows = operationToolsOf(project, machine);
  if (rows.length === 0) return null;
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" data-testid="sim-cutting-tools">
      <legend className="mb-1 text-xs font-medium text-fg">{t.title}</legend>
      {rows.map((row) => (
        <ToolRow key={row.op} t={t} row={row} machine={machine} run={run} />
      ))}
      <p className="text-xs text-fg-muted">{t.hint}</p>
    </fieldset>
  );
}

function ToolRow({
  t,
  row,
  machine,
  run,
}: {
  t: Text;
  row: OperationToolRow;
  machine: MachineProfile;
  run: Run;
}) {
  const id = useId();
  const label = (tool: Tool) =>
    fill(t.option, {
      tool: tool.number,
      diameter: formatNumberTr(tool.diameter, { maxDecimals: 2 }),
      type: t.types[tool.type],
    });
  const fallback =
    row.defaultTool === null ? undefined : machine.tools.find((x) => x.number === row.defaultTool);
  const defaultLabel = fallback ? `${label(fallback)} ${t.recommendedSuffix}` : t.perHole;
  // The default tool is the first entry; other suitable tools follow (the default not twice).
  const others = row.candidates.filter(
    (c) => c.number !== row.defaultTool || row.chosen === c.number,
  );
  const value = row.chosen === undefined ? DEFAULT : String(row.chosen);
  const testId = `sim-tool-${row.op}`;
  const statusId = `${id}-status`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={testId} data-value={row.tool ?? ''}>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-select`} className="text-xs text-fg-muted">
          {t.ops[row.op]}
        </label>
        <Select
          value={value}
          onValueChange={(v) =>
            run('setOperationTool', { op: row.op, tool: v === DEFAULT ? null : Number(v) })
          }
        >
          <SelectTrigger
            id={`${id}-select`}
            size="sm"
            className="w-full min-w-0 [&>span]:min-w-0"
            aria-describedby={statusId}
            aria-invalid={row.problem !== null || undefined}
            data-testid={`${testId}-select`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
            {others.map((c) => (
              <SelectItem key={c.number} value={String(c.number)}>
                {label(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p
        id={statusId}
        className={cn(
          'flex flex-wrap items-baseline gap-x-2 text-xs',
          row.problem ? 'text-danger-text' : 'text-fg-muted',
        )}
        data-testid={`${testId}-status`}
        data-problem={row.problem ?? undefined}
      >
        <span>
          {row.problem
            ? t.problem
            : row.chosen !== undefined
              ? t.source.project
              : others.length === 0
                ? t.only
                : t.source.recommended}
        </span>
        {row.chosen !== undefined ? (
          <button
            type="button"
            data-testid={`${testId}-reset`}
            onClick={() => run('setOperationTool', { op: row.op, tool: null })}
            className="rounded-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t.reset}
          </button>
        ) : null}
      </p>
    </div>
  );
}
