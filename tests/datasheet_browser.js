// Browser regression + bounded visual capture pass (no API quota).
// 1. python3 tests/make_datasheet_pdf.py .impeccable/review/rec-text-fixture.pdf
// 2. Serve static/ on 127.0.0.1:8765; open a playwright-cli session.
// 3. playwright-cli run-code --filename=tests/datasheet_browser.js
// The supplied PDF is a labelled text-only fixture, not manufacturer artwork.
async page => {
  const results = [];
  const errors = [];
  const check = (ok, message) => { results.push({ pass: Boolean(ok), message }); };
  page.on('pageerror', error => errors.push(error.message));
  await page.unroute('https://developer.nlr.gov/**');
  await page.route('https://developer.nlr.gov/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ outputs: {
    ac_annual: 5200, solrad_annual: 4.1, capacity_factor: 14.8,
    ac_monthly: Array(12).fill(400), dc_monthly: Array(12).fill(420),
    solrad_monthly: Array(12).fill(4.1), poa_monthly: Array(12).fill(120)
  } }) }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:8765');
  await page.locator('#tab-datasheet').click();
  await page.waitForFunction(() => document.querySelector('#tab-datasheet').getAttribute('aria-selected') === 'true');

  const capture = async (name, width, height = 1000) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.waitForFunction(() => !datasheetState.renderTask);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no document horizontal overflow`);
    await page.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: true });
  };
  check(await page.locator('#ds-empty').isVisible(), 'Empty state teaches the workflow');
  check(await page.locator('#ds-export-csv').isDisabled(), 'Empty exports disabled');
  check(!await page.locator('.header-actions').isVisible(), 'Simulator exports hidden in reader');
  await capture('empty-desktop', 1440);
  await capture('empty-mobile', 390, 844);

  await page.locator('#ds-manual').click();
  check(!await page.locator('#ds-viewer').isVisible(), 'Manual entry has no source viewer');
  check(!await page.locator('#ds-warnings').isVisible(), 'Manual entry has no extraction warnings');
  check(await page.locator('#ds-export-json').isDisabled(), 'Blank manual table cannot export');
  const fill = async (key, value) => {
    const input = page.locator(`#ds-value-${key}`);
    await input.evaluate(el => { el.closest('details.ds-spec-group').open = true; });
    await input.fill(String(value));
  };
  for (const [key, value] of Object.entries({ pmax_stc: 390, vmp_stc: 36.8, imp_stc: 10.6, voc_stc: 44.8, isc_stc: 11.31,
    height_mm: 1900, length_mm: 1000, thickness_mm: 30, weight: 20 })) await fill(key, value);
  check(await page.locator('#ds-kpi-efficiency').textContent() === '20.53', 'Live efficiency follows power and dimensions');
  check(await page.locator('#ds-kpi-area').textContent() === '1.9', 'Live module area');
  await fill('weight', 22);
  check((await page.locator('#ds-value-weight').locator('..').locator('..').textContent()).includes('48.5 lbs'), 'Alternate unit changes with edit');
  await fill('weight', '');
  check(!await page.locator('#ds-value-weight').locator('..').locator('..').locator('.ds-alt').isVisible(), 'Blank dimension/weight never shows zero-unit conversion');
  await fill('weight', 20);
  await page.locator('#ds-next-missing').click();
  check(await page.evaluate(() => document.activeElement.id) === 'ds-value-noctTemp', 'Next blank opens and focuses a missing required value');
  check((await page.locator('#ds-source-pmax_stc').textContent()).includes('Entered by you'), 'Manual provenance visible');
  await page.evaluate(() => { for (const group of document.querySelectorAll('.ds-spec-group')) group.open = group.dataset.group === '0'; });
  await capture('manual-desktop', 1440);
  await capture('manual-mobile', 390, 844);
  await page.locator('.ds-mobile-bridge a').click();
  check(await page.locator('#ds-results-heading').evaluate(el => el.getBoundingClientRect().top >= document.querySelector('.app-header').getBoundingClientRect().bottom), 'Mobile results jump clears sticky header');
  await page.locator('.ds-module-details > summary').click();
  await page.locator('#ds-model').fill('Browser test module');
  await page.locator('.ds-module-details > summary').click();
  const jsonDownload = page.waitForEvent('download');
  await page.locator('#ds-export-json').click();
  const json = await jsonDownload;
  check(json.suggestedFilename() === 'Browser_test_module_datasheet.json', 'JSON export button produces named download');
  await json.saveAs('.impeccable/review/manual-export.json');
  const csvDownload = page.waitForEvent('download');
  await page.locator('#ds-export-csv').click();
  const csv = await csvDownload;
  check(csv.suggestedFilename().endsWith('_datasheet.csv'), 'CSV export button produces download');
  await csv.saveAs('.impeccable/review/manual-export.csv');

  await page.locator('#ds-file').setInputFiles('.impeccable/review/rec-text-fixture.pdf');
  await page.waitForFunction(() => Boolean(datasheetState.pdf) && document.querySelector('.ds-intake').getAttribute('aria-busy') === 'false', null, { timeout: 20000 });
  await page.waitForFunction(() => !datasheetState.renderTask);
  check(await page.locator('#ds-value-pmax_stc').inputValue() === '390', 'Actual pdf.js extraction reads 390 W class');
  check(await page.locator('#ds-page-label').textContent() === 'Page 2 of 2', 'Reader opens specification page');
  check(await page.locator('#ds-column option').count() === 2, 'Multi-column picker available');
  check(!await page.locator('#ds-value-efficiency_stc').evaluate(el => el.closest('tr').classList.contains('ds-row-missing')), 'Filled optional values are not marked missing');
  check(await page.locator('#ds-manufacturer').inputValue() === '', 'Replacement PDF resets old metadata');
  await page.locator('#ds-column').selectOption('1');
  check(await page.locator('#ds-value-pmax_stc').inputValue() === '400', 'Column switch replaces power');
  check(await page.locator('#ds-value-vmp_stc').inputValue() === '37.6', 'Column switch replaces related electrical values');
  await page.locator('#ds-source-pmax_stc summary').click();
  check(await page.locator('#ds-source-pmax_stc p').isVisible(), 'Full original row available without hover');
  await fill('pmax_stc', 401);
  check(await page.locator('#ds-source-pmax_stc').textContent() === 'Entered by you', 'Editing replaces original-source annotation immediately');
  await page.locator('#ds-column').selectOption('0');
  check(await page.locator('#ds-value-pmax_stc').inputValue() === '390', 'Changing column clears prior edits');
  await page.locator('#ds-zoom-in').click();
  check(await page.locator('#ds-zoom-label').textContent() === '150%', 'Zoom controls update');
  await page.locator('#ds-zoom-reset').click();
  check(await page.locator('#ds-zoom-label').textContent() === '100%' && await page.locator('#ds-zoom-out').isDisabled(), 'Fit width resets zoom and bound state');
  await page.locator('#ds-prev-page').click();
  await page.waitForFunction(() => !datasheetState.renderTask && datasheetState.pageNumber === 1);
  check(await page.locator('#ds-prev-page').isDisabled(), 'Previous disabled on first page');
  await page.locator('#ds-next-page').click();
  await page.waitForFunction(() => !datasheetState.renderTask && datasheetState.pageNumber === 2);
  await capture('desktop', 1440);
  await capture('desktop-1280', 1280, 900);
  await capture('mobile', 390, 844);
  check(await page.locator('.ds-derived-value').first().evaluate(el => el.getBoundingClientRect().right <= innerWidth), 'Mobile calculation results visible without horizontal scrolling');
  await capture('tablet', 768, 900);

  for (const width of [320, 768, 1080]) {
    await page.setViewportSize({ width, height: 900 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no document overflow`);
  }
  check(await page.evaluate(() => [...document.querySelectorAll('.ds-input')].every(el => el.getAttribute('aria-label') && el.getAttribute('aria-describedby'))), 'All measurement controls named and source-described');
  check(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(el => el.id); return new Set(ids).size === ids.length; }), 'No duplicate IDs');
  await page.locator('#tab-simulator').click();
  check(await page.locator('.header-actions').isVisible(), 'Simulator exports restored on tab switch');
  await page.locator('#tab-datasheet').click();
  check(await page.locator('#ds-kpi-power').textContent() === '390', 'Reader state retained across tabs');
  await page.locator('#ds-clear').click();
  check(await page.locator('#ds-empty').isVisible() && await page.locator('#ds-kpi-power').textContent() === '—', 'Clear resets results and returns to empty state');
  check(await page.evaluate(() => datasheetState.pdf === null && datasheetState.pageCount === 0 && datasheetState.zoom === 1), 'Clear destroys PDF state and resets navigation');
  check(await page.evaluate(() => document.activeElement.id) === 'ds-file', 'Clear returns focus to PDF input');

  // Error and race coverage uses test-only stubs after the real PDF path above.
  const errorStates = await page.evaluate(async () => {
    await openDatasheet(new File(['not a PDF'], 'bad.txt', { type: 'text/plain' }));
    const invalidType = document.querySelector('#ds-status').dataset.tone === 'error';
    await openDatasheet(new File(['not a PDF'], 'bad.pdf', { type: 'application/pdf' }));
    const corrupt = document.querySelector('#ds-status').dataset.tone === 'error' && !document.querySelector('#ds-manual').disabled;
    const original = datasheetState.pdfjs;
    let resolvePdf;
    let destroyed = false;
    const deferred = new Promise(resolve => { resolvePdf = resolve; });
    datasheetState.pdfjs = { getDocument: () => ({ promise: deferred }) };
    const loading = openDatasheet(new File(['test'], 'slow.pdf', { type: 'application/pdf' }));
    await new Promise(resolve => setTimeout(resolve, 30));
    clearDatasheet();
    resolvePdf({ destroy() { destroyed = true; } });
    await loading;
    datasheetState.pdfjs = original;
    return { invalidType, corrupt, clearedWhileLoading: datasheetState.pdf === null && document.querySelector('#ds-empty').hidden === false && destroyed };
  });
  for (const [name, pass] of Object.entries(errorStates)) check(pass, name);
  check(errors.length === 0, `No uncaught browser errors: ${errors.join('; ')}`);
  const failed = results.filter(result => !result.pass);
  if (failed.length) throw new Error(JSON.stringify({ checks: results.length, failed, errors }));
  return { checks: results.length, failed, errors };
}
