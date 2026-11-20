'use client';

import { RadioGroup, RadioGroupItem, Switch, ThemeSwitcher, cn } from '@nittcam/ui';
import { useId, useSyncExternalStore } from 'react';
import { PageHeader, pageContainer } from '../../../components/page/page-header';
import { SettingsCard } from '../../../components/settings/settings-card';
import { ShortcutGroups } from '../../../components/shell/shortcuts-dialog';
import type { Messages } from '../../../lib/messages';
import {
  DENSITIES,
  setDensity,
  setMotion,
  setSimple3d,
  useDensity,
  useMotionChoice,
  useSimple3d,
  type Density,
} from '../../../lib/preferences';
import { useMediaQuery } from '../../../lib/use-media-query';

type Text = Messages['settings']['appearance'];

const noop = () => () => {};
/** False on the server and during hydration: stored choices are only known on the client. */
function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/**
 * Ayarlar → Görünüm (T183, spec §3.7): theme, density, 3D simple mode, reduced motion and the
 * shortcut list. Every change applies at once and is kept in this browser (D-074).
 */
export function AppearanceView({
  t,
  theme,
  shortcuts,
}: {
  t: Text;
  theme: Messages['shell']['theme'];
  shortcuts: Messages['shortcuts'];
}) {
  const mounted = useMounted();
  const density = useDensity();
  const motion = useMotionChoice();
  const simple = useSimple3d();
  const osReduces = useMediaQuery('(prefers-reduced-motion: reduce)', false);
  const ids = { density: useId(), simple: useId(), motion: useId() };

  return (
    <main className={`${pageContainer} gap-6`} data-testid="settings-appearance">
      <PageHeader title={t.title} description={t.subtitle} />
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <SettingsCard title={t.themeTitle} hint={t.themeHint}>
          <ThemeSwitcher labels={{ ...theme, group: theme.label }} className="w-fit" />
        </SettingsCard>

        <SettingsCard title={t.densityTitle} hint={t.densityHint}>
          <RadioGroup
            aria-labelledby={ids.density}
            value={mounted ? density : ''}
            onValueChange={(v) => setDensity(v as Density)}
            data-testid="appearance-density"
            className="gap-3"
          >
            <span id={ids.density} className="sr-only">
              {t.densityTitle}
            </span>
            {DENSITIES.map((d) => (
              <label
                key={d}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3',
                  'has-[[data-state=checked]]:border-accent-border has-[[data-state=checked]]:bg-accent-subtle',
                )}
              >
                <RadioGroupItem value={d} data-testid={`density-${d}`} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-fg">{t[d]}</span>
                  <span className="text-xs text-fg-muted">{t[`${d}Hint`]}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </SettingsCard>

        <SettingsCard title={t.previewTitle}>
          <ToggleRow
            id={ids.simple}
            label={t.simple3d}
            hint={t.simple3dHint}
            checked={mounted && simple}
            onChange={setSimple3d}
            testId="appearance-simple3d"
          />
        </SettingsCard>

        <SettingsCard title={t.motionTitle}>
          <ToggleRow
            id={ids.motion}
            label={t.reduceMotion}
            hint={t.reduceMotionHint}
            checked={mounted && motion === 'reduce'}
            onChange={(on) => setMotion(on ? 'reduce' : 'system')}
            testId="appearance-reduce-motion"
          />
          {mounted && osReduces && motion !== 'reduce' ? (
            <p className="text-xs text-fg-muted" data-testid="appearance-os-motion">
              {t.reduceMotionSystem}
            </p>
          ) : null}
        </SettingsCard>

        <SettingsCard title={t.shortcutsTitle} hint={t.shortcutsHint} className="lg:col-span-2">
          <div data-testid="appearance-shortcuts" className="grid gap-5 lg:grid-cols-2">
            <ShortcutGroups t={shortcuts} prefix="settings-shortcut" />
          </div>
        </SettingsCard>
      </div>
    </main>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={`${id}-hint`}
        checked={checked}
        onCheckedChange={onChange}
        data-testid={testId}
      />
    </div>
  );
}
