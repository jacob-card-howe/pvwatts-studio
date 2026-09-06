// Regression checks for the browser PVWatts client. Run with:
//   node tests/test_pvwatts_client.mjs
// Upstream calls are stubbed, so this consumes no API quota.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PVWattsClient,
  searchLocations,
  validateSimulationParams,
  normalizePvwattsResponse,
  PVWATTS_API_URL
} = require('../static/pvwatts_client.js');

const OUTPUTS = {
  ac_annual: 5200.0,
  solrad_annual: 4.1,
  capacity_factor: 14.8,
  ac_monthly: Array.from({ length: 12 }, (_value, index) => 400 + index),
  dc_monthly: Array.from({ length: 12 }, (_value, index) => 420 + index),
  solrad_monthly: Array.from({ length: 12 }, () => 4.1),
  poa_monthly: Array.from({ length: 12 }, () => 120.0)
};

const BASE_PARAMS = { lat: 47.491, lon: -122.216 };

/** Capture the requested URL and reply with a canned upstream response. */
function stubFetch(body, { status = 200, json = true } = {}) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!json) throw new SyntaxError('Unexpected token');
        return body;
      }
    };
  };
  return { calls, fetchImpl };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

test('defaults match the canonical PVWatts request', () => {
  const inputs = validateSimulationParams(BASE_PARAMS);
  assert.equal(inputs.system_capacity, 4.0);
  assert.equal(inputs.losses, 14.08);
  assert.equal(inputs.tilt, 20.0);
  assert.equal(inputs.azimuth, 180.0);
  assert.equal(inputs.inv_eff, 96.0);
  assert.equal(inputs.use_wf_albedo, 1);
  assert.equal(inputs.albedo, null);
  assert.deepEqual(inputs.soiling, new Array(12).fill(0));
});

test('out-of-range and non-numeric inputs are rejected', () => {
  const cases = [
    [{ ...BASE_PARAMS, losses: 999 }, /losses must be between -5 and 99/],
    [{ ...BASE_PARAMS, tilt: 91 }, /tilt must be between 0 and 90/],
    [{ ...BASE_PARAMS, systemCapacityKw: 0 }, /systemCapacityKw/],
    [{ ...BASE_PARAMS, moduleType: 1.5 }, /moduleType must be an integer/],
    [{ ...BASE_PARAMS, invEff: 80 }, /invEff must be between 90 and 99.5 percent/],
    [{ ...BASE_PARAMS, groundCoverageRatio: 0 }, /groundCoverageRatio/],
    [{ lat: 47.5, lon: 'not-a-number' }, /lon must be a number/],
    [{ lat: 47.5 }, /lon must be a number/],
    [{ ...BASE_PARAMS, monthlyIrradianceLosses: [0, 0] }, /exactly 12 monthly values/],
    [
      { ...BASE_PARAMS, useWeatherFileAlbedo: false, albedo: 1 },
      /albedo must be greater than 0 and less than 1/
    ]
  ];
  for (const [params, pattern] of cases) {
    assert.throws(() => validateSimulationParams(params), pattern);
  }
});

test('empty strings and arrays are not coerced to zero', () => {
  // Number('') and Number([]) are both 0, which would silently accept junk.
  assert.throws(() => validateSimulationParams({ lat: '', lon: -122 }), /lat must be a number/);
  assert.throws(() => validateSimulationParams({ lat: [], lon: -122 }), /lat must be a number/);
});

test('a fractional inverter efficiency is rescaled to percent', () => {
  assert.equal(validateSimulationParams({ ...BASE_PARAMS, invEff: 0.96 }).inv_eff, 96);
});

test('azimuth 360 is normalized to north', () => {
  assert.equal(validateSimulationParams({ ...BASE_PARAMS, azimuth: 360 }).azimuth, 0);
});

test('the request carries the canonical dataset parameters and the API key', async () => {
  const { calls, fetchImpl } = stubFetch({ outputs: OUTPUTS, station_info: { lat: 47.5 } });
  const client = new PVWattsClient({ fetchImpl });
  await client.simulate(BASE_PARAMS, { apiKey: '  test-key  ' });

  const url = new URL(calls[0]);
  assert.equal(`${url.origin}${url.pathname}`, PVWATTS_API_URL);
  assert.equal(url.searchParams.get('api_key'), 'test-key');
  assert.equal(url.searchParams.get('dataset'), 'nsrdb');
  assert.equal(url.searchParams.get('radius'), '0');
  assert.equal(url.searchParams.get('timeframe'), 'monthly');
  assert.equal(url.searchParams.get('soiling'), new Array(12).fill('0').join('|'));
  assert.equal(url.searchParams.has('albedo'), false);
});

test('a blank key falls back to DEMO_KEY, and albedo is sent only when set', async () => {
  const { calls, fetchImpl } = stubFetch({ outputs: OUTPUTS });
  const client = new PVWattsClient({ fetchImpl });
  await client.simulate(
    { ...BASE_PARAMS, useWeatherFileAlbedo: false, albedo: 0.25 },
    { apiKey: '   ' }
  );

  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get('api_key'), 'DEMO_KEY');
  assert.equal(url.searchParams.get('albedo'), '0.25');
  assert.equal(url.searchParams.get('use_wf_albedo'), '0');
});

test('the response is normalized to the shape the UI renders', async () => {
  const { fetchImpl } = stubFetch({
    outputs: OUTPUTS,
    station_info: { lat: 47.5, lon: -122.2 },
    version: '8.5.0'
  });
  const result = await new PVWattsClient({ fetchImpl }).simulate(BASE_PARAMS);

  assert.equal(result.annualAcKwh, 5200.0);
  assert.equal(result.kwhPerKw, 1300.0);
  assert.equal(result.monthlyAc.length, 12);
  assert.equal(result.monthlyPoa.length, 12);
  assert.equal(result.monthNames[0], 'Jan');
  assert.equal(result.version, '8.5.0');
  assert.equal(result.dataset, 'NSRDB');
  assert.deepEqual(result.stationInfo, { lat: 47.5, lon: -122.2 });
  assert.equal(result.parameters.tilt, 20.0);
  assert.equal(result.parameters.useWeatherFileAlbedo, true);
});

test('identical simulations are served from the cache', async () => {
  const { calls, fetchImpl } = stubFetch({ outputs: OUTPUTS });
  const client = new PVWattsClient({ fetchImpl });
  await client.simulate(BASE_PARAMS);
  await client.simulate(BASE_PARAMS);
  await client.simulate({ ...BASE_PARAMS, tilt: 30 });
  assert.equal(calls.length, 2);
});

test('the cache evicts the least recently used entry', async () => {
  const { calls, fetchImpl } = stubFetch({ outputs: OUTPUTS });
  const client = new PVWattsClient({ fetchImpl, cacheSize: 2 });
  await client.simulate({ ...BASE_PARAMS, tilt: 10 });
  await client.simulate({ ...BASE_PARAMS, tilt: 20 });
  await client.simulate({ ...BASE_PARAMS, tilt: 10 }); // refreshes tilt 10
  await client.simulate({ ...BASE_PARAMS, tilt: 30 }); // evicts tilt 20
  assert.equal(calls.length, 3);
  await client.simulate({ ...BASE_PARAMS, tilt: 10 });
  assert.equal(calls.length, 3, 'tilt 10 should still be cached');
  await client.simulate({ ...BASE_PARAMS, tilt: 20 });
  assert.equal(calls.length, 4, 'tilt 20 should have been evicted');
});

test('a rate-limited response explains how to supply a key', async () => {
  const { fetchImpl } = stubFetch(
    { error: { code: 'OVER_RATE_LIMIT', message: 'rate limit exceeded' } },
    { status: 429 }
  );
  const error = await rejection(new PVWattsClient({ fetchImpl }).simulate(BASE_PARAMS));
  assert.equal(error.code, 'rate_limit');
  assert.equal(error.status, 429);
  assert.match(error.message, /developer key/);
});

test('an invalid key surfaces the upstream message and code', async () => {
  const { fetchImpl } = stubFetch(
    { error: { code: 'API_KEY_INVALID', message: 'An invalid api_key was supplied.' } },
    { status: 403 }
  );
  const error = await rejection(new PVWattsClient({ fetchImpl }).simulate(BASE_PARAMS));
  assert.equal(error.code, 'API_KEY_INVALID');
  assert.equal(error.message, 'An invalid api_key was supplied.');
});

test('a 422 reports the upstream validation errors rather than "None"', async () => {
  const { fetchImpl } = stubFetch(
    { errors: ["'losses' must be between -5 and 99"], warnings: [] },
    { status: 422 }
  );
  const error = await rejection(new PVWattsClient({ fetchImpl }).simulate(BASE_PARAMS));
  assert.equal(error.message, "'losses' must be between -5 and 99");
  assert.equal(error.code, 'pvwatts_error');
});

test('an incomplete or malformed payload is rejected', () => {
  assert.throws(
    () => normalizePvwattsResponse({ outputs: { ac_annual: 1 } }, { system_capacity: 4 }),
    /incomplete response \(missing solrad_annual/
  );
  assert.throws(
    () => normalizePvwattsResponse(
      { outputs: { ...OUTPUTS, ac_monthly: [1, 2, 3] } },
      { system_capacity: 4 }
    ),
    /invalid monthly data for ac_monthly/
  );
});

test('a network failure is reported as an unreachable service', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  const error = await rejection(new PVWattsClient({ fetchImpl }).simulate(BASE_PARAMS));
  assert.equal(error.code, 'service_unavailable');
  assert.match(error.message, /Could not reach PVWatts/);
});

test('an aborted simulation rethrows the abort', async () => {
  const fetchImpl = async () => {
    throw new DOMException('The operation was aborted.', 'AbortError');
  };
  const error = await rejection(new PVWattsClient({ fetchImpl }).simulate(BASE_PARAMS));
  assert.equal(error.name, 'AbortError');
});

test('a non-JSON body is reported instead of crashing', async () => {
  const { fetchImpl } = stubFetch(null, { json: false });
  const error = await rejection(new PVWattsClient({ fetchImpl }).simulate(BASE_PARAMS));
  assert.equal(error.code, 'invalid_json');
});

test('coordinate queries resolve without calling the geocoder', async () => {
  const { calls, fetchImpl } = stubFetch([]);
  const results = await searchLocations('47.491, -122.216', { fetchImpl });
  assert.equal(calls.length, 0);
  assert.deepEqual(results, [
    { name: '47.491000, -122.216000', lat: 47.491, lon: -122.216, type: 'coordinates' }
  ]);
});

test('short and overlong queries are rejected', async () => {
  await assert.rejects(searchLocations('a'), /at least two characters/);
  await assert.rejects(searchLocations('x'.repeat(201)), /too long/);
});

test('a US state suffix restricts the geocoder to the United States', async () => {
  const { calls, fetchImpl } = stubFetch([]);
  await searchLocations('Reston, WA', { fetchImpl });
  assert.equal(new URL(calls[0]).searchParams.get('countrycodes'), 'us');

  const foreign = stubFetch([]);
  await searchLocations('Perth, Australia', { fetchImpl: foreign.fetchImpl });
  assert.equal(new URL(foreign.calls[0]).searchParams.has('countrycodes'), false);
});

test('results in the requested state are ranked first and capped at five', async () => {
  const { fetchImpl } = stubFetch([
    { display_name: 'Reston, Western Australia', lat: '-31.9', lon: '115.8', address: {} },
    {
      display_name: 'Reston, Washington',
      lat: '47.4',
      lon: '-122.2',
      address: { 'ISO3166-2-lvl4': 'US-WA' }
    },
    ...Array.from({ length: 8 }, (_value, index) => ({
      display_name: `Filler ${index}`,
      lat: '40',
      lon: '-105',
      address: {}
    }))
  ]);
  const results = await searchLocations('Reston, WA', { fetchImpl });
  assert.equal(results.length, 5);
  assert.equal(results[0].name, 'Reston, Washington');
});

test('geocoder entries with unusable coordinates are skipped', async () => {
  const { fetchImpl } = stubFetch([
    { display_name: 'Broken', lat: 'nope', lon: '1' },
    { display_name: 'Good', lat: '40', lon: '-105' }
  ]);
  const results = await searchLocations('somewhere', { fetchImpl });
  assert.deepEqual(results.map(result => result.name), ['Good']);
});
