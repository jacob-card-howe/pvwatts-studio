// Regression checks for the in-browser orientation model. Run with:
//   node --test tests/test_orientation_model.mjs
// The fixture holds PVWatts v8 (NREL-PySAM Pvwattsv8) results on a real TMY3
// file; regenerate it with tools/make_orientation_fixture.py.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OrientationModel = require('../static/orientation_model.js');

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/orientation/greensboro_tmy3.json', import.meta.url), 'utf8')
);
const weather = { ...fixture.weather, ...fixture.station };

function systemParams(system) {
  return {
    systemCapacityKw: system.kw,
    moduleType: system.module,
    arrayType: system.array,
    losses: system.losses,
    dcAcRatio: system.dcac,
    invEff: system.inv,
    groundCoverageRatio: system.gcr,
    monthlyIrradianceLosses: system.soiling,
    useWeatherFileAlbedo: true,
    bifaciality: 0
  };
}

const prepared = OrientationModel.prepareWeather(weather, { timeMode: 'interpolate' });

test('annual AC energy matches PVWatts v8 across systems and orientations', () => {
  for (const [name, { system, rows }] of Object.entries(fixture.systems)) {
    const sys = OrientationModel.prepareSystem(systemParams(system));
    for (const row of rows) {
      const local = OrientationModel.simulate(prepared, sys, row.tilt, row.azimuth).acKwh;
      const difference = Math.abs(local / row.ac_annual - 1) * 100;
      assert.ok(
        difference < 0.15,
        `${name} at ${row.tilt}/${row.azimuth}: local ${local.toFixed(1)} vs PVWatts ${row.ac_annual.toFixed(1)} kWh (${difference.toFixed(3)}%)`
      );
    }
  }
});

test('the efficiency lookup table tracks the direct single-diode solve', () => {
  for (const moduleType of [0, 1, 2]) {
    const sys = OrientationModel.prepareSystem({ ...systemParams(fixture.systems.standard_rack_4kw.system), moduleType });
    for (const [tilt, azimuth] of [[20, 180], [45, 120], [90, 270]]) {
      const exact = OrientationModel.simulate(prepared, sys, tilt, azimuth, { exact: true }).acKwh;
      const table = OrientationModel.simulate(prepared, sys, tilt, azimuth).acKwh;
      assert.ok(Math.abs(table / exact - 1) < 1e-4, `module ${moduleType} at ${tilt}/${azimuth}`);
    }
  }
});

test('calibration detects the timestamp convention from the official hourly POA', () => {
  const { official } = fixture;
  const model = OrientationModel.calibrate(weather, systemParams(fixture.systems[official.system].system), {
    tilt: official.tilt,
    azimuth: official.azimuth,
    acAnnualKwh: official.ac_annual,
    hourlyPoa: official.poa
  });
  assert.equal(model.timeMode, 'interpolate');
  assert.ok(model.baseline.poaRmse < 1, `POA RMSE ${model.baseline.poaRmse}`);
  assert.ok(Math.abs(model.scale - 1) < 0.002, `scale ${model.scale}`);
});

test('the search finds the brute-force PVWatts optimum', async () => {
  const { search } = fixture;
  const params = systemParams(fixture.systems[search.system].system);
  const model = {
    prepared,
    system: OrientationModel.prepareSystem(params),
    scale: 1
  };
  let lastProgress = 0;
  const result = await OrientationModel.optimize(model, {
    onProgress: (done, total) => { lastProgress = done / total; }
  });
  assert.equal(lastProgress, 1);
  assert.ok(Math.abs(result.best.tilt - search.best.tilt) <= 1, `tilt ${result.best.tilt}`);
  assert.ok(Math.abs(result.best.azimuth - search.best.azimuth) <= 1, `azimuth ${result.best.azimuth}`);
  const official = search.grid[`${result.best.tilt},${result.best.azimuth}`];
  assert.ok(official / search.best.ac_annual > 0.9999, 'the chosen orientation is within 0.01% of the true optimum');
  assert.equal(result.values.length, result.tilts.length * result.azimuths.length);
});

test('a cancelled search stops between chunks', async () => {
  const controller = new AbortController();
  const model = { prepared, system: OrientationModel.prepareSystem(systemParams(fixture.systems.standard_rack_4kw.system)), scale: 1 };
  const search = OrientationModel.optimize(model, {
    signal: controller.signal,
    chunkMs: 0,
    onProgress: () => controller.abort()
  });
  await assert.rejects(search, { name: 'AbortError' });
});

test('trackers and bifacial systems fall back to the official sweep', () => {
  const base = systemParams(fixture.systems.standard_rack_4kw.system);
  assert.equal(OrientationModel.localModelSupport(base).supported, true);
  assert.equal(OrientationModel.localModelSupport({ ...base, arrayType: 1 }).supported, true);
  for (const arrayType of [2, 3, 4]) {
    assert.equal(OrientationModel.localModelSupport({ ...base, arrayType }).supported, false);
  }
  assert.equal(OrientationModel.localModelSupport({ ...base, bifaciality: 0.7 }).supported, false);
  assert.throws(() => OrientationModel.prepareSystem({ ...base, arrayType: 2 }), /Tracking arrays/);
});

test('hourly responses are read into weather and the official baseline', () => {
  const payload = {
    inputs: { tilt: '20', azimuth: '180', lat: '36.1', lon: '-79.9' },
    station_info: { ...fixture.station },
    outputs: { ...fixture.weather, poa: fixture.official.poa, ac_annual: fixture.official.ac_annual }
  };
  const parsed = OrientationModel.weatherFromPvwattsResponse(payload);
  assert.equal(parsed.weather.tz, fixture.station.tz);
  assert.equal(parsed.official.tilt, 20);
  assert.equal(parsed.official.hourlyPoa.length, OrientationModel.HOURS_PER_YEAR);
  assert.throws(
    () => OrientationModel.weatherFromPvwattsResponse({ outputs: { ac_annual: 1 } }),
    /timeframe=hourly/
  );
  assert.throws(
    () => OrientationModel.prepareWeather({ ...weather, dn: weather.dn.slice(1) }),
    /8760 values/
  );
});

test('sun position agrees with the solar noon and sunrise on the equinox', () => {
  // At 0 N, 0 E on the March equinox the sun is near the zenith at noon UTC.
  const noon = OrientationModel.sunPosition(2001, 3, 20, 12.1, 0, 0, 0, 1013.25, 15);
  assert.ok(noon.zenith < 1.5, `zenith ${noon.zenith}`);
  const { sunrise, sunset } = OrientationModel.sunriseSunset(2001, 3, 20, 0, 0, 0);
  assert.ok(Math.abs(sunrise - 6.0) < 0.15 && Math.abs(sunset - 18.2) < 0.15, `${sunrise}, ${sunset}`);
});

test('monthly energy by tilt matches PVWatts v8', () => {
  const { seasonal } = fixture;
  const sys = OrientationModel.prepareSystem(systemParams(fixture.systems[seasonal.system].system));
  for (const tilt of [0, 10, 28, 45, 60, 90]) {
    const local = OrientationModel.simulate(prepared, sys, tilt, seasonal.azimuth, { monthly: true });
    const official = seasonal.monthly_ac[tilt];
    local.monthlyAcKwh.forEach((value, month) => {
      const difference = Math.abs(value / official[month] - 1) * 100;
      assert.ok(difference < 0.5, `tilt ${tilt}, month ${month + 1}: ${value.toFixed(2)} vs ${official[month]} kWh (${difference.toFixed(3)}%)`);
    });
    const total = local.monthlyAcKwh.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total / local.acKwh - 1) < 1e-9, 'monthly totals add up to the annual total');
  }
});

test('seasonal tilt schedules match a brute-force PVWatts search', async () => {
  const { seasonal } = fixture;
  const model = { prepared, system: OrientationModel.prepareSystem(systemParams(fixture.systems[seasonal.system].system)), scale: 1 };
  let lastProgress = 0;
  const result = await OrientationModel.tiltSchedules(model, seasonal.azimuth, {
    onProgress: (done, total) => { lastProgress = done / total; }
  });
  assert.equal(lastProgress, 1);
  assert.deepEqual(result.schedules.map(schedule => schedule.settings), [1, 2, 4, 12]);

  // Score each local schedule with the official monthly energies: the split
  // it picks may differ on a flat plateau, but the energy must not.
  const officialEnergy = blocks => blocks.reduce((total, block) => {
    for (let i = 0; i < block.months; i += 1) {
      total += seasonal.monthly_ac[block.tilt][(block.startMonth - 1 + i) % 12];
    }
    return total;
  }, 0);
  result.schedules.forEach((schedule, index) => {
    const reference = seasonal.schedules[index];
    assert.equal(schedule.settings, reference.settings);
    assert.ok(schedule.blocks.length <= schedule.settings);
    assert.equal(schedule.blocks.reduce((months, block) => months + block.months, 0), 12);
    const ratio = officialEnergy(schedule.blocks) / reference.ac_annual;
    assert.ok(ratio > 0.9995, `${schedule.settings} settings: ${(ratio * 100).toFixed(3)}% of the PVWatts optimum`);
  });

  // Fixed is the annual optimum at this azimuth; monthly is each month's best tilt.
  assert.equal(result.schedules[0].blocks[0].tilt, seasonal.schedules[0].blocks[0].tilt);
  result.monthlyBest.forEach((month, index) => {
    assert.ok(Math.abs(month.tilt - seasonal.schedules[3].blocks[index].tilt) <= 1, `month ${index + 1}: ${month.tilt}°`);
  });
  const gains = result.schedules.map(schedule => schedule.annualKwh);
  assert.ok(gains[0] < gains[1] && gains[1] < gains[2] && gains[2] < gains[3], 'more settings never lose energy');
});

test('the noon-sun reference follows the solar declination', async () => {
  // Cooper's textbook equation, 23.45 sin(360 (284 + n) / 365), is within about a degree.
  for (const [month, day, n] of [[1, 17, 17], [3, 20, 79], [6, 21, 172], [9, 22, 265], [12, 21, 355]]) {
    const cooper = 23.45 * Math.sin(2 * Math.PI * (284 + n) / 365);
    assert.ok(Math.abs(OrientationModel.solarDeclination(month, day) - cooper) < 1.1, `${month}/${day}`);
  }
  const model = { prepared, system: OrientationModel.prepareSystem(systemParams(fixture.systems.standard_rack_4kw.system)), scale: 1 };
  const south = await OrientationModel.tiltSchedules(model, 180, { settings: [1] });
  south.noonSunTilt.forEach((tilt, month) => {
    assert.ok(Math.abs(tilt - (prepared.lat - south.declination[month])) < 1e-9);
  });
  assert.ok(south.declination[5] > 23 && south.declination[11] < -23, 'June and December near the solstice values');
  const east = await OrientationModel.tiltSchedules(model, 90, { settings: [1] });
  assert.equal(east.noonSunTilt, null, 'no noon-sun reference for an array that does not face the equator');
});

test('schedule blocks that share a tilt merge across the new year', () => {
  // Winter tilt in Nov-Feb, summer tilt in Mar-Oct; four settings should collapse to two.
  const tilts = [10, 50];
  const monthlyKwh = new Float64Array(24);
  for (let m = 0; m < 12; m += 1) {
    const winter = m <= 1 || m >= 10;
    monthlyKwh[m] = winter ? 1 : 2;
    monthlyKwh[12 + m] = winter ? 2 : 1;
  }
  const schedule = OrientationModel.bestSchedule(tilts, monthlyKwh, 4);
  assert.equal(schedule.annualKwh, 24);
  assert.deepEqual(schedule.blocks.map(({ startMonth, months, tilt }) => [startMonth, months, tilt]).sort((a, b) => a[0] - b[0]),
    [[3, 8, 10], [11, 4, 50]]);
});
