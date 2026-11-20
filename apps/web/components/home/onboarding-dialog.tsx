'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  buttonVariants,
  cn,
} from '@nittcam/ui';
import { ArrowLeft, ArrowRight, Box, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fill, newPartId } from '../../lib/draft-project';
import type { MachineDetail, MachineListItem } from '../../lib/machines-api';
import { fetchMaterials } from '../../lib/materials-api';
import {
  ONBOARDING_PAGES,
  ONBOARDING_PARAM,
  type OnboardingMessages,
  browserStorage,
  rememberOnboardingDone,
  shouldOpenOnboarding,
} from '../../lib/onboarding';
import type { ProjectDetail } from '../../lib/projects-api';
import { buildSampleProject, pickSampleMachine } from '../../lib/sample-project';
import { STEPS } from '../../lib/wizard-steps';
import { Callout } from '../wizard/panels';

type SampleState =
  { status: 'idle' } | { status: 'busy' } | { status: 'error'; noMachine: boolean };

/** Creates the sample project (T184, D-075) and returns its id; throws on any failure. */
async function createSample(messages: OnboardingMessages): Promise<string> {
  const list = await fetch('/api/machines', { cache: 'no-store' });
  if (!list.ok) throw new Error(String(list.status));
  const machine = pickSampleMachine((await list.json()) as MachineListItem[]);
  if (!machine) throw new NoMachine();
  const res = await fetch(`/api/machines/${encodeURIComponent(machine.id)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(String(res.status));
  const detail = (await res.json()) as MachineDetail;
  const library = (await fetchMaterials()) ?? [];
  const t = messages.onboarding;
  const built = buildSampleProject(
    { id: machine.id, version: detail.version, profile: detail.profile },
    library,
    { group: t.sampleGroup, roles: messages.roles },
    newPartId,
    new Date().toISOString(),
  );
  if (!built) throw new Error('sample');
  const created = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      name: t.sampleName,
      project: built.project,
      commands: built.commands,
    }),
  });
  if (!created.ok) throw new Error(String(created.status));
  return ((await created.json()) as ProjectDetail).id;
}

class NoMachine extends Error {}

/**
 * First-run tour (T184, spec §4.2): welcome, the five wizard steps, and a start page that opens
 * the sample project, a blank project or nothing. Opens by itself once per browser; `/?tanitim=1`
 * (Ayarlar) opens it again. Any close (Esc, "Tanıtımı geç", a start choice) marks it as seen.
 */
export function OnboardingDialog({ messages }: { messages: OnboardingMessages }) {
  const t = messages.onboarding;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [sample, setSample] = useState<SampleState>({ status: 'idle' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reopen = params.has(ONBOARDING_PARAM);
    if (reopen) {
      params.delete(ONBOARDING_PARAM);
      const q = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
    }
    if (shouldOpenOnboarding(browserStorage, reopen)) {
      // Opening after mount keeps the server render free of the dialog (no hydration mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, []);

  function close() {
    rememberOnboardingDone(browserStorage);
    setOpen(false);
    setPage(0);
  }

  async function openSample() {
    setSample({ status: 'busy' });
    try {
      const id = await createSample(messages);
      rememberOnboardingDone(browserStorage);
      router.push(`/projeler/${id}`);
    } catch (err) {
      setSample({ status: 'error', noMachine: err instanceof NoMachine });
    }
  }

  const key = ONBOARDING_PAGES[page] ?? 'welcome';
  const last = page === ONBOARDING_PAGES.length - 1;
  const busy = sample.status === 'busy';
  const title =
    key === 'welcome' ? t.welcome.title : key === 'steps' ? t.steps.title : t.start.title;
  const text = key === 'welcome' ? t.welcome.text : key === 'steps' ? t.steps.text : t.start.text;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : busy ? undefined : close())}>
      <DialogContent
        size="lg"
        closeLabel={t.close}
        aria-label={t.title}
        data-testid="onboarding-dialog"
        data-page={key}
      >
        <DialogHeader>
          <p className="text-fg-muted text-xs font-medium" data-testid="onboarding-progress">
            {fill(t.stepOf, { n: page + 1, total: ONBOARDING_PAGES.length })}
          </p>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </DialogHeader>

        {key === 'welcome' ? (
          <ul className="text-fg flex list-disc flex-col gap-2 pl-5 text-sm">
            {t.welcome.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        {key === 'steps' ? (
          <ol className="flex flex-col gap-2" data-testid="onboarding-steps">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className="border-border-subtle bg-surface-subtle flex items-start gap-3 rounded-lg border p-3"
              >
                <span
                  aria-hidden
                  className="bg-accent-subtle text-accent-text flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                >
                  {i + 1}
                </span>
                <span className="text-sm">
                  <span className="text-fg font-medium">{messages.stepNames[s]}</span>
                  <span className="text-fg-muted block">{t.steps.items[s]}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {key === 'start' ? (
          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              className="justify-start"
              onClick={openSample}
              disabled={busy}
              data-testid="onboarding-sample"
              aria-describedby="onboarding-sample-hint"
            >
              {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Box aria-hidden />}
              {busy ? t.start.busy : t.start.sample}
            </Button>
            <p id="onboarding-sample-hint" className="text-fg-muted -mt-1 text-xs">
              {t.start.sampleHint}
            </p>
            {sample.status === 'error' ? (
              <Callout tone="danger" data-testid="onboarding-sample-error">
                {sample.noMachine ? t.start.noMachine : t.start.error}
              </Callout>
            ) : null}
            <Link
              href="/projeler/yeni"
              onClick={() => rememberOnboardingDone(browserStorage)}
              className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'justify-start')}
              data-testid="onboarding-blank"
            >
              {t.start.blank}
            </Link>
          </div>
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          {last ? (
            <Button variant="ghost" onClick={close} disabled={busy} data-testid="onboarding-later">
              {t.start.later}
            </Button>
          ) : (
            <Button variant="ghost" onClick={close} data-testid="onboarding-skip">
              {t.skip}
            </Button>
          )}
          <div className="flex gap-2">
            {page > 0 ? (
              <Button
                variant="secondary"
                onClick={() => setPage(page - 1)}
                disabled={busy}
                data-testid="onboarding-back"
              >
                <ArrowLeft aria-hidden />
                {t.back}
              </Button>
            ) : null}
            {!last ? (
              <Button onClick={() => setPage(page + 1)} data-testid="onboarding-next" autoFocus>
                {t.next}
                <ArrowRight aria-hidden />
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
