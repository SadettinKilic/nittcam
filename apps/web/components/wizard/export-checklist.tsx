'use client';

import { Checkbox } from '@nittcam/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { fill } from '../../lib/fill';
import type { ChecklistState } from '../../lib/export-gate';
import type { ExportChecklistInfo } from '../../lib/exports-api';
import type { Messages } from '../../lib/messages';

type Text = Messages['wizard']['export'];
type Corners = Messages['machines']['form']['options']['corner'];

/**
 * The pre-export checklist of an NC download (spec §6.6, §7.2; T021, T274, T282, T286): origin,
 * tool(s), tool changes, unverified templates, air cut. One component for the export step and the
 * history's "Yeniden üret" dialog (D-071), so both ask exactly the same lines.
 */
export function ExportChecklist({
  t,
  corners,
  checklist,
  templateNames,
  hingeHandleParts,
  checks,
  onChange,
  testIdPrefix = 'export',
}: {
  t: Text;
  corners: Corners;
  checklist: ExportChecklistInfo | null;
  templateNames: readonly string[];
  hingeHandleParts: readonly string[];
  checks: ChecklistState;
  onChange: (checks: ChecklistState) => void;
  /** `export` on the step (existing test ids), `reexport` in the dialog. */
  testIdPrefix?: string;
}) {
  const set = (patch: Partial<ChecklistState>) => onChange({ ...checks, ...patch });
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" data-testid={`${testIdPrefix}-checklist`}>
      <legend className="mb-2 text-sm font-semibold text-fg">{t.checklistTitle}</legend>
      <ChecklistItem
        testId={`${testIdPrefix}-check-origin`}
        checked={checks.origin}
        onChange={(v) => set({ origin: v })}
        label={fill(t.checkOrigin, {
          corner: checklist ? corners[checklist.origin.corner] : '-',
        })}
      />
      <ChecklistItem
        testId={`${testIdPrefix}-check-tool`}
        checked={checks.tool}
        onChange={(v) => set({ tool: v })}
        label={
          checklist && checklist.tools.length > 0
            ? fill(t.checkTool, {
                tools: checklist.tools
                  .map((tool) => `T${tool.number} Ø${tool.diameter} mm`)
                  .join(' → '),
              })
            : t.checkToolNone
        }
      />
      {checklist && checklist.toolChanges > 0 ? (
        <ChecklistItem
          testId={`${testIdPrefix}-check-toolchange`}
          checked={checks.toolChange}
          onChange={(v) => set({ toolChange: v })}
          label={fill(checklist.rezeroZ ? t.checkToolChangeZ : t.checkToolChange, {
            count: checklist.toolChanges,
          })}
        />
      ) : null}
      {checklist?.parkOff ? (
        // T321 (usta 2): a manual change without a park point stops with the tool over the sheet.
        <p
          className="flex items-start gap-1.5 text-sm text-warning-text"
          data-testid={`${testIdPrefix}-park-off`}
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.parkOff}
        </p>
      ) : null}
      {templateNames.length > 0 ? (
        <ChecklistItem
          testId={`${testIdPrefix}-check-templates`}
          checked={checks.templates}
          onChange={(v) => set({ templates: v })}
          label={fill(t.checkTemplates, { names: templateNames.join(', ') })}
        />
      ) : null}
      {hingeHandleParts.length > 0 ? (
        <p
          className="flex items-start gap-1.5 text-sm text-warning-text"
          data-testid={`${testIdPrefix}-hinge-handle`}
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {fill(t.hingeHandle, { names: hingeHandleParts.join(', ') })}
        </p>
      ) : null}
      <ChecklistItem
        testId={`${testIdPrefix}-check-aircut`}
        checked={checks.airCut}
        onChange={(v) => set({ airCut: v })}
        label={t.checkAirCut}
      />
      <p className="flex items-start gap-1.5 text-xs text-warning-text">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        {t.airCutNote}
      </p>
    </fieldset>
  );
}

function ChecklistItem({
  testId,
  checked,
  onChange,
  label,
}: {
  testId: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div
      className={`relative flex min-h-12 items-start gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${checked ? 'border-success-border bg-success-subtle text-fg' : 'border-border bg-surface text-fg hover:bg-surface-hover'}`}
    >
      <Checkbox
        id={id}
        data-testid={testId}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="relative z-10 mt-0.5 data-[state=checked]:border-success data-[state=checked]:bg-success data-[state=checked]:text-success-fg"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer after:absolute after:inset-0">
        {label}
      </label>
      {checked ? <CircleCheck aria-hidden className="size-4 shrink-0 text-success-text" /> : null}
    </div>
  );
}
