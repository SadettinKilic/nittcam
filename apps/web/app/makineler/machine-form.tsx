'use client';

import { setNavigationGuard } from '../../lib/navigation-guard';
import { usePageBarClearance } from '../../lib/use-page-bar';
import {
  defaultTabHeight,
  KNOWN_POSTS,
  materialTabIssues,
  maxTabHeight,
  parseMachineProfile,
  TAB_BOUNDS,
  TAB_DEFAULTS,
  TOOLPATH_DEFAULTS,
  defaultMachineProfile,
  type MachineProfile,
  type MachineProfileIssue,
  type MaterialKind,
  type MaterialParams,
  type Tool,
} from '@nittcam/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  FormField,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  notify,
  type NumberParseError,
} from '@nittcam/ui';
import { CircleAlert, Info, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { focusRing } from '../../components/page/page-header';
import {
  CONTROLLER_LIBRARY,
  controllerProfile,
  postSupportsMachineCoordinates,
} from '../../lib/controller-library';
import { fill } from '../../lib/fill';
import type { ApiError, MachineDetail } from '../../lib/machines-api';
import {
  FORM_SECTIONS,
  isDirty,
  newParamSet,
  refreshStartingValues,
  startingNote,
  parseErrorText,
  withParamSet,
  type FormSection,
} from '../../lib/machine-form';
import type { Messages } from '../../lib/messages';
import { CornerPicker } from './corner-picker';
import { CheckField, fieldId, NumberField, SelectField, TextField } from './fields';
import { fieldErrors, type FieldErrors } from './issues';

type Text = Messages['machines'];

export interface MachineFormProps {
  t: Text;
  /** `null` for a new machine. */
  machineId: string | null;
  /** Latest profile version of an existing machine. */
  version?: number | undefined;
  /** The profile to edit; null = a new machine (T186: built here, in the lazy form chunk). */
  initial: MachineProfile | null;
  onSaved: (detail: MachineDetail) => void;
  onCancel: () => void;
  /**
   * T258: open with a new parameter set for this kind and thickness (step 1 "Kesim ayarı ekle"),
   * scrolled to "Malzeme parametreleri". The set stays unsaved until the user saves the form.
   */
  addParams?: { material: MaterialKind; thickness: number } | null | undefined;
  /** T302: with `addParams`, land on the set's tab fields ("Malzeme ayarında değiştir"). */
  focusTabs?: boolean;
}

function Section({
  id,
  title,
  hint,
  children,
  wide = false,
}: {
  id: FormSection;
  title: string;
  hint: string;
  children: ReactNode;
  /** Tables: the body is not a field grid. */
  wide?: boolean;
}) {
  return (
    <Card
      id={`sec-${id}`}
      data-section={id}
      role="group"
      aria-labelledby={`sec-${id}-title`}
      className="scroll-mt-20 p-5 sm:p-6"
    >
      <div className="mb-5 flex flex-col gap-1">
        <h3 id={`sec-${id}-title`} className="text-base font-semibold tracking-tight text-fg">
          {title}
        </h3>
        <p className="text-sm text-fg-muted">{hint}</p>
      </div>
      {wide ? (
        children
      ) : (
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">{children}</div>
      )}
    </Card>
  );
}

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

/** The section in view, for the side index (the last section whose top passed the bar). */
function useActiveSection(): FormSection {
  const [active, setActive] = useState<FormSection>(FORM_SECTIONS[0]);
  useEffect(() => {
    const onScroll = () => {
      let current: FormSection = FORM_SECTIONS[0];
      for (const id of FORM_SECTIONS) {
        const el = document.getElementById(`sec-${id}`);
        if (el && el.getBoundingClientRect().top < 140) current = id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return active;
}

/** A new machine starts from the generic profile, not marked as an example, with no name. */
function newMachineProfile(): MachineProfile {
  const p = defaultMachineProfile();
  p.example = false;
  p.identity.name = '';
  return p;
}

export function MachineForm({
  t,
  machineId,
  version,
  initial: initialProp,
  onSaved,
  onCancel,
  addParams = null,
  focusTabs = false,
}: MachineFormProps) {
  const f = t.form.fields;
  const o = t.form.options;
  const u = t.form.units;
  const router = useRouter();
  const [initial] = useState(() => initialProp ?? newMachineProfile());
  const [start] = useState(() => (addParams ? withParamSet(initial, addParams) : null));
  const [profile, setProfile] = useState<MachineProfile>(start?.profile ?? initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<MachineProfileIssue[]>([]);
  const [parseErrors, setParseErrors] = useState<Record<string, NumberParseError>>({});
  const [saving, setSaving] = useState(false);
  // T181: controller family picked from the library (new machines only; '' = none yet).
  const [libraryId, setLibraryId] = useState('');
  const [saveError, setSaveError] = useState(false);
  // Where to go when the user confirms leaving with unsaved changes: an href, the list (null), or
  // browser history ('back': the user pressed Back/Forward).
  const [leaving, setLeaving] = useState<{ href: string | null | 'back' } | null>(null);
  // Set right before a confirmed navigation, so the history guard does not undo it.
  const leavingNow = useRef(false);
  const toolRows = useRowKeys(initial.tools.length);
  const materialRows = useRowKeys((start?.profile ?? initial).materials.length);
  const active = useActiveSection();
  const formRef = useRef<HTMLFormElement>(null);
  // B49: toasts stack above the sticky save bar (bottom-4 = 16 px) instead of covering "Kaydet".
  const saveBar = useRef<HTMLDivElement>(null);
  usePageBarClearance(saveBar, 16);

  // T258: opened to add a parameter set: show "Malzeme parametreleri" and focus the set's feed.
  // After the page's own scroll-to-top (MachinesView), hence the next frame.
  const startIndex = start?.index ?? null;
  useEffect(() => {
    if (startIndex === null) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById('sec-materials')?.scrollIntoView({ block: 'start' });
      // T302: "Malzeme ayarında değiştir" lands on the tab fields (or their switch), else the feed.
      const target =
        (focusTabs &&
          (document.getElementById(fieldId(`materials[${startIndex}].tabs.count`)) ??
            document.getElementById(fieldId(`materials[${startIndex}].tabs`)))) ||
        document.getElementById(fieldId(`materials[${startIndex}].feed`));
      target?.focus({ preventScroll: true });
      // T265: the whole row (and its "starting values" note) in view, not only the section top.
      target?.closest('tr')?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [startIndex, focusTabs]);

  const dirty = isDirty(initial, profile) || Object.keys(parseErrors).length > 0;

  // Leave-page guard: browser reload/close and in-app links while there are unsaved changes.
  useEffect(() => {
    if (!dirty || saving) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || a.target === '_blank' || a.hasAttribute('download'))
        return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaving({ href: url.pathname + url.search + url.hash });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, saving]);

  // Programmatic navigation (command palette, shortcuts) asks before leaving (B3 follow-up).
  useEffect(() => {
    if (!dirty) return;
    return setNavigationGuard((href) => {
      setLeaving({ href });
      return true;
    });
  }, [dirty]);

  // Browser Back/Forward: while dirty a guard entry (same URL) sits on top of the page's entry.
  // Leaving it (popstate) puts it back and asks; "Çık" then goes back past both entries.
  useEffect(() => {
    if (!dirty) return;
    leavingNow.current = false;
    window.history.pushState(
      { ...window.history.state, [GUARD_STATE]: true },
      '',
      window.location.href,
    );
    const onPop = () => {
      if (leavingNow.current) return;
      window.history.pushState(
        { ...window.history.state, [GUARD_STATE]: true },
        '',
        window.location.href,
      );
      setLeaving({ href: 'back' });
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Saved or cancelled on this page: drop the guard entry again (not after a confirmed leave).
      if (!leavingNow.current && isGuardEntry()) window.history.back();
    };
  }, [dirty]);

  // Client-side check with the same core schema the server uses; shown after the first submit.
  const errors: FieldErrors = useMemo(() => {
    const out: FieldErrors = {};
    for (const [path, code] of Object.entries(parseErrors))
      out[path] = parseErrorText(code, t.errors);
    if (!submitted) return out;
    const r = parseMachineProfile(profile);
    // T302: the save-only tab bounds are checked on the form state too, so they show with the rest.
    const tabIssues = materialTabIssues(profile);
    const issues = r.ok
      ? [...tabIssues, ...serverIssues]
      : [...r.issues, ...tabIssues, ...serverIssues];
    return { ...fieldErrors(issues, t.errors), ...out };
  }, [submitted, profile, serverIssues, parseErrors, t.errors]);
  const errorCount = Object.keys(errors).length;
  const hasErrors = submitted && errorCount > 0;
  // Shipped posts (spec §6.4, T017); an unknown id from an older profile stays selectable.
  const postOptions: Record<string, string> = Object.fromEntries(
    KNOWN_POSTS.map((k) => [k.id, `${k.name} (${k.id} ${k.version})`]),
  );
  if (!(profile.post.id in postOptions)) {
    postOptions[profile.post.id] = `${f.postUnknown}: ${profile.post.id} ${profile.post.version}`;
  }
  // T309 (D-097): the park point needs G53 (machine coordinates) in the post.
  const parkPossible = postSupportsMachineCoordinates(profile.post.id);

  function update(mutate: (draft: MachineProfile) => void) {
    setServerIssues([]);
    setSaveError(false);
    setProfile((prev) => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  }

  function onParseError(path: string, error: NumberParseError | null) {
    setParseErrors((prev) => {
      if ((prev[path] ?? null) === error) return prev;
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== path));
      if (error) next[path] = error;
      return next;
    });
  }

  /** Focus the first invalid control in page order once the errors are rendered. */
  function focusFirstInvalid() {
    requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      el?.focus();
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setSaveError(false);
    const parsed = parseMachineProfile(profile);
    if (!parsed.ok || Object.keys(parseErrors).length > 0) {
      focusFirstInvalid();
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
      if (body?.error === 'invalid_profile') {
        setServerIssues(body.issues);
        focusFirstInvalid();
      } else setSaveError(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty) setLeaving({ href: null });
    else onCancel();
  }

  function confirmLeave() {
    const target = leaving;
    setLeaving(null);
    if (!target) return;
    if (target.href === null) onCancel();
    else if (target.href === 'back') {
      leavingNow.current = true;
      // The guard entry and the page's own entry: back to where the user came from.
      window.history.go(-2);
    } else {
      leavingNow.current = true;
      router.push(target.href);
    }
  }

  const e = (path: string) => errors[path];
  const num = (
    path: string,
    label: string,
    value: number,
    set: (p: MachineProfile, v: number) => void,
    unit?: string,
    help?: string,
  ) => (
    <NumberField
      path={path}
      label={label}
      help={help}
      unit={unit}
      value={value}
      error={e(path)}
      onParseError={onParseError}
      onChange={(v) => update((p) => set(p, v))}
    />
  );
  const s = t.form.sections;
  const h = t.form.sectionHints;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(ev) => void submit(ev)}
      className="flex flex-col gap-6"
      aria-labelledby="machine-form-title"
      data-testid="machine-form"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="machine-form-title"
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight"
          >
            {machineId ? t.form.editTitle : t.form.createTitle}
          </h2>
          {version !== undefined ? (
            <Badge>{t.form.versionBadge.replace('{version}', String(version))}</Badge>
          ) : null}
          {profile.example ? <Badge variant="warning">{t.example}</Badge> : null}
        </div>
        {profile.example ? (
          <p className="flex gap-2 rounded-lg border border-warning-border bg-warning-subtle p-3 text-sm text-warning-text">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.form.exampleNote}
          </p>
        ) : null}
        <p className="flex gap-2 text-sm text-fg-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.form.versionNote}
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
        <nav aria-label={t.form.sectionsIndex} className="hidden lg:block">
          <ol className="sticky top-20 flex flex-col gap-0.5 border-l border-border">
            {FORM_SECTIONS.map((id) => (
              <li key={id}>
                <a
                  href={`#sec-${id}`}
                  aria-current={active === id ? 'location' : undefined}
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.getElementById(`sec-${id}`)?.scrollIntoView({ block: 'start' });
                  }}
                  className={cn(
                    '-ml-px block border-l-2 py-1.5 pl-3 text-sm transition-colors duration-(--duration-fast)',
                    focusRing,
                    active === id
                      ? 'border-accent font-medium text-fg'
                      : 'border-transparent text-fg-muted hover:text-fg',
                  )}
                >
                  {s[id]}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          <Section id="identity" title={s.identity} hint={h.identity}>
            {machineId === null ? (
              <FormField
                id="machine-library"
                label={t.library.label}
                hint={t.library.hint}
                className="sm:col-span-2"
              >
                <Select
                  value={libraryId}
                  onValueChange={(id) => {
                    const next = controllerProfile(id, profile);
                    if (!next) return;
                    setLibraryId(id);
                    setServerIssues([]);
                    setSaveError(false);
                    setProfile(next);
                    const name = CONTROLLER_LIBRARY.find((c) => c.id === id)?.name ?? id;
                    notify.success(fill(t.library.applied, { name }));
                  }}
                >
                  <SelectTrigger id="machine-library" data-testid="machine-library">
                    <SelectValue placeholder={t.library.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTROLLER_LIBRARY.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
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

          <Section id="envelope" title={s.envelope} hint={h.envelope}>
            {num(
              'workEnvelope.x',
              f.envelopeX,
              profile.workEnvelope.x,
              (p, v) => void (p.workEnvelope.x = v),
              u.mm,
            )}
            {num(
              'workEnvelope.y',
              f.envelopeY,
              profile.workEnvelope.y,
              (p, v) => void (p.workEnvelope.y = v),
              u.mm,
            )}
            {num(
              'workEnvelope.z',
              f.envelopeZ,
              profile.workEnvelope.z,
              (p, v) => void (p.workEnvelope.z = v),
              u.mm,
            )}
            {num('safeZ', f.safeZ, profile.safeZ, (p, v) => void (p.safeZ = v), u.mm)}
            {num(
              'table.width',
              f.tableWidth,
              profile.table.width,
              (p, v) => void (p.table.width = v),
              u.mm,
            )}
            {num(
              'table.depth',
              f.tableDepth,
              profile.table.depth,
              (p, v) => void (p.table.depth = v),
              u.mm,
            )}
            {num(
              'rapidFeed',
              f.rapidFeed,
              profile.rapidFeed ?? TOOLPATH_DEFAULTS.rapidFeed,
              (p, v) => void (p.rapidFeed = v),
              u.feed,
              f.rapidFeedHelp,
            )}
          </Section>

          <Section id="origin" title={s.origin} hint={h.origin}>
            <CornerPicker
              id={fieldId('origin.corner')}
              label={f.corner}
              hint={t.form.corner.hint}
              front={t.form.corner.front}
              back={t.form.corner.back}
              value={profile.origin.corner}
              options={o.corner}
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
            {num(
              'origin.sheetOffset.x',
              f.sheetOffsetX,
              profile.origin.sheetOffset.x,
              (p, v) => void (p.origin.sheetOffset.x = v),
              u.mm,
            )}
            {num(
              'origin.sheetOffset.y',
              f.sheetOffsetY,
              profile.origin.sheetOffset.y,
              (p, v) => void (p.origin.sheetOffset.y = v),
              u.mm,
            )}
          </Section>

          <Section id="zZero" title={s.zZero} hint={h.zZero}>
            <SelectField
              path="zZero.reference"
              label={f.zReference}
              value={profile.zZero.reference}
              options={o.zReference}
              error={e('zZero.reference')}
              onChange={(v) => update((p) => void (p.zZero.reference = v))}
            />
            {num(
              'zZero.spoilboardAllowance',
              f.spoilboard,
              profile.zZero.spoilboardAllowance,
              (p, v) => void (p.zZero.spoilboardAllowance = v),
              u.mm,
              f.spoilboardHelp,
            )}
          </Section>

          <Section id="spindle" title={s.spindle} hint={h.spindle}>
            {num(
              'spindle.powerKw',
              f.powerKw,
              profile.spindle.powerKw,
              (p, v) => void (p.spindle.powerKw = v),
              u.kw,
            )}
            {num(
              'spindle.warmupSeconds',
              f.warmup,
              profile.spindle.warmupSeconds,
              (p, v) => void (p.spindle.warmupSeconds = v),
              u.s,
            )}
            {num(
              'spindle.minRpm',
              f.minRpm,
              profile.spindle.minRpm,
              (p, v) => void (p.spindle.minRpm = v),
              u.rpm,
            )}
            {num(
              'spindle.maxRpm',
              f.maxRpm,
              profile.spindle.maxRpm,
              (p, v) => void (p.spindle.maxRpm = v),
              u.rpm,
            )}
          </Section>

          <Section id="toolChanger" title={s.toolChanger} hint={h.toolChanger}>
            <SelectField
              path="toolChanger.type"
              label={f.changerType}
              value={profile.toolChanger.type}
              options={o.changerType}
              error={e('toolChanger.type')}
              onChange={(v) => update((p) => void (p.toolChanger.type = v))}
            />
            {num(
              'toolChanger.capacity',
              f.capacity,
              profile.toolChanger.capacity,
              (p, v) => void (p.toolChanger.capacity = v),
            )}
            <div className="sm:col-span-2">
              <CheckField
                path="toolChanger.lengthCompensation"
                label={f.g43}
                checked={profile.toolChanger.lengthCompensation}
                onChange={(v) => update((p) => void (p.toolChanger.lengthCompensation = v))}
              />
            </div>
            {profile.toolChanger.type === 'manual' && !parkPossible ? (
              <p className="text-xs text-fg-muted sm:col-span-2" data-testid="park-unavailable">
                {f.parkUnavailable}
              </p>
            ) : null}
            {profile.toolChanger.type === 'manual' && parkPossible ? (
              <>
                <div className="sm:col-span-2">
                  <CheckField
                    path="toolChanger.park.enabled"
                    label={f.park}
                    help={f.parkHelp}
                    checked={profile.toolChanger.park?.enabled ?? false}
                    onChange={(v) =>
                      update(
                        (p) =>
                          void (p.toolChanger.park = {
                            ...(p.toolChanger.park ?? { x: 0, y: 0 }),
                            enabled: v,
                          }),
                      )
                    }
                  />
                </div>
                {profile.toolChanger.park?.enabled ? (
                  <>
                    {num(
                      'toolChanger.park.x',
                      f.parkX,
                      profile.toolChanger.park.x,
                      (p, v) =>
                        void (p.toolChanger.park = {
                          enabled: true,
                          y: 0,
                          ...p.toolChanger.park,
                          x: v,
                        }),
                      u.mm,
                      f.parkXYHelp,
                    )}
                    {num(
                      'toolChanger.park.y',
                      f.parkY,
                      profile.toolChanger.park.y,
                      (p, v) =>
                        void (p.toolChanger.park = {
                          enabled: true,
                          x: 0,
                          ...p.toolChanger.park,
                          y: v,
                        }),
                      u.mm,
                    )}
                  </>
                ) : null}
              </>
            ) : null}
          </Section>

          <Section id="holdDown" title={s.holdDown} hint={h.holdDown}>
            <SelectField
              path="holdDown.type"
              label={f.holdDownType}
              value={profile.holdDown.type}
              options={o.holdDownType}
              error={e('holdDown.type')}
              onChange={(v) => update((p) => void (p.holdDown.type = v))}
            />
            <div className="hidden sm:block" />
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

          <Section id="post" title={s.post} hint={h.post}>
            <SelectField
              path="post.id"
              label={f.postId}
              help={f.postHelp}
              value={profile.post.id}
              options={postOptions}
              error={e('post.id') ?? e('post.version')}
              onChange={(v) =>
                update((p) => {
                  const known = KNOWN_POSTS.find((k) => k.id === v);
                  if (known) p.post = { id: known.id, version: known.version };
                  // T309: a post without G53 cannot park; the park is forced off.
                  if (p.toolChanger.park?.enabled && !postSupportsMachineCoordinates(p.post.id)) {
                    p.toolChanger.park = { ...p.toolChanger.park, enabled: false };
                  }
                })
              }
            />
          </Section>

          <Section id="constraints" title={s.constraints} hint={h.constraints}>
            {num(
              'constraints.maxFileNameLength',
              f.maxFileName,
              profile.constraints.maxFileNameLength,
              (p, v) => void (p.constraints.maxFileNameLength = v),
              u.chars,
            )}
            {num(
              'constraints.maxFileSizeMb',
              f.maxFileSize,
              profile.constraints.maxFileSizeMb,
              (p, v) => void (p.constraints.maxFileSizeMb = v),
              u.mb,
            )}
            <div className="flex flex-col gap-1 sm:col-span-2">
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

          <Section id="tools" title={s.tools} hint={h.tools} wide>
            <RowTable
              headers={[f.toolNumber, f.toolType, f.toolDiameter, f.fluteLength, f.flutes]}
              addLabel={t.form.add}
              removeLabel={t.form.remove}
              error={e('tools')}
              keys={toolRows.keys}
              testId="tools-table"
              onAdd={() => {
                toolRows.add();
                update((p) => {
                  const number = Math.min(99, Math.max(0, ...p.tools.map((x) => x.number)) + 1);
                  p.tools.push({
                    number,
                    type: 'flatEndMill',
                    diameter: 6,
                    fluteLength: 22,
                    flutes: 2,
                  });
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
                const cell = (
                  k: 'number' | 'diameter' | 'fluteLength' | 'flutes',
                  label: string,
                  unit?: string,
                ) => (
                  <NumberField
                    key={k}
                    compact
                    path={path(k)}
                    label={label}
                    unit={unit}
                    value={tool[k]}
                    error={e(path(k))}
                    onParseError={onParseError}
                    onChange={(v) => set((x) => void (x[k] = v))}
                  />
                );
                return [
                  cell('number', f.toolNumber),
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
                  cell('diameter', f.toolDiameter, u.mm),
                  cell('fluteLength', f.fluteLength, u.mm),
                  cell('flutes', f.flutes),
                ];
              }}
            />
          </Section>

          <Section id="materials" title={s.materials} hint={h.materials} wide>
            <RowTable
              headers={[
                f.material,
                f.thickness,
                f.feed,
                f.plungeFeed,
                f.rpm,
                f.stepDown,
                f.materialTool,
              ]}
              addLabel={t.form.add}
              removeLabel={t.form.remove}
              error={e('materials')}
              keys={materialRows.keys}
              testId="materials-table"
              dense
              onAdd={() => {
                materialRows.add();
                update((p) => void p.materials.push(newParamSet(p)));
              }}
              onRemove={(i) => {
                materialRows.remove(i);
                update((p) => void p.materials.splice(i, 1));
              }}
              renderRow={(i) => {
                const m = profile.materials[i] as MaterialParams;
                const path = (k: keyof MaterialParams) => `materials[${i}].${k}`;
                // D-046 / T265: an edited row is the user's own; the "copied from" and
                // "starting values" marks go away.
                const set = (fn: (x: MaterialParams) => void) =>
                  update((p) => {
                    const x = p.materials[i] as MaterialParams;
                    fn(x);
                    delete x.copiedFrom;
                    delete x.unverified;
                  });
                // T328 (D-120): kind, thickness or tool of a starting-value row not yet edited by
                // hand: the values follow the table. An edited row keeps its numbers.
                const choose = (fn: (x: MaterialParams) => void) =>
                  update((p) => {
                    const x = p.materials[i] as MaterialParams;
                    fn(x);
                    if (x.unverified) refreshStartingValues(p, x);
                    else delete x.copiedFrom;
                  });
                // T265: the headers carry the units, so the cells stay narrow and the whole row
                // (Paso, Takım no) fits without sideways scrolling at 1440.
                const cell = (
                  k: 'thickness' | 'feed' | 'plungeFeed' | 'rpm' | 'stepDown' | 'tool',
                  label: string,
                ) => (
                  <NumberField
                    key={k}
                    compact
                    narrow
                    path={path(k)}
                    label={label}
                    value={m[k]}
                    error={e(path(k))}
                    onParseError={onParseError}
                    onChange={(v) =>
                      k === 'thickness' || k === 'tool'
                        ? choose((x) => void (x[k] = v))
                        : set((x) => void (x[k] = v))
                    }
                  />
                );
                return [
                  <div key="m" className="flex min-w-0 flex-col gap-1">
                    <SelectField
                      compact
                      narrow
                      path={path('material')}
                      label={f.material}
                      value={m.material}
                      options={o.material}
                      error={e(path('material'))}
                      onChange={(v) => choose((x) => void (x.material = v))}
                    />
                  </div>,
                  cell('thickness', f.thickness),
                  cell('feed', f.feed),
                  cell('plungeFeed', f.plungeFeed),
                  cell('rpm', f.rpm),
                  cell('stepDown', f.stepDown),
                  cell('tool', f.materialTool),
                ];
              }}
              renderDetail={(i) => {
                const set = profile.materials[i] as MaterialParams;
                // B53 (CTO #5 / #7): the copied-set and starting-values notes span the row, under
                // the fields, instead of stretching the material cell.
                const clearMarks = () =>
                  update((p) => {
                    const x = p.materials[i] as MaterialParams;
                    delete x.copiedFrom;
                    delete x.unverified;
                  });
                return (
                  <div className="flex flex-col gap-2">
                    {set.copiedFrom ? (
                      <p
                        className="flex items-start gap-1 text-xs text-warning-text"
                        data-testid="material-copied-note"
                      >
                        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        {t.form.copiedFrom
                          .replace(
                            '{from}',
                            (o.material as Record<string, string>)[set.copiedFrom] ??
                              set.copiedFrom,
                          )
                          .replace('{thickness}', String(set.thickness).replace('.', ','))}
                      </p>
                    ) : null}
                    {set.unverified ? (
                      <div
                        className="flex flex-col items-start gap-1 text-xs text-warning-text"
                        data-testid="material-unverified-note"
                      >
                        {(() => {
                          // T328 (D-120): where the numbers come from, the material note and a
                          // tool hint (never a block).
                          const n = startingNote(profile, set);
                          const lines = [
                            n.kind === 'table'
                              ? fill(t.form.startingValue, { source: n.sources })
                              : n.kind === 'none'
                                ? t.form.startingNone
                                : t.form.unverified,
                            n.kind === 'none' || !n.note ? null : t.form.startingNotes[n.note],
                            n.hint ? t.form.toolFit[n.hint] : null,
                          ];
                          const ids = [
                            'material-starting-source',
                            'material-starting-note',
                            'material-tool-hint',
                          ];
                          return lines.map((text, k) =>
                            text ? (
                              <p
                                key={ids[k]}
                                className="flex items-start gap-1"
                                data-testid={ids[k]}
                                data-kind={k === 0 ? n.kind : undefined}
                              >
                                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                                {text}
                              </p>
                            ) : null,
                          );
                        })()}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="material-unverified-confirm"
                          onClick={clearMarks}
                        >
                          {t.form.unverifiedConfirm}
                        </Button>
                      </div>
                    ) : null}
                    <MaterialTabsDetail
                      t={t.form.tabs}
                      index={i}
                      set={set}
                      error={e}
                      onParseError={onParseError}
                      onChange={(fn) =>
                        update((p) => {
                          const x = p.materials[i] as MaterialParams;
                          fn(x);
                          delete x.copiedFrom;
                          delete x.unverified;
                        })
                      }
                    />
                  </div>
                );
              }}
            />
          </Section>
        </div>
      </div>

      {/* Sticky save bar: unsaved-changes state, errors and the actions, always in reach. */}
      <div
        ref={saveBar}
        data-testid="machine-save-bar"
        className="sticky bottom-4 z-10 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:px-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div aria-live="polite" className="flex min-w-0 items-center gap-2 text-sm">
            {saveError ? (
              <span className="font-medium text-danger-text">{t.form.saveError}</span>
            ) : hasErrors ? (
              <span className="flex items-center gap-1.5 font-medium text-danger-text">
                <CircleAlert aria-hidden className="size-4" />
                {t.form.hasErrors}
              </span>
            ) : saving ? (
              <span className="text-fg-muted">{t.form.saving}</span>
            ) : dirty ? (
              <span data-testid="machine-dirty" className="flex items-center gap-2 text-fg-muted">
                <span aria-hidden className="size-2 rounded-full bg-warning" />
                {t.form.status.dirty}
              </span>
            ) : (
              <span className="text-fg-muted">{t.form.status.clean}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={cancel}>
              {t.form.cancel}
            </Button>
            <Button type="submit" loading={saving}>
              {saving ? t.form.saving : t.form.save}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={leaving !== null} onOpenChange={(open) => !open && setLeaving(null)}>
        <AlertDialogContent data-testid="machine-leave-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.form.leave.title}</AlertDialogTitle>
            <AlertDialogDescription>{t.form.leave.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.form.leave.stay}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmLeave}>
              {t.form.leave.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

/** History-state key of the leave guard's extra entry. */
const GUARD_STATE = 'nittcamLeaveGuard';

function isGuardEntry(): boolean {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null && GUARD_STATE in state;
}

function RowTable(props: {
  headers: string[];
  addLabel: string;
  removeLabel: string;
  error: string | undefined;
  keys: number[];
  testId: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderRow: (index: number) => ReactNode[];
  /** T302: a full-width line under each row (the material set's tab defaults). */
  renderDetail?: (index: number) => ReactNode;
  /** Narrow cells and wrapping headers (T265, materials table). */
  dense?: boolean;
}) {
  const { headers, addLabel, removeLabel, error, keys, testId, onAdd, onRemove, renderRow } = props;
  const pad = props.dense ? 'px-2' : 'px-3';
  // Mobile UI pass (CTO #5, D-043) and B53 (CTO #5 / #6 / #7): where the dense table (materials,
  // 7 columns) does not fit its container (below 52 rem: the 1024 px desktop with the side index,
  // and phones) it turns into one card per row with the column name above each field, instead of
  // a sideways scroll. Container query, so the sidebar and the side index count. Cards are two
  // columns on phones and four from 32 rem.
  const cards = props.dense === true;
  const m = (cls: string) => (cards ? cls : '');
  return (
    <div className={`flex flex-col gap-3 ${m('@container')}`}>
      <div className="relative max-w-full overflow-x-auto rounded-lg border border-border">
        <table className={`w-full text-sm ${m('@max-[52rem]:block')}`} data-testid={testId}>
          <thead className={`bg-surface-subtle ${m('@max-[52rem]:sr-only')}`}>
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={`${pad} py-2 text-left align-bottom text-xs font-medium text-fg-muted ${props.dense ? '' : 'whitespace-nowrap'}`}
                >
                  {h}
                </th>
              ))}
              <th scope="col" className="w-12 px-3 py-2">
                <span className="sr-only">{removeLabel}</span>
              </th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-border-subtle ${m('@max-[52rem]:flex @max-[52rem]:flex-col @max-[52rem]:gap-2 @max-[52rem]:divide-y-0 @max-[52rem]:p-2')}`}
          >
            {keys.map((key, i) => (
              <Fragment key={key}>
                <tr
                  className={`${props.renderDetail ? 'border-b-0! ' : ''}align-top ${m('@max-[52rem]:grid @max-[52rem]:grid-cols-2 @min-[32rem]:@max-[52rem]:grid-cols-4 @max-[52rem]:gap-x-3 @max-[52rem]:gap-y-2 @max-[52rem]:rounded-lg @max-[52rem]:border @max-[52rem]:border-border-subtle @max-[52rem]:p-2')}`}
                  data-testid={cards ? `${testId}-row` : undefined}
                >
                  {renderRow(i).map((cell, c) => (
                    <td
                      key={c}
                      className={`${pad} py-2 ${m('@max-[52rem]:flex @max-[52rem]:min-w-0 @max-[52rem]:flex-col @max-[52rem]:gap-1 @max-[52rem]:p-0')} ${c === 0 ? m('@max-[52rem]:col-span-2') : ''}`}
                    >
                      {cards ? (
                        <span aria-hidden className="text-2xs text-fg-subtle @min-[52rem]:hidden">
                          {headers[c]}
                        </span>
                      ) : null}
                      {cell}
                    </td>
                  ))}
                  <td
                    className={`px-2 py-2 text-right ${m('@max-[52rem]:col-span-full @max-[52rem]:p-0')}`}
                  >
                    <IconButton
                      type="button"
                      size="sm"
                      aria-label={`${removeLabel} (${i + 1})`}
                      onClick={() => onRemove(i)}
                      className="hover:text-danger-text"
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </td>
                </tr>
                {props.renderDetail ? (
                  <tr data-detail="" className={m('@max-[52rem]:block')}>
                    <td
                      colSpan={headers.length + 1}
                      className={`${pad} pt-0 pb-3 ${m('@max-[52rem]:block @max-[52rem]:p-0')}`}
                    >
                      {props.renderDetail(i)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="text-xs font-medium text-danger-text">{error}</p> : null}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * T302 (CTO #12 E3, §3.6 "tab ayarı varsayılanları"): the set's tab defaults under its row. Off =
 * no `tabs` in the set (older profiles stay as they are) and the built-in default applies; on =
 * count, width and height with the T293 bounds, which the save checks (`materialTabIssues`).
 */
function MaterialTabsDetail({
  t,
  index,
  set,
  error,
  onParseError,
  onChange,
}: {
  t: Text['form']['tabs'];
  index: number;
  set: MaterialParams;
  error: (path: string) => string | undefined;
  onParseError: (path: string, error: NumberParseError | null) => void;
  onChange: (fn: (x: MaterialParams) => void) => void;
}) {
  const path = (k: string) => `materials[${index}].tabs${k ? `.${k}` : ''}`;
  const thickness = Number.isFinite(set.thickness) && set.thickness > 0 ? set.thickness : 0;
  const builtIn = {
    count: TAB_DEFAULTS.count,
    width: TAB_DEFAULTS.width,
    height: thickness > 0 ? defaultTabHeight(thickness) : TAB_DEFAULTS.materialLeft,
  };
  const nf = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');
  const tabs = set.tabs;
  return (
    <fieldset
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2"
      data-testid={`material-tabs-${index}`}
    >
      <legend className="sr-only">{t.title}</legend>
      <CheckField
        path={path('')}
        label={t.own}
        help={
          tabs
            ? t.ownHint
            : fill(t.defaultHint, {
                count: builtIn.count,
                width: nf(builtIn.width),
                height: nf(builtIn.height),
              })
        }
        checked={!!tabs}
        onChange={(on) =>
          onChange((x) => {
            if (on) x.tabs = { ...builtIn };
            else delete x.tabs;
          })
        }
      />
      {tabs ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
          <NumberField
            path={path('count')}
            label={t.count}
            help={t.countHelp}
            value={tabs.count}
            maxDecimals={0}
            error={error(path('count'))}
            onParseError={onParseError}
            onChange={(v) => onChange((x) => void (x.tabs = { ...(x.tabs ?? builtIn), count: v }))}
          />
          <NumberField
            path={path('width')}
            label={t.width}
            help={fill(t.widthHelp, { min: nf(TAB_BOUNDS.minWidth) })}
            value={tabs.width}
            error={error(path('width'))}
            onParseError={onParseError}
            onChange={(v) => onChange((x) => void (x.tabs = { ...(x.tabs ?? builtIn), width: v }))}
          />
          <NumberField
            path={path('height')}
            label={t.height}
            help={fill(t.heightHelp, {
              min: nf(TAB_BOUNDS.minHeight),
              max: nf(Math.max(TAB_BOUNDS.minHeight, maxTabHeight(thickness))),
            })}
            value={tabs.height}
            error={error(path('height'))}
            onParseError={onParseError}
            onChange={(v) => onChange((x) => void (x.tabs = { ...(x.tabs ?? builtIn), height: v }))}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
