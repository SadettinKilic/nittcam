import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste, pickOption, projectId } from './wizard-helpers';

/**
 * T182: Ayarlar → Genel (company name, logo upload limits, new-project defaults) and Ayarlar →
 * DXF katmanları (layer mapping editor). Company settings are shared state: every test puts the
 * values back in `finally`.
 */
const g = tr.settings.general;
const d = tr.settings.dxf;
const BUILT_IN = {
  gap: 8,
  margin: 10,
  tabMode: 'all',
  leadIn: 'arc',
  direction: 'climb',
  dimensionMode: 'cut',
};
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function axeClean(page: Page, include: string) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include(include)
    .analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

test('defaults saved in Ayarlar are what a new project starts with', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = (await (await request.get('/api/settings')).json()) as { defaults?: unknown };
  try {
    await page.goto('/ayarlar');
    await expect(
      page.getByTestId('settings-nav').getByRole('link', { name: tr.settings.nav.general }),
    ).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('settings-default-gap').fill('4');
    await page.getByTestId('settings-default-margin').fill('12');
    await pickOption(page.getByTestId('settings-default-tabs'), g.defaults.tabModes.small);
    await pickOption(page.getByTestId('settings-default-leadin'), g.defaults.leadIns.line);
    await pickOption(
      page.getByTestId('settings-default-direction'),
      g.defaults.directions.conventional,
    );
    await pickOption(
      page.getByTestId('settings-default-dimension'),
      g.defaults.dimensionModes.finished,
    );
    await axeClean(page, '[data-testid="settings-general"]');
    await page.getByTestId('settings-default-save').click();
    await expect(page.getByText(g.defaults.saved)).toBeVisible();

    // persisted
    await page.reload();
    await expect(page.getByTestId('settings-default-gap')).toHaveValue('4');
    await expect(page.getByTestId('settings-default-tabs')).toHaveAttribute('data-value', 'small');

    // a new project starts with them (stored on its first change)
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const id = await projectId(page);
    const { project } = (await (await request.get(`/api/projects/${id}`)).json()) as {
      project: {
        nesting: { gap: number; margin: number };
        cutting: { tabs: { auto: boolean }; leadIn: string; direction: string };
        settings: { dimensionMode: string };
      };
    };
    expect(project.nesting).toMatchObject({ gap: 4, margin: 12 });
    expect(project.cutting).toMatchObject({
      tabs: { auto: false },
      leadIn: 'line',
      direction: 'conventional',
    });
    expect(project.settings.dimensionMode).toBe('finished');
  } finally {
    await request.patch('/api/settings', { data: { defaults: before.defaults ?? BUILT_IN } });
  }
});

test('company name and logo: limits, upload, remove', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = (await (await request.get('/api/settings')).json()) as { name: string };
  try {
    await page.goto('/ayarlar');
    const name = page.getByTestId('settings-company-name');
    await name.fill('Usta Mobilya');
    await page.getByTestId('settings-company-save').click();
    await expect(page.getByText(g.company.saved)).toBeVisible();

    const file = page.getByTestId('settings-logo-file');
    await file.setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    });
    await expect(page.getByTestId('settings-logo-error')).toHaveText(g.logo.problems.type);
    const big = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
    await file.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: big });
    await expect(page.getByTestId('settings-logo-error')).toHaveText(g.logo.problems.size);

    await file.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(
      page.getByTestId('settings-logo-preview').getByRole('img', { name: g.logo.alt }),
    ).toBeVisible();
    await expect(page.getByTestId('settings-logo-error')).toHaveCount(0);

    await page.reload();
    await expect(name).toHaveValue('Usta Mobilya');
    await expect(page.getByTestId('settings-logo-preview').getByRole('img')).toBeVisible();
    await page.getByTestId('settings-logo-remove').click();
    await expect(page.getByTestId('settings-logo-preview')).toContainText(g.logo.none);
  } finally {
    await request.patch('/api/settings', { data: { name: before.name } });
    await request.delete('/api/settings/logo');
  }
});

test('DXF layer mapping editor: add, duplicate check, save, reload', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = (await (await request.get('/api/settings/dxf-layers')).json()) as {
    map?: unknown;
  };
  try {
    await request.put('/api/settings/dxf-layers', { data: { map: {} } });
    await page.goto('/ayarlar/dxf');
    await expect(page.getByTestId('dxf-layers-empty')).toBeVisible();
    await page.getByTestId('dxf-layer-add').click();
    await page.getByTestId('dxf-layer-name').last().fill('Kesim');
    await page.getByTestId('dxf-layer-add').click();
    await page.getByTestId('dxf-layer-name').last().fill('KESIM');
    await expect(page.getByTestId('dxf-layer-error').first()).toHaveText(d.duplicate);
    await pickOption(page.getByTestId('dxf-layer-op').last(), tr.dxfImport.layers.ops.drill);
    await page.getByTestId('dxf-layer-name').last().fill('Delik');
    await expect(page.getByTestId('dxf-layer-error')).toHaveCount(0);
    await axeClean(page, '[data-testid="settings-dxf"]');
    await page.getByTestId('dxf-layers-save').click();
    await expect(page.getByText(d.saved)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('dxf-layer-name')).toHaveCount(2);
    await expect(page.getByTestId('dxf-layer-name').first()).toHaveValue('DELIK');
    const map = (await (await request.get('/api/settings/dxf-layers')).json()) as unknown;
    expect(map).toEqual({ map: { DELIK: 'drill', KESIM: 'outside' } });

    // Malzemeler is one of the sections
    await page
      .getByTestId('settings-nav')
      .getByRole('link', { name: tr.settings.nav.materials })
      .click();
    await expect(page).toHaveURL(/\/ayarlar\/malzemeler$/);
  } finally {
    await request.put('/api/settings/dxf-layers', { data: { map: before.map ?? {} } });
  }
});
