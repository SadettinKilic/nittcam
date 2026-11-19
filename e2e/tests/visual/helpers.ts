// Visual QA harness (T102, D-032, spec §11): screenshots and axe checks for every screen.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Storage key of next-themes (packages/ui/src/theme.tsx). */
const THEME_KEY = 'nittcam-theme';

const SCREENSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '__screenshots__');

/** Baselines are compared only on Linux (CI): font rendering differs on other systems. */
export const compareBaselines = process.platform === 'linux';

/** Picks the theme before any page script runs (no flash, no toggle click). */
export async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage blocked: next-themes falls back to the system theme */
      }
    },
    [THEME_KEY, theme] as const,
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
}

/** Freezes transitions, animations and the caret for captures (on top of reduced motion). */
// Toasts are transient (4 s) and would make captures timing-dependent (B7: the paste toast), so
// captures never include them.
const FREEZE_CSS =
  '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' +
  '[data-sonner-toaster]{display:none!important}';

/**
 * Waits until the page is stable so captures are deterministic (T199a; B4a lost hours to flaky
 * captures): network idle, web fonts loaded, no pending autosave (the wizard's save badge),
 * canvases sized (data-scale set), animations frozen, the page (window and the shell content) scrolled to 0,0,
 * then two quiet frames.
 */
/**
 * keepScroll: anchored overlays (menu, popover, select) open next to a trigger far down the page
 * and stay there; scrolling to the top would capture the page without them (B4b round 4).
 */
export async function settle(page: Page, keepScroll = false): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.waitForFunction(() => {
    const save = document.querySelector('[data-testid=save-status]');
    const state = save?.getAttribute('data-state');
    if (state === 'saving' || state === 'pending' || state === 'dirty') return false;
    const canvases = document.querySelectorAll(
      '[data-testid=layout-canvas],[data-testid=sim-canvas]',
    );
    return Array.from(canvases).every((c) => c.getAttribute('data-scale'));
  });
  await page.evaluate(async (keep) => {
    await document.fonts.ready;
    if (!keep) {
      window.scrollTo(0, 0);
      document.getElementById('content')?.scrollTo(0, 0);
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, keepScroll);
}

/**
 * Takes a review screenshot `e2e/__screenshots__/<name>.png` (every platform) and, on Linux,
 * compares the page against the baseline `e2e/visual-baselines/<name>.png` (unless `baseline: false`).
 */
export async function snap(
  page: Page,
  name: string,
  opts: { fullPage?: boolean; baseline?: boolean; keepScroll?: boolean } = {},
): Promise<void> {
  const fullPage = opts.fullPage ?? true;
  await settle(page, opts.keepScroll);
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
  // baseline: false = review capture only (pages whose data is shared with other tests).
  if (compareBaselines && opts.baseline !== false) {
    // Soft: a diff fails the test but later captures still run, so one CI run yields every
    // candidate baseline of a multi-step test (B4b round 2).
    await expect.soft(page).toHaveScreenshot(`${name}.png`, { fullPage });
  }
}

export interface A11yOptions {
  /** CSS selectors to leave out (e.g. a third-party canvas). */
  exclude?: string[];
  /** Only check inside this selector. */
  include?: string;
}

/** Runs axe (WCAG 2.1 A/AA); serious and critical violations fail the test. */
export async function expectNoA11yViolations(page: Page, opts: A11yOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (opts.include) builder = builder.include(opts.include);
  for (const sel of opts.exclude ?? []) builder = builder.exclude(sel);
  const { violations } = await builder.analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = blocking
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help}\n` +
        v.nodes
          .slice(0, 5)
          .map((n) => `    ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`)
          .join('\n'),
    )
    .join('\n');
  expect(blocking, `axe found serious/critical violations:\n${report}`).toEqual([]);
}
