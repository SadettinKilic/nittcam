import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  goStep,
  openNewProject,
  paste,
  projectId,
  saved,
  watchConsole,
  openIssues,
} from './wizard-helpers';

// B8 tester (T122, T123, T253): three generated cabinets against a hand calculation, one undo per
// cabinet, generated rows stay plain rows (D-041) through nesting and export; the view (group,
// search, sort, issue filter) never touches the stored order; the floating Uyarılar panel at 1440.

const t = tr.cutList;
const c = t.cabinet;

interface StoredPart {
  id: string;
  name: string;
  qty: number;
  group?: string;
  note?: string;
  params: { w: number; h: number };
  grain: { mode: string; angle: number };
  edgeBand: Record<string, number>;
}

async function storedParts(page: Page): Promise<StoredPart[]> {
  await saved(page);
  const id = await projectId(page);
  const res = await page.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { project: { parts: StoredPart[] } }).project.parts;
}

/** Name, group, size and qty of each stored row (what the workshop sees). */
const summary = (parts: StoredPart[]) =>
  parts.map((p) => [p.group ?? '', p.name, p.params.w, p.params.h, p.qty]);
/** Everything but the id, to prove a row did not change at all. */
const body = (p: StoredPart) => JSON.stringify({ ...p, id: undefined });

const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n, column }), { exact: true });

/** T260: the closed "Arkalık" field shows a short label; the list keeps the long one. */
async function pickBack(page: Page, mode: 'none' | 'inset' | 'overlay') {
  const trigger = page.getByTestId('cabinet-back');
  await trigger.click();
  await page.getByRole('listbox').getByRole('option', { name: c.backModes[mode] }).click();
  await expect(trigger).toHaveAttribute('data-value', mode);
  await expect(trigger).toHaveText(c.backModesShort[mode]);
}

async function addCabinet(page: Page, values: Record<string, string>, extra?: () => Promise<void>) {
  await page.getByTestId('cabinet-open').click();
  const dialog = page.getByTestId('cabinet-dialog');
  await expect(dialog).toBeVisible();
  for (const [key, value] of Object.entries(values)) {
    await page.getByTestId(`cabinet-${key}`).fill(value);
  }
  if (extra) await extra();
  // T260: parts in another thickness (a 4 or 8 mm back, a 16 mm box on 18 mm stock) are added
  // only on purpose; this hand calculation keeps every part.
  const other = page.getByTestId('cabinet-include-other');
  if ((await other.count()) > 0) await other.click();
  await page.getByTestId('cabinet-add').click();
  await expect(dialog).toHaveCount(0);
}

// Hand calculation (W × H × D, t, back, shelves, doors, gap, plinth):
// 1) defaults 600 × 720 × 560, t18, inset back 8, 1 shelf, 1 door g3:
//    sides 560 × 720 ×2; top/bottom/shelf (600−36) × (560−8) = 564 × 552; back 564 × 720;
//    door (600−6) × (720−6) = 594 × 714.
// 2) 800 × 2000 × 600, overlay back 4, 4 shelves, 2 doors g2, plinth 100:
//    sides (600−4) × 2000 ×2; top/bottom 764 × 596; shelves 764 × 596 ×4; back 800 × 2000;
//    doors (800−6)/2 × (2000−100−4) = 397 × 1896 ×2; plinth 764 × 100.
// 3) 450 × 900 × 300, t16, no back, 2 shelves, no doors, band 0:
//    sides 300 × 900 ×2; top/bottom 418 × 300; shelves 418 × 300 ×2.
const CAB1 = [
  ['Dolap 1', c.roles.side, 560, 720, 2],
  ['Dolap 1', c.roles.top, 564, 552, 1],
  ['Dolap 1', c.roles.bottom, 564, 552, 1],
  ['Dolap 1', c.roles.shelf, 564, 552, 1],
  ['Dolap 1', c.roles.back, 564, 720, 1],
  ['Dolap 1', c.roles.door, 594, 714, 1],
];
const CAB2 = [
  ['Uzun dolap', c.roles.side, 596, 2000, 2],
  ['Uzun dolap', c.roles.top, 764, 596, 1],
  ['Uzun dolap', c.roles.bottom, 764, 596, 1],
  ['Uzun dolap', c.roles.shelf, 764, 596, 4],
  ['Uzun dolap', c.roles.back, 800, 2000, 1],
  ['Uzun dolap', c.roles.door, 397, 1896, 2],
  ['Uzun dolap', c.roles.plinth, 764, 100, 1],
];
const CAB3 = [
  ['Açık raf', c.roles.side, 300, 900, 2],
  ['Açık raf', c.roles.top, 418, 300, 1],
  ['Açık raf', c.roles.bottom, 418, 300, 1],
  ['Açık raf', c.roles.shelf, 418, 300, 2],
];

test.describe('B8 tester: T122 three cabinets (D-041)', () => {
  test('three cabinets match the hand calculation; undo removes one cabinet; rows stay plain through nesting and export', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');

    await addCabinet(page, {});
    await addCabinet(
      page,
      {
        width: '800',
        height: '2000',
        depth: '600',
        shelves: '4',
        plinth: '100',
        group: 'Uzun dolap',
      },
      async () => {
        await pickBack(page, 'overlay');
        await page.getByTestId('cabinet-back-thickness').fill('4');
        await page
          .getByTestId('cabinet-dialog')
          .getByRole('radio', { name: c.doorCount[2] })
          .click();
        await page.getByTestId('cabinet-doorGap').fill('2');
      },
    );
    await addCabinet(
      page,
      { width: '450', height: '900', depth: '300', thickness: '16', shelves: '2', band: '0' },
      async () => {
        await pickBack(page, 'none');
        await page
          .getByTestId('cabinet-dialog')
          .getByRole('radio', { name: c.doorCount[0] })
          .click();
        await page.getByTestId('cabinet-group').fill('Açık raf');
      },
    );
    let parts = await storedParts(page);
    expect(summary(parts)).toEqual([...CAB1, ...CAB2, ...CAB3]);
    // Grain: sides and doors vertical (90°), the rest along the width; open shelf has no band.
    for (const p of parts) {
      if (p.name === c.roles.back) expect(p.grain.mode).toBe('free');
      else
        expect(p.grain).toEqual({
          mode: 'fixed',
          angle: p.name === c.roles.side || p.name === c.roles.door ? 90 : 0,
        });
      if (p.group === 'Açık raf')
        expect(Object.values(p.edgeBand).every((x) => x === 0)).toBe(true);
    }

    // One undo removes exactly the last cabinet; redo brings it back.
    await page.getByTestId('wizard-undo').click();
    expect(summary(await storedParts(page))).toEqual([...CAB1, ...CAB2]);
    await page.getByTestId('wizard-redo').click();
    parts = await storedParts(page);
    expect(summary(parts)).toEqual([...CAB1, ...CAB2, ...CAB3]);
    const before = parts.map(body);

    // Delete one (Dolap 1 shelf, row 4), copy one (Uzun dolap door, row 11 after the delete),
    // edit one (Açık raf side width), clear one group label (Dolap 1 back).
    await page.getByRole('button', { name: fill(t.rowMenu.label, { n: 4 }) }).click();
    await page.getByRole('menuitem', { name: t.rowMenu.remove }).click();
    await expect(cell(page, 11, t.columns.name)).toHaveValue(c.roles.door);
    await page.getByRole('button', { name: fill(t.rowMenu.label, { n: 11 }) }).click();
    await page.getByRole('menuitem', { name: t.rowMenu.duplicate }).click();
    // Rows now: 1–5 Dolap 1, 6–13 Uzun dolap (copy at 12), 14–17 Açık raf.
    await expect(cell(page, 14, t.columns.name)).toHaveValue(c.roles.side);
    await cell(page, 14, t.columns.w).fill('320');
    await cell(page, 14, t.columns.w).press('Enter');
    await cell(page, 4, t.columns.group).fill('');
    await cell(page, 4, t.columns.group).press('Tab');

    parts = await storedParts(page);
    expect(parts).toHaveLength(17);
    const after = parts.map(body);
    // Untouched rows are byte-identical to before (no hidden link between generated rows).
    const expectedSame = before.filter((_, i) => ![3, 4, 13].includes(i));
    const actualSame = after.filter((_, i) => ![3, 11, 13].includes(i));
    expect(actualSame).toEqual(expectedSame);
    expect(parts[3]?.group).toBeUndefined();
    expect(parts[3]?.name).toBe(c.roles.back);
    expect(parts[11]?.name).toBe(c.roles.door);
    expect(parts[11]?.group).toBe('Uzun dolap');
    expect(body(parts[11] as StoredPart)).toBe(body(parts[10] as StoredPart));
    expect(parts[11]?.id).not.toBe(parts[10]?.id);
    expect(parts[13]?.params.w).toBe(320);
    expect(parts[13]?.params.h).toBe(900);

    // The label never locks anything: grouping still works with an ungrouped generated row.
    await page.getByTestId('cut-list-group-by').click();
    await expect(page.getByTestId('cut-list-group')).toHaveCount(4);
    await page.getByTestId('cut-list-group-by').click();

    // Nesting and export still work with the edited rows.
    await goStep(page, 'dizilim');
    await page.getByRole('button', { name: t.nesting.run, exact: true }).click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 30_000 });
    await saved(page);
    await goStep(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
    for (const id of ['export-check-origin', 'export-check-tool', 'export-check-aircut']) {
      await page.getByTestId(id).check();
    }
    if (await page.getByTestId('export-accept').count()) {
      await page.getByTestId('export-accept').check();
    }
    const download = page.getByTestId('wizard-footer').getByTestId('export-download');
    await expect(download).toBeEnabled();
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /export/i.test(r.url()),
    );
    await download.click();
    expect((await response).ok()).toBe(true);
    expect(problems).toEqual([]);
  });
});

const LIST = [
  'Ad\tEn\tBoy\tAdet\tNot',
  'Yan dikme\t560\t720\t2\tçam',
  'Şapka\t600\t100\t1\t',
  'Raf\t528\t540\t3\tIşık',
  'Kapak\t396\t716\t1\t',
  'Çekmece\t400\t150\t2\t',
].join('\n');
const ORIGINAL = ['Yan dikme', 'Şapka', 'Raf', 'Kapak', 'Çekmece'];

async function shownNames(page: Page): Promise<string[]> {
  return page
    .getByTestId('cut-list-row')
    .evaluateAll((rows) =>
      rows.map(
        (r) => (r.querySelector('input[id$="-name"]') as HTMLInputElement | null)?.value ?? '',
      ),
    );
}

test.describe('B8 tester: T123 view never changes the project', () => {
  test('group + search + issue filter + sort combined; keyboard across groups; move disabled while sorted', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, LIST, 5);
    for (const [n, g] of [
      [1, 'Dolap B'],
      [3, 'Dolap A'],
      [5, 'Dolap B'],
    ] as const) {
      await cell(page, n, t.columns.group).fill(g);
      await cell(page, n, t.columns.group).press('Tab');
    }
    await page.getByTestId('cut-list-group-by').click();
    await expect(page.getByTestId('cut-list-group')).toHaveCount(3);
    const grouped = await shownNames(page);
    // Every row once; groups contiguous; ungrouped last.
    expect([...grouped].sort()).toEqual([...ORIGINAL].sort());
    expect(grouped.slice(-2)).toEqual(['Şapka', 'Kapak']);

    // Keyboard: ArrowDown from the last row of one group lands on the first row of the next.
    const firstOfLast = grouped.indexOf('Şapka');
    const prev = grouped[firstOfLast - 1] ?? '';
    const prevN = ORIGINAL.indexOf(prev) + 1;
    await cell(page, prevN, t.columns.name).focus();
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, 2, t.columns.name)).toBeFocused();

    // Search inside the grouped view: Turkish folding on the note ("ışık" ← "ISIK").
    const search = page.getByTestId('cut-list-search');
    await search.fill('ISIK');
    await expect.poll(() => shownNames(page)).toEqual(['Raf']);
    await search.fill('cekmece');
    await expect.poll(() => shownNames(page)).toEqual(['Çekmece']);
    await search.fill('');

    // Sort while grouped, plus the issue filter: the row menu's move items are disabled.
    await page.getByTestId('sort-name').click();
    await page.getByRole('button', { name: fill(t.rowMenu.label, { n: 1 }) }).click();
    await expect(page.getByRole('menuitem', { name: t.rowMenu.moveDown })).toBeDisabled();
    await page.keyboard.press('Escape');
    await cell(page, 4, t.columns.w).fill('9000');
    await cell(page, 4, t.columns.w).press('Tab');
    await page.getByTestId('cut-list-issues-only').click();
    await expect.poll(() => shownNames(page)).toEqual(['Kapak']);

    // The stored project still has the original order, via the API.
    const parts = await storedParts(page);
    expect(parts.map((p) => p.name)).toEqual(ORIGINAL);
    expect(parts.map((p) => p.group ?? '')).toEqual(['Dolap B', '', 'Dolap A', '', 'Dolap B']);

    // Reload: the stored order survives.
    const id = await projectId(page);
    await page.reload();
    await expect(cell(page, 1, t.columns.name)).toBeVisible({ timeout: 30_000 });
    const res = await page.request.get(`/api/projects/${id}`);
    const reloaded = ((await res.json()) as { project: { parts: StoredPart[] } }).project.parts;
    expect(reloaded.map((p) => p.name)).toEqual(ORIGINAL);
    expect(problems).toEqual([]);
  });
});

test.describe('B8 tester: floating Uyarılar at 1440', () => {
  test('what the open panel covers, and whether covered cells can still be edited', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, LIST, 5);
    await cell(page, 1, t.columns.w).fill('9000');
    await cell(page, 1, t.columns.w).press('Tab');
    const panel = page.getByTestId('validation-panel');
    // T256: no auto-open at 1440 (it would cover cells); the chip opens it on purpose.
    await openIssues(page);
    const pb = await panel.boundingBox();
    const report: string[] = [`panel ${JSON.stringify(pb)}`];
    for (let n = 1; n <= 5; n++) {
      for (const [label, loc] of [
        ['right', page.getByLabel(fill(t.edgeLabel, { n, edge: t.edge.right }), { exact: true })],
        ['note', cell(page, n, t.columns.note)],
        ['group', cell(page, n, t.columns.group)],
      ] as const) {
        const b = await loc.boundingBox();
        if (!b) continue;
        const hit = await loc.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top === el || el.contains(top);
        });
        report.push(`row ${n} ${label} x=${Math.round(b.x)} y=${Math.round(b.y)} reachable=${hit}`);
      }
    }
    // Clicking a covered cell lands on the panel, not the cell.
    const note1 = cell(page, 1, t.columns.note);
    await note1.click({ force: true });
    const focused = await note1.evaluate((el) => el === document.activeElement);
    report.push(`click on covered note: focused=${focused} open=${await panel.isVisible()}`);
    await page.screenshot({ path: test.info().outputPath('uyarilar-1440.png') });
    // Escape route: the chip closes the panel, then the cell is reachable and editable.
    const chip = page.getByTestId('cut-list-issue-chip');
    await chip.click();
    await expect(panel).toHaveCount(0);
    await note1.click();
    await note1.fill('kenar');
    await note1.press('Tab');
    await expect(note1).toHaveValue('kenar');
    // A second issue while closed: does the panel pop open again over the cells?
    await cell(page, 2, t.columns.w).fill('9000');
    await cell(page, 2, t.columns.w).press('Tab');
    await expect(chip).toHaveAttribute('data-count', '2');
    await page.waitForTimeout(500);
    report.push(`2nd issue while closed: open=${await panel.isVisible()}`);
    // Reload with issues: auto-open again?
    await saved(page);
    await page.reload();
    await expect(cell(page, 1, t.columns.name)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    report.push(`after reload: open=${await panel.isVisible()}`);
    console.log(report.join('\n'));
  });
});
