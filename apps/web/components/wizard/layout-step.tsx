'use client';

import type { NestingMode, Project, ValidationIssue } from '@nittcam/core';
import { useId, useState, type ReactNode } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import type { ProjectSession } from '../../lib/project-session';
import { useNestingWorker } from '../../lib/use-nesting-worker';
import { LayoutView, type LockRequest } from '../layout-view/layout-view';
import { NestingPanel } from '../parts/nesting-panel';
import { LayoutGrid } from 'lucide-react';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nittcam/ui';
import { NumberField } from './number-field';
import { WorkspaceLayout } from './workspace-layout';

const MODES: readonly NestingMode[] = ['minWaste', 'fastest', 'minToolChanges'];

type NestMessage = { kind: 'error' | 'info'; text: string } | null;

/**
 * Runs nesting in the worker and records the result as one command (D-019). Shared by the "Diz"
 * button of the panel and "Yeniden diz" of the layout view.
 */
function useNest(session: ProjectSession, toolDiameter: number, t: Messages['cutList']['nesting']) {
  const runNesting = useNestingWorker();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<NestMessage>(null);
  // Counts new "Diz" results so the layout plays its fade/settle-in once per result (T196).
  const [nested, setNested] = useState(0);

  async function nest() {
    const base = session.project;
    setRunning(true);
    setMessage(null);
    try {
      const res = await runNesting(base, toolDiameter);
      if (!res.ok) {
        if (res.error !== 'terminated') {
          setMessage({ kind: 'error', text: fill(t.failed, { error: res.error }) });
        }
        return;
      }
      const result = session.recordApplied('runNesting', res.applied, base);
      if (!result.ok) {
        setMessage(
          result.error.code === 'STALE_BASE'
            ? { kind: 'error', text: t.stale }
            : { kind: 'error', text: fill(t.failed, { error: result.error.message }) },
        );
      } else if (!result.changed) {
        setMessage({ kind: 'info', text: t.unchanged });
      } else {
        setNested((n) => n + 1);
      }
    } finally {
      setRunning(false);
    }
  }
  return { nest, running, message, nested };
}

/** Step 3 (spec §3.6 "Dizilim"): options + "Diz" on the left, the layout view on the right. */
export function LayoutStep({
  messages,
  session,
  toolDiameter,
  side,
}: {
  messages: Messages;
  session: ProjectSession;
  toolDiameter: number;
  /** Extra content under the options (the warnings panel). */
  side: ReactNode;
}) {
  const t = messages.wizard.layout;
  const nt = messages.cutList.nesting;
  const modeId = useId();
  const { nest, running, message, nested } = useNest(session, toolDiameter, nt);
  const project: Project = session.project;
  const issues: readonly ValidationIssue[] = session.issues;
  const errors = messages.wizard.machine.errors;
  const run = session.run;

  const settings = (
    <div className="flex min-w-0 flex-col gap-3">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-xs">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{t.options}</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={modeId} className="text-sm font-medium text-fg">
            {t.mode}
          </label>
          <Select
            value={project.nesting.mode}
            onValueChange={(v) => run('setNestingOptions', { mode: v })}
          >
            <SelectTrigger id={modeId} data-testid="layout-mode" data-value={project.nesting.mode}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {t.modes[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-fg-muted">{t.modeNote}</p>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <NumberField
            label={t.gap}
            value={project.nesting.gap}
            min={-1}
            errors={errors}
            onCommit={(gap) => run('setNestingOptions', { gap })}
          />
          <NumberField
            label={t.margin}
            value={project.nesting.margin}
            min={-1}
            errors={errors}
            onCommit={(margin) => run('setNestingOptions', { margin })}
          />
        </div>
        <p className="text-xs text-fg-subtle">{t.offcuts}</p>
      </section>
      <NestingPanel
        t={nt}
        project={project}
        toolDiameter={toolDiameter}
        running={running}
        message={message}
        onRun={() => void nest()}
      />
      {side}
    </div>
  );

  // Below 1024 px "Diz" stays next to the panel buttons, never scrolled away (T198).
  const compactNest = (
    <Button
      onClick={() => void nest()}
      disabled={running || project.parts.length === 0}
      aria-busy={running}
      data-testid="layout-nest-compact"
      className="shrink-0"
    >
      <LayoutGrid aria-hidden />
      {nt.run}
    </Button>
  );

  return project.layout.sheets.length > 0 ? (
    <LayoutView
      t={messages.layout}
      project={project}
      toolDiameter={toolDiameter}
      issues={issues}
      onLock={(req: LockRequest) => run('lockPlacement', req)}
      onRenest={() => void nest()}
      renesting={running}
      appearKey={nested}
      left={settings}
      compactAction={compactNest}
    />
  ) : (
    <WorkspaceLayout
      testId="layout-workspace"
      labels={messages.layout.workspace}
      left={settings}
      compactAction={compactNest}
      canvas={
        <div
          data-testid="layout-empty"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-fg-muted">
            <LayoutGrid aria-hidden className="size-5" />
          </span>
          <p className="max-w-sm text-sm text-fg-muted">
            {project.parts.length === 0 ? t.noParts : t.empty}
          </p>
        </div>
      }
    />
  );
}
