import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste, projectId } from './wizard-helpers';

/**
 * Tester (B38, T182): new-project defaults reach only new projects (an open project keeps its
 * values), tab sizes are not part of them (they follow the material set, D-069); the DXF layer
 * editor does not save an empty name. Company settings are shared state: put back in `finally`.
 */
const d = tr.settings.dxf;
const BUILT_IN = {
  gap: 8,
  margin: 10,
  tabMode: 'all',
  leadIn: 'arc',
  direction: 'climb',
  dimensionMode: 'cut',
};

interface Stored {
  project: {
    nesting: { gap: number; margin: number };
    cutting: { tabs: Record<string, unknown>; leadIn: string; direction: string };
  };
}

test('changed defaults leave an existing project alone; tab sizes are not defaults', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = (await (await request.get('/api/settings')).json()) as { defaults?: unknown };
  try {
    expect((await request.patch('/api/settings', { data: { defaults: BUILT_IN } })).ok()).toBe(
      true,
    );
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const oldId = await projectId(page);
    const old = (await (await request.get(`/api/projects/${oldId}`)).json()) as Stored;
    expect(old.project.nesting).toMatchObject({ gap: 8, margin: 10 });

    const changed = { ...BUILT_IN, gap: 3, margin: 15, leadIn: 'line', direction: 'conventional' };
    expect((await request.patch('/api/settings', { data: { defaults: changed } })).ok()).toBe(true);
    // A tab size is not a company default: refused or ignored, never stored.
    const withTab = await request.patch('/api/settings', {
      data: { defaults: { ...changed, tabWidth: 1 } },
    });
    const now = (await (await request.get('/api/settings')).json()) as {
      defaults: Record<string, unknown>;
    };
    expect(now.defaults).not.toHaveProperty('tabWidth');
    expect([200, 400]).toContain(withTab.status());

    // The open project reloads with its own values.
    await page.reload();
    await expect(page.getByTestId('project-name')).toBeVisible({ timeout: 30_000 });
    const again = (await (await request.get(`/api/projects/${oldId}`)).json()) as Stored;
    expect(again.project.nesting).toEqual(old.project.nesting);
    expect(again.project.cutting).toEqual(old.project.cutting);

    // A new project gets the new defaults, with no tab width / height of its own.
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const newId = await projectId(page);
    expect(newId).not.toBe(oldId);
    const made = (await (await request.get(`/api/projects/${newId}`)).json()) as Stored;
    expect(made.project.nesting).toMatchObject({ gap: 3, margin: 15 });
    expect(made.project.cutting).toMatchObject({ leadIn: 'line', direction: 'conventional' });
    expect(made.project.cutting.tabs).not.toHaveProperty('width');
    expect(made.project.cutting.tabs).not.toHaveProperty('height');
  } finally {
    await request.patch('/api/settings', { data: { defaults: before.defaults ?? BUILT_IN } });
  }
});

test('DXF layer editor: an empty name is not saved', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = (await (await request.get('/api/settings/dxf-layers')).json()) as {
    map?: Record<string, string>;
  };
  try {
    await request.put('/api/settings/dxf-layers', { data: { map: { KESIM: 'outside' } } });
    await page.goto('/ayarlar/dxf');
    await expect(page.getByTestId('dxf-layer-name')).toHaveCount(1);
    await page.getByTestId('dxf-layer-add').click();
    await page.getByTestId('dxf-layer-name').last().fill('   ');
    await page.getByTestId('dxf-layers-save').click();
    await expect(page.getByTestId('dxf-layer-error').first()).toHaveText(d.emptyName);
    const map = (await (await request.get('/api/settings/dxf-layers')).json()) as unknown;
    expect(map).toEqual({ map: { KESIM: 'outside' } });
  } finally {
    await request.put('/api/settings/dxf-layers', { data: { map: before.map ?? {} } });
  }
});
