// Datasheet extraction regression checks. Run with:
//   node --test tests/test_datasheet_parser.mjs
//
// Every expected value below was read by hand from the manufacturer's own
// published datasheet. The fixtures are the positioned text layer pdf.js
// produces for those PDFs, so a green run means the browser reads the same
// numbers a person reads off the page.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const parser = require('../static/datasheet_parser.js');
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'datasheets');

const load = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf-8'));
const read = (name, columnIndex = 0) => {
  const result = parser.extractDatasheet(load(name), { columnIndex });
  return { result, values: parser.toValues(result.fields) };
};
const close = (actual, expected, tolerance, message) =>
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ±${tolerance}, got ${actual}`
  );

// --- Silfab SIL-530 XM Bifacial -------------------------------------------
// The sheet labels its columns STC / BSTC / NOCT, so each value is placed by
// column name rather than by document order.

test('Silfab: every STC electrical value matches the datasheet', () => {
  const { values } = read('silfab');
  assert.equal(values.pmax_stc, 530);
  assert.equal(values.vmp_stc, 41.05);
  assert.equal(values.imp_stc, 12.91);
  assert.equal(values.voc_stc, 47.74);
  assert.equal(values.isc_stc, 13.71);
  assert.equal(values.efficiency_stc, 22.3);
});

test('Silfab: NOCT and BSTC columns are kept apart from STC', () => {
  const { values } = read('silfab');
  assert.equal(values.pmax_noct, 391.3);
  assert.equal(values.vmp_noct, 37.76);
  assert.equal(values.imp_noct, 10.36);
  assert.equal(values.voc_noct, 43.91);
  assert.equal(values.isc_noct, 11);
  assert.equal(values.pmax_bstc, 578.2);
  assert.equal(values.voc_bstc, 47.79);
  assert.equal(values.isc_bstc, 14.96);
});

test('Silfab: ratings, temperature and mechanical values match the datasheet', () => {
  const { values } = read('silfab');
  assert.equal(values.maxSystemVoltage, 1500);
  assert.equal(values.maxSeriesFuse, 30);
  assert.equal(values.powerTolerance, '0 to +10');
  assert.equal(values.bifaciality, 80);
  assert.equal(values.tcIsc, 0.04);
  assert.equal(values.tcVoc, -0.24);
  assert.equal(values.tcPmax, -0.29);
  assert.equal(values.noctTemp, 45);
  assert.equal(values.cells, 132);
  assert.equal(values.height_mm, 2098);
  assert.equal(values.length_mm, 1133);
  assert.equal(values.thickness_mm, 35);
  assert.equal(values.weight, 26.2);
});

test('Silfab: the marketing page is skipped in favour of the data page', () => {
  const { result } = read('silfab');
  assert.equal(result.sourcePage, 2);
  assert.deepEqual(result.conditionColumns.columns.map(c => c.condition), ['stc', 'bstc', 'noct']);
  assert.deepEqual(result.warnings, []);
});

// --- REC N-Peak 3 Black ---------------------------------------------------
// No condition columns: STC comes first and NMOT second. Two power classes
// share every row, and engineering-drawing callouts sit inside the same rows.

test('REC: the 390 W class is read from the first value column', () => {
  const { values } = read('rec', 0);
  assert.equal(values.pmax_stc, 390);
  assert.equal(values.vmp_stc, 36.8);
  assert.equal(values.imp_stc, 10.6);
  assert.equal(values.voc_stc, 44.8);
  assert.equal(values.isc_stc, 11.31);
  assert.equal(values.efficiency_stc, 19.5);
  assert.equal(values.pmax_noct, 295);
  assert.equal(values.vmp_noct, 34.4);
  assert.equal(values.imp_noct, 8.56);
  assert.equal(values.voc_noct, 41.9);
  assert.equal(values.isc_noct, 9.13);
});

test('REC: the 400 W class is read from the second value column', () => {
  const { values } = read('rec', 1);
  assert.equal(values.pmax_stc, 400);
  assert.equal(values.vmp_stc, 37.6);
  assert.equal(values.imp_stc, 10.64);
  assert.equal(values.voc_stc, 45);
  assert.equal(values.isc_stc, 11.39);
  assert.equal(values.efficiency_stc, 20.3);
  assert.equal(values.pmax_noct, 302);
});

test('REC: drawing callouts inside a row never become the value', () => {
  const { values } = read('rec');
  // The Isc temperature-coefficient row also carries the dimension callout
  // "1200 [47.2]"; the plausibility range is what rejects it.
  assert.equal(values.tcIsc, 0.04);
  assert.equal(values.tcVoc, -0.26);
  assert.equal(values.tcPmax, -0.34);
  assert.equal(values.noctTemp, 44.3);
  assert.equal(values.maxSystemVoltage, 1000);
  assert.equal(values.maxSeriesFuse, 25);
  assert.equal(values.powerTolerance, '0/+10');
  assert.equal(values.cells, 132);
});

test('REC: an inches-only sheet is converted to millimetres', () => {
  const { values } = read('rec');
  close(values.height_mm, 74.8 * 25.4, 0.01, 'height');
  close(values.length_mm, 40.9 * 25.4, 0.01, 'length');
  close(values.thickness_mm, 1.2 * 25.4, 0.01, 'thickness');
  close(values.weight, 48.0 * 0.45359237, 0.001, 'weight');
});

test('REC: order-based STC/NOCT assignment is flagged for confirmation', () => {
  const { result } = read('rec');
  assert.ok(result.warnings.some(w => /order on the page/i.test(w)));
  // This sheet has exactly two power classes. Offering a third would invite
  // the user to select a column that does not exist.
  assert.equal(result.columnCount, 2);
});

test('REC: no column mixes values from two different power classes', () => {
  // The IMPP row shares its baseline with "UL 61730 | Fire Type Class 2".
  // Reading that trailing 2 as a current, or letting it shift the columns,
  // would put a fabricated value in an otherwise-real row.
  const classes = [
    { pmax_stc: 390, vmp_stc: 36.8, imp_stc: 10.6, voc_stc: 44.8, isc_stc: 11.31, efficiency_stc: 19.5 },
    { pmax_stc: 400, vmp_stc: 37.6, imp_stc: 10.64, voc_stc: 45, isc_stc: 11.39, efficiency_stc: 20.3 }
  ];
  for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
    const { values } = read('rec', columnIndex);
    const expected = classes[Math.min(columnIndex, classes.length - 1)];
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(values[key], value, `column ${columnIndex}: ${key} came from the wrong power class`);
    }
    // Ratings stated once for the sheet must not drift with the picker.
    assert.equal(values.maxSeriesFuse, 25);
    assert.equal(values.maxSystemVoltage, 1000);
  }
});

test('a phrase ending in a digit is never read as a value', () => {
  assert.equal(parser.looksLikeValue('10.60'), true);
  assert.equal(parser.looksLikeValue('GR 11.39'), true, 'a short drawing label may precede a value');
  assert.equal(parser.looksLikeValue('≥ 20.9'), true);
  assert.equal(parser.looksLikeValue('-0.34 %/°C'), true);
  assert.equal(parser.looksLikeValue('1000 (IEC) / 1500 (UL)'), true);
  assert.equal(parser.looksLikeValue('Fire Type Class 2'), false);
  assert.equal(parser.looksLikeValue('C / TYPE 29'), false);
  assert.equal(parser.looksLikeValue('Anodized aluminium'), false);
});

test('a warranty percentage is never read as a power rating', () => {
  // "Power in Year 25 | 92% | 92% | 92%" is a warranty table, not a rating.
  const items = [
    { str: 'Power in Year 25', x: 40, y: 700, w: 90, h: 8 },
    { str: '92%', x: 200, y: 700, w: 20, h: 8 },
    { str: '92%', x: 260, y: 700, w: 20, h: 8 }
  ];
  assert.deepEqual(parser.extractDatasheet([{ page: 1, items }]).fields, {});
});

test('a quantity named before "temperature coefficient" resolves to the coefficient', () => {
  const labelled = (label, value) => parser.toValues(parser.extractDatasheet([{
    page: 1,
    items: [
      { str: label, x: 40, y: 700, w: 150, h: 8 },
      { str: value, x: 260, y: 700, w: 24, h: 8 }
    ]
  }]).fields);
  assert.deepEqual(labelled('Voltage Temperature Coefficient (Kv)', '-0.29'), { tcVoc: -0.29 });
  assert.deepEqual(labelled('Current Temperature Coefficient', '0.045'), { tcIsc: 0.045 });
  assert.deepEqual(labelled('Pmax Temperature Coefficient', '-0.34'), { tcPmax: -0.34 });
  assert.deepEqual(labelled('Temp. Coefficient of Pmpp', '-0.34'), { tcPmax: -0.34 });
  assert.deepEqual(labelled('TK Voc', '-0.25'), { tcVoc: -0.25 });
});

// --- Canadian Solar CS6.2-66TB -------------------------------------------
// Its STC table is transposed (models as rows). The documented behaviour is to
// leave those cells blank rather than to guess — a wrong number here would be
// far worse than an empty one.

test('Canadian Solar: the row-oriented blocks are read correctly', () => {
  const { values } = read('canadian');
  assert.equal(values.maxSystemVoltage, 1500);
  assert.equal(values.maxSeriesFuse, 35);
  assert.equal(values.powerTolerance, '0 ~ + 10 W');
  assert.equal(values.bifaciality, 80);
  assert.equal(values.tcPmax, -0.29);
  assert.equal(values.tcVoc, -0.25);
  assert.equal(values.tcIsc, 0.045);
  assert.equal(values.noctTemp, 41);
  assert.equal(values.cells, 132);
  assert.equal(values.height_mm, 2382);
  assert.equal(values.length_mm, 1134);
  assert.equal(values.thickness_mm, 30);
  assert.equal(values.weight, 32.8);
});

test('Canadian Solar: the transposed electrical table yields no guesses', () => {
  const { values } = read('canadian');
  for (const key of ['pmax_stc', 'vmp_stc', 'imp_stc', 'voc_stc', 'isc_stc', 'efficiency_stc']) {
    assert.equal(values[key], undefined, `${key} must stay blank rather than be guessed`);
  }
});

// --- Qcells Q.PEAK DUO ML-G12S -------------------------------------------
// Six power classes, symbol cells (alpha/beta/gamma, VSYS, IR) between each
// label and its value, and a second electrical block that states BIFACIAL
// NAMEPLATE IRRADIANCE rather than NOCT.

test('Qcells: the leftmost power class is read from every block', () => {
  const { values } = read('qcells', 0);
  assert.equal(values.pmax_stc, 650);
  assert.equal(values.vmp_stc, 37.62);
  assert.equal(values.imp_stc, 17.28);
  assert.equal(values.voc_stc, 45.64);
  assert.equal(values.isc_stc, 18.3);
  assert.equal(values.efficiency_stc, 20.9);
  assert.equal(values.pmax_bstc, 711);
  assert.equal(values.voc_bstc, 45.8);
  assert.equal(values.isc_bstc, 20.03);
});

test('Qcells: a bifacial block is never reported as NOCT', () => {
  const { values, result } = read('qcells');
  // This sheet publishes no NOCT figures at all. Reading its 711 W bifacial
  // row as NOCT would make every NOCT calculation silently wrong.
  for (const key of ['pmax_noct', 'vmp_noct', 'imp_noct', 'voc_noct', 'isc_noct']) {
    assert.equal(values[key], undefined, `${key} must stay blank on a sheet with no NOCT block`);
  }
  assert.ok(result.warnings.some(w => /bifacial block rather than NOCT/i.test(w)));
});

test('Qcells: symbol cells between a label and its value are stepped over', () => {
  const { values } = read('qcells');
  assert.equal(values.tcIsc, 0.04);
  assert.equal(values.tcVoc, -0.27);
  assert.equal(values.tcPmax, -0.34);
  assert.equal(values.maxSystemVoltage, 1000);
  assert.equal(values.maxSeriesFuse, 35);
});

test('Qcells: values printed away from their label are still found', () => {
  const { values } = read('qcells');
  // "6 x 22 monocrystalline Q.ANTUM solar half cells" states the grid.
  assert.equal(values.cells, 132);
  // The metric dimensions sit on their own line under the imperial line.
  assert.equal(values.height_mm, 2384);
  assert.equal(values.length_mm, 1303);
  assert.equal(values.thickness_mm, 35);
  assert.equal(values.weight, 38.2);
  // The tolerance is inside "...STC1 (POWER TOLERANCE +5 W / -0 W)".
  assert.equal(values.powerTolerance, '+5 W / -0 W');
});

test('Qcells: the highest power class swaps every per-class value at once', () => {
  const { values } = read('qcells', 5);
  assert.equal(values.pmax_stc, 675);
  assert.equal(values.vmp_stc, 38.43);
  assert.equal(values.imp_stc, 17.56);
  assert.equal(values.voc_stc, 45.74);
  assert.equal(values.isc_stc, 18.45);
  assert.equal(values.efficiency_stc, 21.7);
  assert.equal(values.pmax_bstc, 738.4);
  // Ratings that are stated once for the whole sheet must not follow the
  // picker: the fuse row's only other number is "C / TYPE 29".
  assert.equal(values.maxSeriesFuse, 35);
  assert.equal(values.maxSystemVoltage, 1000);
  assert.equal(values.height_mm, 2384);
});

test('Qcells: tolerance bounds follow the selected power class', () => {
  for (const [columnIndex, pmax] of [[0, 650], [5, 675]]) {
    const { values } = read('qcells', columnIndex);
    const tolerance = parser.computeMetrics(values).tolerance;
    assert.equal(tolerance.min, pmax);
    assert.equal(tolerance.max, pmax + 5);
  }
});

// --- Derived metrics ------------------------------------------------------

test('metrics: area, efficiency, fill factor and the NOCT/STC difference', () => {
  const { values } = read('silfab');
  const metrics = parser.computeMetrics(values);
  close(metrics.area, 2.098 * 1.133, 1e-9, 'area');
  close(metrics.efficiency, (530 / (2.377034 * 1000)) * 100, 1e-4, 'efficiency');
  close(metrics.fillFactorStc, (41.05 * 12.91) / (47.74 * 13.71), 1e-9, 'fill factor at STC');
  close(metrics.fillFactorNoct, (37.76 * 10.36) / (43.91 * 11.0), 1e-9, 'fill factor at NOCT');
  // Professor's formula: (high - low) / high x 100.
  close(metrics.noctVsStcPercent, ((530 - 391.3) / 530) * 100, 1e-9, 'NOCT vs STC');
});

test('metrics: the exercise worked examples reproduce exactly', () => {
  const fillFactor = parser.computeMetrics({
    vmp_stc: 41.05, imp_stc: 12.91, voc_stc: 47.74, isc_stc: 13.71
  }).fillFactorStc;
  close(fillFactor, 0.80969, 1e-5, 'fill factor for the exercise cell');

  const efficiency = parser.computeMetrics({
    pmax_stc: 400, height_mm: 1850, length_mm: 1000
  }).efficiency;
  close(efficiency, 21.6216, 1e-4, 'efficiency of a 400 W module over 1.850 m2');
});

test('metrics: power tolerance is read in both watt and percent forms', () => {
  const bounds = (text, pmax) => parser.powerToleranceBounds(text, pmax);
  assert.deepEqual(
    { min: bounds('0 to +10', 530).min, max: bounds('0 to +10', 530).max }, { min: 530, max: 540 }
  );
  assert.deepEqual(
    { min: bounds('0/+10', 390).min, max: bounds('0/+10', 390).max }, { min: 390, max: 400 }
  );
  assert.deepEqual(
    { min: bounds('0 ~ + 10 W', 650).min, max: bounds('0 ~ + 10 W', 650).max }, { min: 650, max: 660 }
  );
  assert.deepEqual(
    { min: bounds('-0/+5 W', 300).min, max: bounds('-0/+5 W', 300).max }, { min: 300, max: 305 }
  );
  close(bounds('± 3 %', 400).min, 388, 1e-9, 'symmetric percent minimum');
  close(bounds('± 3 %', 400).max, 412, 1e-9, 'symmetric percent maximum');
  close(bounds('0/+3%', 400).max, 412, 1e-9, 'one-sided percent maximum');
  close(bounds('0/+3%', 400).min, 400, 1e-9, 'one-sided percent minimum');
  assert.equal(bounds('', 530), null);
  assert.equal(bounds('0 to +10', null), null);
});

test('metrics: cross-checks agree on every fixture that has a full STC block', () => {
  for (const [name, columnIndex] of [['silfab', 0], ['rec', 0], ['rec', 1], ['qcells', 0], ['qcells', 5]]) {
    const { values } = read(name, columnIndex);
    for (const check of parser.computeMetrics(values).checks) {
      assert.ok(check.ok, `${name} col ${columnIndex}: ${check.label} disagreed by ${(check.relative * 100).toFixed(2)}%`);
    }
  }
});

test('metrics: a mistyped value is caught by the cross-checks', () => {
  const { values } = read('silfab');
  const checks = parser.computeMetrics({ ...values, voc_stc: 4.774 }).checks;
  // Voc does not feed Pmax or efficiency, so a decimal slip must still be
  // visible somewhere: the fill factor it produces is physically impossible.
  const fillFactor = parser.computeMetrics({ ...values, voc_stc: 4.774 }).fillFactorStc;
  assert.ok(fillFactor > 1, 'an impossible fill factor must be reported, not hidden');
  assert.ok(checks.every(check => Number.isFinite(check.relative)));

  const wrongPmax = parser.computeMetrics({ ...values, pmax_stc: 630 }).checks;
  assert.ok(wrongPmax.some(check => !check.ok), 'a wrong Pmax must fail at least one cross-check');
});

// --- Failure modes --------------------------------------------------------

test('an empty or image-only PDF reports that nothing was found', () => {
  const result = parser.extractDatasheet([{ page: 1, items: [] }]);
  assert.deepEqual(result.fields, {});
  assert.ok(result.warnings.some(w => /scan|not recognised|no datasheet values/i.test(w)));
});

test('prose that merely discusses datasheets yields no values', () => {
  // A lecture handout names every quantity a datasheet does. Nothing on it is
  // a labelled table row, so nothing may be reported.
  const lines = [
    'Specification Sheets. In this reading I identify a few common areas found in',
    'the specification sheets of PV modules. You need the open circuit voltage Voc',
    'and the short circuit current Isc, along with NOCT, to size a string of 12',
    'modules for a 400 kW system at 1000 W/m2 irradiance.'
  ];
  const items = lines.map((text, index) => ({ str: text, x: 40, y: 700 - index * 12, w: 480, h: 9 }));
  const result = parser.extractDatasheet([{ page: 1, items }]);
  assert.deepEqual(result.fields, {});
  assert.ok(result.warnings.some(w => /no datasheet values/i.test(w)));
});

test('buildRows groups a table into rows and cells', () => {
  const rows = parser.buildRows([
    { str: 'Open circuit voltage (Voc)', x: 54, y: 694, w: 120, h: 7 },
    { str: 'V', x: 204, y: 694, w: 5, h: 7 },
    { str: '47.74', x: 267, y: 694, w: 20, h: 7 },
    { str: 'Short circuit current (Isc)', x: 54, y: 684, w: 120, h: 7 }
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].cells.map(c => c.text), ['Open circuit voltage (Voc)', 'V', '47.74']);
});
