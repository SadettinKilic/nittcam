'use client';

import {
  BUILT_IN_PROJECT_DEFAULTS,
  PROJECT_DEFAULT_MM_MAX,
  projectDefaultsSchema,
  type ProjectDefaults,
} from '@nittcam/core';
import {
  Button,
  ErrorState,
  FormField,
  Input,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  notify,
} from '@nittcam/ui';
import { ArrowRight, ImageOff, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PageHeader, focusRing, pageContainer } from '../../components/page/page-header';
import { OnboardingSettingsCard } from '../../components/settings/onboarding-card';
import { SettingsCard } from '../../components/settings/settings-card';
import { setCompanyBrand } from '../../lib/company-brand';
import { LOGO_ACCEPT, logoProblem, type LogoProblem } from '../../lib/logo';
import type { Messages } from '../../lib/messages';
import { COMPANY_NAME_MAX, type CompanySettings } from '../../lib/settings-api';

type Text = Messages['settings'];

type Load =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: CompanySettings };

/** Ayarlar → Genel (T182, spec §3.4): company name and logo, new-project defaults. */
export function GeneralView({
  t,
  onboarding,
}: {
  t: Text;
  onboarding: Messages['onboarding']['settings'];
}) {
  const g = t.general;
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchSettings = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setLoad({ status: 'ready', data: (await res.json()) as CompanySettings });
    } catch {
      setLoad({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    // Initial fetch; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSettings();
  }, [fetchSettings]);

  return (
    <main className={`${pageContainer} gap-6`} data-testid="settings-general">
      <PageHeader title={g.title} description={g.subtitle} />
      {load.status === 'loading' ? (
        <div role="status" className="flex flex-col gap-4">
          <span className="sr-only">{t.loadError}</span>
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : load.status === 'error' ? (
        <ErrorState title={t.loadError} onRetry={() => void fetchSettings()} retryLabel={t.retry} />
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <CompanyCard t={g} data={load.data} />
          <DefaultsCard t={g.defaults} initial={load.data.defaults} />
          <SettingsCard title={g.defaults.materialsTitle} className="lg:col-span-2">
            <p className="text-sm text-fg-muted">{g.defaults.materialsHint}</p>
            <Link
              href="/ayarlar/malzemeler"
              data-testid="settings-materials-link"
              className={`inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent-text hover:underline ${focusRing}`}
            >
              {g.defaults.materialsLink}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
            {/* T302: the tab sizes live in each machine's material sets. */}
            <Link
              href="/makineler"
              data-testid="settings-machines-link"
              className={`inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-accent-text hover:underline ${focusRing}`}
            >
              {g.defaults.machinesLink}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </SettingsCard>
          <OnboardingSettingsCard t={onboarding} className="lg:col-span-2" />
        </div>
      )}
    </main>
  );
}

function CompanyCard({ t, data }: { t: Text['general']; data: CompanySettings }) {
  const c = t.company;
  const l = t.logo;
  const [name, setName] = useState(data.name);
  const [savedName, setSavedName] = useState(data.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState(data.logoUrl);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveName(ev: FormEvent) {
    ev.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > COMPANY_NAME_MAX) return setNameError(c.invalid);
    setNameError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as CompanySettings;
      setName(body.name);
      setSavedName(body.name);
      setCompanyBrand({ name: body.name, logoUrl: body.logoUrl });
      notify.success(c.saved);
    } catch {
      notify.error(c.failed);
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const problem = logoProblem(bytes);
    if (problem) return setLogoError(l.problems[problem]);
    setLogoError(null);
    setLogoBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/settings/logo', { method: 'POST', body: form });
      const body = (await res.json().catch(() => null)) as {
        logoUrl?: string;
        error?: LogoProblem;
      } | null;
      if (!res.ok || !body?.logoUrl) {
        const key = body?.error;
        setLogoError(key && key in l.problems ? l.problems[key] : l.problems.failed);
        return;
      }
      setLogoUrl(body.logoUrl);
      setCompanyBrand({ logoUrl: body.logoUrl });
      notify.success(l.uploaded);
    } catch {
      setLogoError(l.problems.failed);
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      const res = await fetch('/api/settings/logo', { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      setLogoUrl(null);
      setCompanyBrand({ logoUrl: null });
      setLogoError(null);
      notify.success(l.removed);
    } catch {
      setLogoError(l.problems.failed);
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <SettingsCard title={c.title}>
      <form onSubmit={(ev) => void saveName(ev)} noValidate className="flex flex-col gap-3">
        <FormField label={c.name} hint={c.nameHint} error={nameError}>
          <Input
            data-testid="settings-company-name"
            value={name}
            maxLength={COMPANY_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            autoComplete="organization"
          />
        </FormField>
        <Button
          type="submit"
          size="sm"
          className="self-start"
          loading={saving}
          disabled={saving || name.trim() === savedName}
          data-testid="settings-company-save"
        >
          {c.save}
        </Button>
      </form>
      <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-fg">{l.title}</h3>
          <p className="text-xs text-fg-muted">{l.hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-surface-subtle"
            data-testid="settings-logo-preview"
          >
            {logoUrl ? (
              // A user-uploaded image of unknown size: next/image would need a loader config.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={l.alt} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                <ImageOff aria-hidden className="size-4" />
                {l.none}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-testid="settings-logo-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={logoBusy}
              disabled={logoBusy}
              onClick={() => fileRef.current?.click()}
              data-testid="settings-logo-upload"
            >
              <Upload aria-hidden />
              {logoUrl ? l.replace : l.choose}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={logoBusy}
                onClick={() => void removeLogo()}
                data-testid="settings-logo-remove"
              >
                <Trash2 aria-hidden />
                {l.remove}
              </Button>
            ) : null}
          </div>
        </div>
        {logoError ? (
          <p role="alert" className="text-sm text-danger-text" data-testid="settings-logo-error">
            {logoError}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}

type DefaultsText = Text['general']['defaults'];
/** The form values: a cleared number field is null until it is filled again. */
type DefaultsForm = Omit<ProjectDefaults, 'gap' | 'margin'> & {
  gap: number | null;
  margin: number | null;
};

function DefaultsCard({ t, initial }: { t: DefaultsText; initial: ProjectDefaults }) {
  const [v, setV] = useState<DefaultsForm>(initial);
  const [saved, setSaved] = useState<ProjectDefaults>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const parsed = projectDefaultsSchema.safeParse(v);
    if (!parsed.success) return setError(t.invalid);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaults: parsed.data }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as CompanySettings;
      setV(body.defaults);
      setSaved(body.defaults);
      notify.success(t.saved);
    } catch {
      notify.error(t.failed);
    } finally {
      setBusy(false);
    }
  }

  const mm = (key: 'gap' | 'margin') => (
    <FormField label={t[key]}>
      <NumberInput
        data-testid={`settings-default-${key}`}
        value={v[key]}
        onValueChange={(n) => setV((x) => ({ ...x, [key]: n }))}
        min={0}
        max={PROJECT_DEFAULT_MM_MAX}
        step={0.5}
        unit="mm"
        required
      />
    </FormField>
  );

  return (
    <SettingsCard title={t.title} hint={t.hint}>
      <form onSubmit={(ev) => void save(ev)} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {mm('gap')}
          {mm('margin')}
          <Choice
            label={t.tabs}
            testId="settings-default-tabs"
            value={v.tabMode}
            options={t.tabModes}
            onChange={(tabMode) => setV((x) => ({ ...x, tabMode }))}
          />
          <Choice
            label={t.leadIn}
            testId="settings-default-leadin"
            value={v.leadIn}
            options={t.leadIns}
            onChange={(leadIn) => setV((x) => ({ ...x, leadIn }))}
          />
          <Choice
            label={t.direction}
            testId="settings-default-direction"
            value={v.direction}
            options={t.directions}
            onChange={(direction) => setV((x) => ({ ...x, direction }))}
          />
          <Choice
            label={t.dimensionMode}
            testId="settings-default-dimension"
            value={v.dimensionMode}
            options={t.dimensionModes}
            onChange={(dimensionMode) => setV((x) => ({ ...x, dimensionMode }))}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger-text" data-testid="settings-default-error">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            loading={busy}
            disabled={busy || !dirty}
            data-testid="settings-default-save"
          >
            {t.save}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || JSON.stringify(v) === JSON.stringify(BUILT_IN_PROJECT_DEFAULTS)}
            onClick={() => setV({ ...BUILT_IN_PROJECT_DEFAULTS })}
            data-testid="settings-default-reset"
          >
            {t.reset}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

function Choice<T extends string>({
  label,
  testId,
  value,
  options,
  onChange,
}: {
  label: string;
  testId: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <FormField id={id} label={label}>
      <Select value={value} onValueChange={(x) => onChange(x as T)}>
        <SelectTrigger id={id} data-testid={testId} data-value={value}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(options) as T[]).map((k) => (
            <SelectItem key={k} value={k}>
              {options[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
