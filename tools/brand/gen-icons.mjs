// Generates the favicon, app icons and standalone brand SVGs from the one mark geometry
// (packages/ui/src/brand.ts, T194). Run: node tools/brand/gen-icons.mjs
// Static files cannot read CSS tokens, so the colours below mirror tokens.css
// (brand-600 / brand-500 / neutral-0 / neutral-950); change them together.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { BRAND_MARK: m } = await import(pathToFileURL(join(root, 'packages/ui/src/brand.ts')).href);

const COLORS = {
  cobalt: '#2f56e3', // brand-600 (accent, light)
  cobaltDark: '#4470f0', // brand-500 (tile on dark tab bars)
  white: '#ffffff', // neutral-0
  ink: '#0d0f12', // neutral-950
};

/** One mark as SVG. `tile` = cobalt rounded square; otherwise strokes on transparent. */
function markSvg({ tile, line, dot, darkTile, size }) {
  const v = m.viewBox;
  const dims = size ? ` width="${size}" height="${size}"` : '';
  const style = darkTile
    ? `<style>@media (prefers-color-scheme: dark){.t{fill:${darkTile}}}</style>`
    : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v} ${v}"${dims} fill="none">`,
    style,
    tile ? `<rect class="t" width="${v}" height="${v}" rx="${m.tileRadius}" fill="${tile}"/>` : '',
    `<path d="${m.leadIn}" stroke="${line}" stroke-width="${m.stroke}" stroke-linecap="round" opacity="${m.leadInOpacity}"/>`,
    `<path d="${m.path}" stroke="${line}" stroke-width="${m.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<circle cx="${m.dot.cx}" cy="${m.dot.cy}" r="${m.dot.r}" fill="${dot}"/>`,
    '</svg>',
  ].join('');
}

const web = join(root, 'apps/web');
const brandDir = join(web, 'public/brand');
mkdirSync(brandDir, { recursive: true });

const tileLight = markSvg({ tile: COLORS.cobalt, line: COLORS.white, dot: COLORS.white });
const tileDark = markSvg({ tile: COLORS.cobaltDark, line: COLORS.white, dot: COLORS.white });
const files = {
  // Favicon: cobalt tile, a touch brighter when the browser chrome is dark.
  [join(web, 'app/icon.svg')]: markSvg({
    tile: COLORS.cobalt,
    line: COLORS.white,
    dot: COLORS.white,
    darkTile: COLORS.cobaltDark,
  }),
  [join(brandDir, 'mark-tile-light.svg')]: tileLight,
  [join(brandDir, 'mark-tile-dark.svg')]: tileDark,
  // Plain (accent dot) and mono versions for documents, print and partner material.
  [join(brandDir, 'mark-plain-on-light.svg')]: markSvg({ line: COLORS.ink, dot: COLORS.cobalt }),
  [join(brandDir, 'mark-plain-on-dark.svg')]: markSvg({ line: COLORS.white, dot: '#94b3fb' }),
  [join(brandDir, 'mark-mono-black.svg')]: markSvg({ line: COLORS.ink, dot: COLORS.ink }),
  [join(brandDir, 'mark-mono-white.svg')]: markSvg({ line: COLORS.white, dot: COLORS.white }),
};
for (const [file, svg] of Object.entries(files)) writeFileSync(file, `${svg}\n`);

// PNG app icons, rendered by Playwright's Chromium (already a dev dependency of e2e/).
const require = createRequire(join(root, 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg, size, out, { pad = 0, bg } = {}) {
  const inner = size - pad * 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${bg ?? 'transparent'}"><div style="padding:${pad}px;line-height:0">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
}
await png(tileLight, 32, join(web, 'app/icon1.png'));
// Apple touch icon: iOS masks its own corners, so a full-bleed cobalt square with the mark.
const fullBleed = (fill) =>
  markSvg({ tile: fill, line: COLORS.white, dot: COLORS.white }).replace(`rx="${m.tileRadius}"`, 'rx="0"');
await png(fullBleed(COLORS.cobalt), 180, join(web, 'app/apple-icon.png'));
for (const [name, fill] of [
  ['light', COLORS.cobalt],
  ['dark', COLORS.cobaltDark],
]) {
  await png(fullBleed(fill), 192, join(brandDir, `icon-192-${name}.png`));
  await png(fullBleed(fill), 512, join(brandDir, `icon-512-${name}.png`));
}
await browser.close();
console.log(`brand: ${Object.keys(files).length} svg + 6 png written`);
