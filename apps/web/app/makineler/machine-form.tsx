'use client';

import {
  parseMachineProfile,
  type MachineProfile,
  type MachineProfileIssue,
  type MaterialParams,
  type Tool,
} from '@nittcam/core';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { ApiError, MachineDetail } from '../../lib/machines-api';
import type { Messages } from '../../lib/messages';
import { CheckField, fieldId, NumberField, SelectField, TextField } from './fields';
import { fieldErrors, type FieldErrors } from './issues';

type Text = Messages['machines'];

export interface MachineFormProps {
  t: Text;
  /** `null` for a new machine. */
  machineId: string | null;
  initial: MachineProfile;
  onSaved: (detail: MachineDetail) => void;
  onCancel: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-card border border-border p-4">
      <legend className="px-1 text-base font-semibold text-fg">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

const buttonClass =
  'rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60';

/** Stable React keys for table rows, so a removed row does not shift the inputs below it. */
function useRowKeys(count: number) {
  const next = useRef(count);
  const [keys, setKeys] = useState(() => Array.from({ length: count }, (_, i) => i));
  return {
    keys,
    add: () => setKeys((k) => [...k, next.current++]),
    remove: (index: number) => setKeys((k) => k.filter((_, i) => i !== index)),
  };
}

export function MachineForm({ t, machineId, initial, onSaved, onCancel }: MachineFormProps) {
  const f = t.form.fields;
  const o = t.form.options;
  const [profile, setProfile] = useState<MachineProfile>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<MachineProfileIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const toolRows = useRowKeys(initial.tools.length);
  const materialRows = useRowKeys(initial.materials.length);

  // Client-side check with the same core schema the server uses; shown after the first submit.
  const errors: FieldErrors = useMemo(() => {
    if (!submitted) return {};
    const r = parseMachineProfile(profile);
    const issues = r.ok ? serverIssues : [...r.issues, ...serverIssues];
    return fieldErrors(issues, t.errors);
  }, [submitted, profile, serverIssues, t.errors]);
  const hasErrors = Object.keys(errors).length > 0;

  function update(mutate: (draft: MachineProfile) => void) {
    setServerIssues([]);
    setSaveError(false);
    setProfile((prev) => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setSaveError(false);
    const parsed = parseMachineProfile(profile);
    if (!parsed.ok) {
      const first = parsed.issues[0];
      if (first) document.getElementById(fieldId(first.path))?.focus();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(machineId ? `/api/machines/${machineId}` : '/api/machines', {
        method: machineId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: parsed.profile }),
      });
      if (res.ok) {
        onSaved((await res.json()) as MachineDetail);
        return;
      }
      const body = (await res.json().catch(() => null)) as ApiError | null;
      if (body?.error === 'invalid_profile') setServerIssues(body.issues);
      else setSaveError(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const e = (path: string) => errors[path];

  return (
    <form
      noValidate
      onSubmit={(ev) => void submit(ev)}
      className="flex flex-col gap-6"
      aria-labelledby="machine-form-title"
    >
      <div className="flex flex-col gap-2">
        <h2 id="machine-form-title" className="text-2xl font-semibold">
          {machineId ? t.form.editTitle : t.form.createTitle}
        </h2>
        {profile.example ? (
          <p className="rounded-lg bg-warn-bg p-3 text-sm text-warn">{t.form.exampleNote}</p>
        ) : null}
        <p className="text-sm text-fg-muted">{t.form.versionNote}</p>
      </div>

      <Section title={t.form.sections.identity}>
        <TextField
          path="identity.name"
          label={f.name}
          value={profile.identity.name}
          error={e('identity.name')}
          onChange={(v) => update((p) => void (p.identity.name = v))}
        />
        <TextField
          path="identity.brand"
          label={f.brand}
          value={profile.identity.brand}
          error={e('identity.brand')}
          onChange={(v) => update((p) => void (p.identity.brand = v))}
        />
        <TextField
          path="identity.model"
          label={f.model}
          value={profile.identity.model}
          error={e('identity.model')}
          onChange={(v) => update((p) => void (p.identity.model = v))}
        />
        <TextField
          path="identity.controller.family"
          label={f.controllerFamily}
          value={profile.identity.controller.family}
          error={e('identity.controller.family')}
          onChange={(v) => update((p) => void (p.identity.controller.family = v))}
        />
        <TextField
          path="identity.controller.version"
          label={f.controllerVersion}
          value={profile.identity.controller.version}
          error={e('identity.controller.version')}
          onChange={(v) => update((p) => void (p.identity.controller.version = v))}
        />
        <TextField
          path="identity.notes"
          label={f.notes}
          multiline
          value={profile.identity.notes}
          error={e('identity.notes')}
          onChange={(v) => update((p) => void (p.identity.notes = v))}
        />
      </Section>

      <Section title={t.form.sections.envelope}>
        <NumberField
          path="workEnvelope.x"
          label={f.envelopeX}
          value={profile.workEnvelope.x}
          error={e('workEnvelope.x')}
          onChange={(v) => update((p) => void (p.workEnvelope.x = v))}
        />
        <NumberField
          path="workEnvelope.y"
          label={f.envelopeY}
          value={profile.workEnvelope.y}
          error={e('workEnvelope.y')}
          onChange={(v) => update((p) => void (p.workEnvelope.y = v))}
        />
        <NumberField
          path="workEnvelope.z"
          label={f.envelopeZ}
          value={profile.workEnvelope.z}
          error={e('workEnvelope.z')}
          onChange={(v) => update((p) => void (p.workEnvelope.z = v))}
        />
        <NumberField
          path="table.width"
          label={f.tableWidth}
          value={profile.table.width}
          error={e('table.width')}
          onChange={(v) => update((p) => void (p.table.width = v))}
        />
        <NumberField
          path="table.depth"
          label={f.tableDepth}
          value={profile.table.depth}
          error={e('table.depth')}
          onChange={(v) => update((p) => void (p.table.depth = v))}
        />
        <NumberField
          path="safeZ"
          label={f.safeZ}
          value={profile.safeZ}
          error={e('safeZ')}
          onChange={(v) => update((p) => void (p.safeZ = v))}
        />
      </Section>

      <Section title={t.form.sections.origin}>
        <SelectField
          path="origin.corner"
          label={f.corner}
          value={profile.origin.corner}
          options={o.corner}
          error={e('origin.corner')}
          onChange={(v) => update((p) => void (p.origin.corner = v))}
        />
        <SelectField
          path="origin.xPositive"
          label={f.xPositive}
          value={profile.origin.xPositive}
          options={o.xPositive}
          error={e('origin.xPositive')}
          onChange={(v) => update((p) => void (p.origin.xPositive = v))}
        />
        <SelectField
          path="origin.yPositive"
          label={f.yPositive}
          value={profile.origin.yPositive}
          options={o.yPositive}
          error={e('origin.yPositive')}
          onChange={(v) => update((p) => void (p.origin.yPositive = v))}
        />
        <NumberField
          path="origin.sheetOffset.x"
          label={f.sheetOffsetX}
          value={profile.origin.sheetOffset.x}
          error={e('origin.sheetOffset.x')}
          onChange={(v) => update((p) => void (p.origin.sheetOffset.x = v))}
        />
        <NumberField
          path="origin.sheetOffset.y"
          label={f.sheetOffsetY}
          value={profile.origin.sheetOffset.y}
          error={e('origin.sheetOffset.y')}
          onChange={(v) => update((p) => void (p.origin.sheetOffset.y = v))}
        />
      </Section>

      <Section title={t.form.sections.zZero}>
        <SelectField
          path="zZero.reference"
          label={f.zReference}
          value={profile.zZero.reference}
          options={o.zReference}
          error={e('zZero.reference')}
          onChange={(v) => update((p) => void (p.zZero.reference = v))}
        />
        <NumberField
          path="zZero.spoilboardAllowance"
          label={f.spoilboard}
          help={f.spoilboardHelp}
          value={profile.zZero.spoilboardAllowance}
          error={e('zZero.spoilboardAllowance')}
          onChange={(v) => update((p) => void (p.zZero.spoilboardAllowance = v))}
        />
      </Section>

      <Section title={t.form.sections.spindle}>
        <NumberField
          path="spindle.powerKw"
          label={f.powerKw}
          value={profile.spindle.powerKw}
          error={e('spindle.powerKw')}
          onChange={(v) => update((p) => void (p.spindle.powerKw = v))}
        />
        <NumberField
          path="spindle.minRpm"
          label={f.minRpm}
          value={profile.spindle.minRpm}
          error={e('spindle.minRpm')}
          onChange={(v) => update((p) => void (p.spindle.minRpm = v))}
        />
        <NumberField
          path="spindle.maxRpm"
          label={f.maxRpm}
          value={profile.spindle.maxRpm}
          error={e('spindle.maxRpm')}
          onChange={(v) => update((p) => void (p.spindle.maxRpm = v))}
        />
        <NumberField
          path="spindle.warmupSeconds"
          label={f.warmup}
          value={profile.spindle.warmupSeconds}
          error={e('spindle.warmupSeconds')}
          onChange={(v) => update((p) => void (p.spindle.warmupSeconds = v))}
        />
      </Section>

      <Section title={t.form.sections.toolChanger}>
        <SelectField
          path="toolChanger.type"
          label={f.changerType}
          value={profile.toolChanger.type}
          options={o.changerType}
          error={e('toolChanger.type')}
          onChange={(v) => update((p) => void (p.toolChanger.type = v))}
        />
        <NumberField
          path="toolChanger.capacity"
          label={f.capacity}
          value={profile.toolChanger.capacity}
          error={e('toolChanger.capacity')}
          onChange={(v) => update((p) => void (p.toolChanger.capacity = v))}
        />
        <CheckField
          path="toolChanger.lengthCompensation"
          label={f.g43}
          checked={profile.toolChanger.lengthCompensation}
          onChange={(v) => update((p) => void (p.toolChanger.lengthCompensation = v))}
        />
      </Section>

      <Section title={t.form.sections.holdDown}>
        <SelectField
          path="holdDown.type"
          label={f.holdDownType}
          value={profile.holdDown.type}
          options={o.holdDownType}
          error={e('holdDown.type')}
          onChange={(v) => update((p) => void (p.holdDown.type = v))}
        />
        <TextField
          path="holdDown.vacuumOn"
          label={f.vacuumOn}
          help={f.mCodeHelp}
          value={profile.holdDown.vacuumOn}
          error={e('holdDown.vacuumOn')}
          onChange={(v) => update((p) => void (p.holdDown.vacuumOn = v))}
        />
        <TextField
          path="holdDown.vacuumOff"
          label={f.vacuumOff}
          help={f.mCodeHelp}
          value={profile.holdDown.vacuumOff}
          error={e('holdDown.vacuumOff')}
          onChange={(v) => update((p) => void (p.holdDown.vacuumOff = v))}
        />
      </Section>

      <Section title={t.form.sections.post}>
        <TextField
          path="post.id"
          label={f.postId}
          help={f.postHelp}
          value={profile.post.id}
          error={e('post.id')}
          onChange={(v) => update((p) => void (p.post.id = v))}
        />
        <TextField
          path="post.version"
          label={f.postVersion}
          value={profile.post.version}
          error={e('post.version')}
          onChange={(v) => update((p) => void (p.post.version = v))}
        />
      </Section>

      <Section title={t.form.sections.constraints}>
        <NumberField
          path="constraints.maxFileNameLength"
          label={f.maxFileName}
          value={profile.constraints.maxFileNameLength}
          error={e('constraints.maxFileNameLength')}
          onChange={(v) => update((p) => void (p.constraints.maxFileNameLength = v))}
        />
        <NumberField
          path="constraints.maxFileSizeMb"
          label={f.maxFileSize}
          value={profile.constraints.maxFileSizeMb}
          error={e('constraints.maxFileSizeMb')}
          onChange={(v) => update((p) => void (p.constraints.maxFileSizeMb = v))}
        />
        <div className="flex flex-col">
          <CheckField
            path="constraints.arcs"
            label={f.arcs}
            checked={profile.constraints.arcs}
            onChange={(v) => update((p) => void (p.constraints.arcs = v))}
          />
          <CheckField
            path="constraints.lineNumbers"
            label={f.lineNumbers}
            checked={profile.constraints.lineNumbers}
            onChange={(v) => update((p) => void (p.constraints.lineNumbers = v))}
          />
          <CheckField
            path="constraints.drillCycles"
            label={f.drillCycles}
            checked={profile.constraints.drillCycles}
            onChange={(v) => update((p) => void (p.constraints.drillCycles = v))}
          />
        </div>
      </Section>

      <RowTable
        title={t.form.sections.tools}
        headers={[f.toolNumber, f.toolType, f.toolDiameter, f.fluteLength, f.flutes]}
        addLabel={t.form.add}
        removeLabel={t.form.remove}
        error={e('tools')}
        keys={toolRows.keys}
        onAdd={() => {
          toolRows.add();
          update((p) => {
            const number = Math.min(99, Math.max(0, ...p.tools.map((x) => x.number)) + 1);
            p.tools.push({ number, type: 'flatEndMill', diameter: 6, fluteLength: 22, flutes: 2 });
          });
        }}
        onRemove={(i) => {
          toolRows.remove(i);
          update((p) => void p.tools.splice(i, 1));
        }}
        renderRow={(i) => {
          const tool = profile.tools[i] as Tool;
          const path = (k: keyof Tool) => `tools[${i}].${k}`;
          const set = (fn: (x: Tool) => void) => update((p) => fn(p.tools[i] as Tool));
          return [
            <NumberField
              key="n"
              compact
              path={path('number')}
              label={f.toolNumber}
              value={tool.number}
              error={e(path('number'))}
              onChange={(v) => set((x) => void (x.number = v))}
            />,
            <SelectField
              key="t"
              compact
              path={path('type')}
              label={f.toolType}
              value={tool.type}
              options={o.toolType}
              error={e(path('type'))}
              onChange={(v) => set((x) => void (x.type = v))}
            />,
            <NumberField
              key="d"
              compact
              path={path('diameter')}
              label={f.toolDiameter}
              value={tool.diameter}
              error={e(path('diameter'))}
              onChange={(v) => set((x) => void (x.diameter = v))}
            />,
            <NumberField
              key="l"
              compact
              path={path('fluteLength')}
              label={f.fluteLength}
              value={tool.fluteLength}
              error={e(path('fluteLength'))}
              onChange={(v) => set((x) => void (x.fluteLength = v))}
            />,
            <NumberField
              key="f"
              compact
              path={path('flutes')}
              label={f.flutes}
              value={tool.flutes}
              error={e(path('flutes'))}
              onChange={(v) => set((x) => void (x.flutes = v))}
            />,
          ];
        }}
      />

      <RowTable
        title={t.form.sections.materials}
        headers={[f.material, f.thickness, f.feed, f.plungeFeed, f.rpm, f.stepDown, f.materialTool]}
        addLabel={t.form.add}
        removeLabel={t.form.remove}
        error={e('materials')}
        keys={materialRows.keys}
        onAdd={() => {
          materialRows.add();
          update(
            (p) =>
              void p.materials.push({
                material: 'mdf',
                thickness: 18,
                feed: 5000,
                plungeFeed: 1500,
                rpm: Math.min(Math.max(18000, p.spindle.minRpm), p.spindle.maxRpm),
                stepDown: 6,
                tool: p.tools[0]?.number ?? 1,
              }),
          );
        }}
        onRemove={(i) => {
          materialRows.remove(i);
          update((p) => void p.materials.splice(i, 1));
        }}
        renderRow={(i) => {
          const m = profile.materials[i] as MaterialParams;
          const path = (k: keyof MaterialParams) => `materials[${i}].${k}`;
          const set = (fn: (x: MaterialParams) => void) =>
            update((p) => fn(p.materials[i] as MaterialParams));
          const num = (k: 'thickness' | 'feed' | 'plungeFeed' | 'rpm' | 'stepDown' | 'tool') => (
            <NumberField
              key={k}
              compact
              path={path(k)}
              label={
                {
                  thickness: f.thickness,
                  feed: f.feed,
                  plungeFeed: f.plungeFeed,
                  rpm: f.rpm,
                  stepDown: f.stepDown,
                  tool: f.materialTool,
                }[k]
              }
              value={m[k]}
              error={e(path(k))}
              onChange={(v) => set((x) => void (x[k] = v))}
            />
          );
          return [
            <SelectField
              key="m"
              compact
              path={path('material')}
              label={f.material}
              value={m.material}
              options={o.material}
              error={e(path('material'))}
              onChange={(v) => set((x) => void (x.material = v))}
            />,
            num('thickness'),
            num('feed'),
            num('plungeFeed'),
            num('rpm'),
            num('stepDown'),
            num('tool'),
          ];
        }}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="submit"
          disabled={saving}
          className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
        >
          {saving ? t.form.saving : t.form.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`${buttonClass} border border-border bg-bg text-fg hover:bg-sidebar`}
        >
          {t.form.cancel}
        </button>
        <div aria-live="polite" className="text-sm">
          {hasErrors ? <span className="font-medium text-danger">{t.form.hasErrors}</span> : null}
          {saveError ? <span className="font-medium text-danger">{t.form.saveError}</span> : null}
        </div>
      </div>
    </form>
  );
}

function RowTable(props: {
  title: string;
  headers: string[];
  addLabel: string;
  removeLabel: string;
  error: string | undefined;
  keys: number[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderRow: (index: number) => ReactNode[];
}) {
  const { title, headers, addLabel, removeLabel, error, keys, onAdd, onRemove, renderRow } = props;
  return (
    <fieldset className="rounded-card border border-border p-4">
      <legend className="px-1 text-base font-semibold text-fg">{title}</legend>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-x-2 border-spacing-y-1 text-sm">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col" className="text-left font-medium text-fg-muted">
                  {h}
                </th>
              ))}
              <th scope="col" className="sr-only">
                {removeLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key, i) => (
              <tr key={key} className="align-top">
                {renderRow(i).map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
                <td>
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className={`${buttonClass} text-danger hover:bg-danger-bg`}
                  >
                    {removeLabel}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="mt-2 text-xs font-medium text-danger">{error}</p> : null}
      <button
        type="button"
        onClick={onAdd}
        className={`${buttonClass} mt-2 border border-border bg-bg text-fg hover:bg-sidebar`}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}
