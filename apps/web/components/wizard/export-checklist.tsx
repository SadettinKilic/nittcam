'use client';

import { Checkbox } from '@nittcam/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { fill } from '../../lib/fill';
import { fileNameWarning } from '../../lib/check-state';
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
  onUseLatest,
  testIdPrefix = 'export',
}: {
  t: Text;
  corners: Corners;
  checklist: ExportChecklistInfo | null;
  templateNames: readonly string[];
  hingeHandleParts: readonly string[];
  checks: ChecklistState;
  onChange: (checks: ChecklistState) => void;
  /** T332: move the project to the machine's newest profile version (one undoable command). */
  onUseLatest?: (() => void) | undefined;
  /** `export` on the step (existing test ids), `reexport` in the dialog. */
  testIdPrefix?: string;
}) {
  const set = (patch: Partial<ChecklistState>) => onChange({ ...checks, ...patch });
  const nameLimit = fileNameWarning(checklist?.fileNames);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" data-testid={`${testIdPrefix}-checklist`}>
      <legend className="mb-2 text-sm font-semibold text-fg">{t.checklistTitle}</legend>
      {checklist?.staleProfile ? (
        // T332 (field rehearsal S2): never export stale tool data without a tick.
        <div className="flex flex-col gap-1.5" data-testid={`${testIdPrefix}-stale-profile`}>
          <ChecklistItem
            testId={`${testIdPrefix}-check-stale`}
            checked={checks.stale ?? false}
            onChange={(v) => set({ stale: v })}
            label={fill(t.checkStale, {
              old: checklist.staleProfile.version,
              latest: checklist.staleProfile.latest,
              changes:
                checklist.staleProfile.changes.map((c) => t.profileChange[c]).join(', ') ||
                t.profileChange.other,
            })}
          />
          {onUseLatest ? (
            <button
              type="button"
              data-testid={`${testIdPrefix}-use-latest`}
              onClick={onUseLatest}
              className="self-start rounded-sm text-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {t.useLatestVersion}
            </button>
          ) : null}
        </div>
      ) : null}
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
      {checklist?.vacuumByHand ? (
        // T336 (D-128): vacuum hold-down, but the program does not switch it.
        <ChecklistItem
          testId={`${testIdPrefix}-check-vacuum`}
          checked={checks.vacuum ?? false}
          onChange={(v) => set({ vacuum: v })}
          label={t.checkVacuumByHand}
        />
      ) : null}
      {checklist?.unverifiedMaterial ? (
        // D-130 / T346: ACM cutting values are unverified starting values.
        <ChecklistItem
          testId={`${testIdPrefix}-check-material`}
          checked={checks.material ?? false}
          onChange={(v) => set({ material: v })}
          label={t.checkUnverifiedMaterial}
        />
      ) : null}
      {checklist?.backFace ? (
        // T393 (CTO #14 M1): the program is mirrored; the sheet must lie back face up.
        <ChecklistItem
          testId={`${testIdPrefix}-check-back-face`}
          checked={checks.backFace ?? false}
          onChange={(v) => set({ backFace: v })}
          label={t.checkBackFace}
        />
      ) : null}
      {checklist?.vGroove ? (
        // T355 (analysis §5.6): V-grooves: the V-bit, then the remaining skin on scrap first.
        <>
          <ChecklistItem
            testId={`${testIdPrefix}-check-vbit`}
            checked={checks.vBit ?? false}
            onChange={(v) => set({ vBit: v })}
            label={
              checklist.vGroove.tool === null
                ? t.checkVBitNone
                : fill(checklist.vGroove.angle === null ? t.checkVBitNoAngle : t.checkVBit, {
                    tool: checklist.vGroove.tool,
                    angle: checklist.vGroove.angle ?? '',
                  })
            }
          />
          <ChecklistItem
            testId={`${testIdPrefix}-check-vremaining`}
            checked={checks.vRemaining ?? false}
            onChange={(v) => set({ vRemaining: v })}
            label={fill(t.checkVRemaining, {
              mm: checklist.vGroove.remaining
                .map((r) => r.toLocaleString('tr-TR', { maximumFractionDigits: 2 }))
                .join(' / '),
            })}
          />
        </>
      ) : null}
      {checklist?.tabsNotHeld ? (
        // T338 (D-129): some tabs were left out because they would not hold.
        <ChecklistItem
          testId={`${testIdPrefix}-check-tabs-held`}
          checked={checks.tabsHeld ?? false}
          onChange={(v) => set({ tabsHeld: v })}
          label={fill(t.checkTabsNotHeld, { count: checklist.tabsNotHeld })}
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
      {checklist?.parkHome ? (
        // T332 (field rehearsal S1): G53 is machine coordinates; an unhomed machine hits a limit.
        <p
          className="flex items-start gap-1.5 text-sm text-warning-text"
          data-testid={`${testIdPrefix}-park-home`}
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.parkHome}
        </p>
      ) : null}
      {nameLimit !== null ? (
        // T322 (usta 1): a name longer than the machine reads (or than its newest version allows).
        <p
          className="flex items-start gap-1.5 text-sm text-warning-text"
          data-testid={`${testIdPrefix}-file-name`}
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {fill(t.fileNameLong, {
            longest: checklist?.fileNames?.longest ?? 0,
            limit: nameLimit,
          })}
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
      {checklist?.highFeeds && checklist.highFeeds.length > 0 ? (
        // T330 (D-121): a feed far above the recommendation is often one extra zero.
        <ChecklistItem
          testId={`${testIdPrefix}-check-feeds`}
          checked={checks.feeds ?? false}
          onChange={(v) => set({ feeds: v })}
          label={fill(t.checkFeeds, {
            tools: checklist.highFeeds
              .map((h) =>
                fill(t.checkFeedsTool, {
                  tool: h.tool,
                  feed: h.feed,
                  plunge: h.plungeFeed,
                  recFeed: h.recommendedFeed,
                  recPlunge: h.recommendedPlungeFeed,
                }),
              )
              .join('; '),
          })}
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
