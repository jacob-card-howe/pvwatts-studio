#!/usr/bin/env node
/**
 * Render the installable app icons in static/icons/ from static/favicon.svg.
 *
 * The PNGs are committed, so this only needs re-running when the favicon
 * changes. It drives a headless Chromium through Playwright:
 *
 *   node tools/make_icons.mjs
 *
 * Three shapes are produced:
 *   - "any" icons keep the favicon's rounded tile on a transparent canvas;
 *   - the maskable icon is a full-bleed square with the glyph shrunk to sit
 *     inside the 80% safe zone, because launchers crop it to their own shape;
 *   - the Apple touch icon is full-bleed too, since iOS rounds the corners.
 */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAVICON = path.join(ROOT, 'static', 'favicon.svg');
const OUT_DIR = path.join(ROOT, 'static', 'icons');

const ICONS = [
  { file: 'icon-192.png', size: 192, fullBleed: false, glyphScale: 1 },
  { file: 'icon-512.png', size: 512, fullBleed: false, glyphScale: 1 },
  { file: 'icon-maskable-512.png', size: 512, fullBleed: true, glyphScale: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, fullBleed: true, glyphScale: 0.9 },
];

/** Rebuild the favicon's 64-unit drawing as a square tile at the requested shape. */
function iconSvg(source, { size, fullBleed, glyphScale }) {
  const tile = source.match(/<rect[^>]*\/>/)[0];
  const fill = tile.match(/fill="([^"]+)"/)[1];
  const glyph = source.match(/<g[\s\S]*<\/g>/)[0];
  const background = fullBleed
    ? `<rect width="64" height="64" fill="${fill}"/>`
    : tile;
  const offset = 32 * (1 - glyphScale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  ${background}
  <g transform="translate(${offset} ${offset}) scale(${glyphScale})">${glyph}</g>
</svg>`;
}

const source = await readFile(FAVICON, 'utf8');
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${iconSvg(source, icon)}</body></html>`
    );
    await page.locator('svg').screenshot({
      path: path.join(OUT_DIR, icon.file),
      omitBackground: true,
    });
    console.log(`wrote static/icons/${icon.file} (${icon.size}x${icon.size})`);
  }
} finally {
  await browser.close();
}
