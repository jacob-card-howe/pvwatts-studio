// Checks for the in-browser World Magnetic Model. Run with:
//   node --test tests/test_magnetic_declination.mjs
// The fixture holds the official WMM2025 test values (NOAA NCEI / BGS).

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MagneticDeclination = require('../static/magnetic_declination.js');

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/magnetic/wmm2025_test_values.json', import.meta.url), 'utf8')
);

test('field components and declination match every official WMM2025 test value', () => {
  for (const [year, altitudeKm, lat, lon, x, y, z] of fixture.rows) {
    const where = `${lat}, ${lon} at ${altitudeKm} km in ${year}`;
    const field = MagneticDeclination.fieldComponents(lat, lon, { altitudeKm, year });
    assert.ok(Math.abs(field.x - x) < 0.5, `${where}: X ${field.x.toFixed(2)} vs ${x}`);
    assert.ok(Math.abs(field.y - y) < 0.5, `${where}: Y ${field.y.toFixed(2)} vs ${y}`);
    assert.ok(Math.abs(field.z - z) < 0.5, `${where}: Z ${field.z.toFixed(2)} vs ${z}`);
    const expected = Math.atan2(y, x) * 180 / Math.PI;
    const { declination } = MagneticDeclination.declination(lat, lon, { altitudeKm, year });
    assert.ok(Math.abs(declination - expected) < 0.01, `${where}: D ${declination.toFixed(3)} vs ${expected.toFixed(3)}`);
  }
});

test('compass bearings follow the true-to-magnetic rule', () => {
  // 14°9′ W: true south reads 194.15° on the compass. 5° E: it reads 175°.
  assert.ok(Math.abs(MagneticDeclination.magneticBearing(180, -(14 + 9 / 60)) - 194.15) < 1e-9);
  assert.equal(MagneticDeclination.magneticBearing(180, 5), 175);
  assert.equal(MagneticDeclination.magneticBearing(2, 5), 357);
  assert.equal(MagneticDeclination.magneticBearing(358, -5), 3);
  assert.equal(MagneticDeclination.formatDeclination(-8.64), '8.6° W');
  assert.equal(MagneticDeclination.formatDeclination(15.25), '15.3° E');
  assert.equal(MagneticDeclination.formatDeclination(-0.02), '0°');
});

test('dates are converted to decimal years and checked against the model window', () => {
  assert.equal(MagneticDeclination.decimalYear(new Date(Date.UTC(2026, 0, 1))), 2026);
  assert.ok(Math.abs(MagneticDeclination.decimalYear(new Date(Date.UTC(2028, 6, 2))) - 2028.5) < 0.002);
  const now = MagneticDeclination.declination(36.1, -79.95, { date: new Date(Date.UTC(2026, 8, 25)) });
  assert.equal(now.model, 'WMM-2025');
  assert.equal(now.inRange, true);
  assert.ok(now.declination < -7 && now.declination > -11, `Greensboro, NC: ${now.declination}`);
  assert.equal(MagneticDeclination.declination(36.1, -79.95, { year: 2031 }).inRange, false);
  assert.ok(Number.isFinite(MagneticDeclination.declination(90, 0, { year: 2026 }).declination), 'no NaN at the pole');
});
