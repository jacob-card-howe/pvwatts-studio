/**
 * PVWatts Studio - browser client for the official PVWatts v8 and location APIs.
 *
 * Both upstream services send `Access-Control-Allow-Origin: *`, on success and
 * on error, so the browser calls them directly and the app deploys as static
 * files. This module is a port of the former local Python proxy: the same
 * validation, the same canonical request, and the same normalized response
 * shape the rest of the app already expects.
 */

const PVWATTS_API_URL = 'https://developer.nlr.gov/api/pvwatts/v8.json';
const GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEMO_KEY = 'DEMO_KEY';

const RATE_LIMIT_MESSAGE =
  'PVWatts rate limit reached. Enter your free NLR developer key above instead of ' +
  'relying on the shared DEMO_KEY.';

const COORDINATE_QUERY = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[, ]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/;
const US_STATE_QUERY = /(?:,\s*|\s+)([A-Za-z]{2})(?:\s*,?\s*(?:US|USA|United States))?\s*$/i;
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC'
]);

/** An upstream geocoding or PVWatts service returned an error. */
function serviceError(message, { code = 'upstream_error', status = 502 } = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function finiteNumber(value, name, minimum, maximum) {
  const type = typeof value;
  const numeric = type === 'number' || type === 'boolean' || (type === 'string' && value.trim() !== '');
  const number = numeric ? Number(value) : NaN;
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  if (number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function exclusiveFraction(value, name) {
  const number = finiteNumber(value, name, 0, 1);
  if (number <= 0 || number >= 1) {
    throw new Error(`${name} must be greater than 0 and less than 1`);
  }
  return number;
}

function binaryFlag(value, name) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const number = finiteNumber(value, name, 0, 1);
  if (number !== 0 && number !== 1) throw new Error(`${name} must be 0 or 1`);
  return number;
}

function monthlyValues(value, name) {
  const values = typeof value === 'string' ? value.split('|') : value;
  if (!Array.isArray(values) || values.length !== 12) {
    throw new Error(`${name} must contain exactly 12 monthly values`);
  }
  return values.map((monthValue, index) => finiteNumber(monthValue, `${name}[${index}]`, 0, 100));
}

function fallback(value, defaultValue) {
  return value === undefined || value === null ? defaultValue : value;
}

/** Validate browser parameters and return canonical PVWatts values. */
function validateSimulationParams(params) {
  const moduleType = finiteNumber(fallback(params.moduleType, 0), 'moduleType', 0, 2);
  const arrayType = finiteNumber(fallback(params.arrayType, 0), 'arrayType', 0, 4);
  if (!Number.isInteger(moduleType)) throw new Error('moduleType must be an integer');
  if (!Number.isInteger(arrayType)) throw new Error('arrayType must be an integer');

  let invEff = finiteNumber(fallback(params.invEff, 96.0), 'invEff', 0, 100);
  // Backwards compatibility with the old browser engine's fractional value.
  if (invEff <= 1.0) invEff *= 100.0;
  if (invEff < 90.0 || invEff > 99.5) {
    throw new Error('invEff must be between 90 and 99.5 percent');
  }

  const useWfAlbedo = binaryFlag(fallback(params.useWeatherFileAlbedo, true), 'useWeatherFileAlbedo');
  const albedo = useWfAlbedo ? null : exclusiveFraction(params.albedo, 'albedo');

  return {
    system_capacity: finiteNumber(fallback(params.systemCapacityKw, 4.0), 'systemCapacityKw', 0.05, 500000),
    module_type: moduleType,
    array_type: arrayType,
    losses: finiteNumber(fallback(params.losses, 14.08), 'losses', -5, 99),
    tilt: finiteNumber(fallback(params.tilt, 20.0), 'tilt', 0, 90),
    // The API requires azimuth to be less than 360. Treat 360 as north/0.
    azimuth: finiteNumber(fallback(params.azimuth, 180.0), 'azimuth', 0, 360) % 360,
    dc_ac_ratio: finiteNumber(fallback(params.dcAcRatio, 1.2), 'dcAcRatio', 0.5, 3),
    inv_eff: invEff,
    gcr: finiteNumber(fallback(params.groundCoverageRatio, 0.4), 'groundCoverageRatio', 0.01, 0.99),
    use_wf_albedo: useWfAlbedo,
    albedo,
    bifaciality: finiteNumber(fallback(params.bifaciality, 0), 'bifaciality', 0, 1),
    soiling: monthlyValues(fallback(params.monthlyIrradianceLosses, new Array(12).fill(0)), 'monthlyIrradianceLosses'),
    lat: finiteNumber(params.lat, 'lat', -90, 90),
    lon: finiteNumber(params.lon, 'lon', -180, 180)
  };
}

/** Map the official snake_case response to the browser's stable shape. */
function normalizePvwattsResponse(payload, inputs) {
  const topLevelError = payload.error;
  if (topLevelError) {
    const isObject = topLevelError && typeof topLevelError === 'object';
    const code = String(isObject ? (topLevelError.code || 'pvwatts_error') : 'pvwatts_error');
    const rateLimited = ['OVER_RATE_LIMIT', 'RATE_LIMIT'].includes(code.toUpperCase());
    const message = rateLimited
      ? RATE_LIMIT_MESSAGE
      : String((isObject ? topLevelError.message : topLevelError) || JSON.stringify(topLevelError));
    throw serviceError(message, { status: rateLimited ? 429 : 502, code });
  }

  const errors = payload.errors || [];
  if (errors.length) {
    throw serviceError(errors.map(String).join('; '), { status: 422, code: 'pvwatts_error' });
  }

  const outputs = payload.outputs || {};
  const required = ['ac_annual', 'solrad_annual', 'capacity_factor', 'ac_monthly', 'dc_monthly', 'solrad_monthly'];
  const missing = required.filter(name => !(name in outputs));
  if (missing.length) {
    throw serviceError(
      `PVWatts returned an incomplete response (missing ${missing.join(', ')})`,
      { code: 'invalid_pvwatts_response' }
    );
  }

  const monthlyFields = ['ac_monthly', 'dc_monthly', 'solrad_monthly'];
  const invalidMonthly = monthlyFields.filter(
    name => !Array.isArray(outputs[name]) || outputs[name].length !== 12
  );
  if (invalidMonthly.length) {
    throw serviceError(
      `PVWatts returned invalid monthly data for ${invalidMonthly.join(', ')}`,
      { code: 'invalid_pvwatts_response' }
    );
  }

  const capacity = Number(inputs.system_capacity);
  const annualAc = Number(outputs.ac_annual);
  const poaMonthly = (outputs.poa_monthly || []).map(Number);
  if (poaMonthly.length && poaMonthly.length !== 12) {
    throw serviceError(
      'PVWatts returned invalid monthly plane-of-array data',
      { code: 'invalid_pvwatts_response' }
    );
  }

  return {
    annualAcKwh: annualAc,
    annualSolrad: Number(outputs.solrad_annual),
    capacityFactor: Number(outputs.capacity_factor),
    kwhPerKw: annualAc / capacity,
    monthlyAc: outputs.ac_monthly.map(Number),
    monthlyDc: outputs.dc_monthly.map(Number),
    monthlySolrad: outputs.solrad_monthly.map(Number),
    monthlyPoa: poaMonthly,
    monthNames: MONTH_NAMES,
    stationInfo: payload.station_info || {},
    warnings: payload.warnings || [],
    version: payload.version || '8',
    model: 'Official PVWatts v8 (SSC pvwattsv8)',
    dataset: 'NSRDB',
    parameters: {
      systemCapacityKw: capacity,
      moduleType: inputs.module_type,
      arrayType: inputs.array_type,
      losses: inputs.losses,
      tilt: inputs.tilt,
      azimuth: inputs.azimuth,
      dcAcRatio: inputs.dc_ac_ratio,
      invEff: inputs.inv_eff,
      groundCoverageRatio: inputs.gcr,
      useWeatherFileAlbedo: Boolean(inputs.use_wf_albedo),
      albedo: inputs.albedo === null ? null : Number(inputs.albedo),
      bifaciality: inputs.bifaciality,
      monthlyIrradianceLosses: inputs.soiling.map(Number),
      lat: inputs.lat,
      lon: inputs.lon
    }
  };
}

/**
 * Fetch JSON, translating transport and HTTP failures into service errors.
 * Aborts are re-thrown untouched so callers can drop superseded requests.
 */
async function requestJson(url, { service, signal, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw serviceError(`Could not reach ${service}. Check your network connection.`, {
      code: 'service_unavailable',
      status: 0
    });
  }

  let payload = null;
  let parsed = true;
  try {
    payload = await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    parsed = false;
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw serviceError(RATE_LIMIT_MESSAGE, { code: 'rate_limit', status: 429 });
    }
    // A 422 carries `errors`, while a key or quota problem carries `error`.
    if (parsed && Array.isArray(payload?.errors) && payload.errors.length) {
      throw serviceError(payload.errors.map(String).join('; '), {
        code: 'pvwatts_error',
        status: response.status
      });
    }
    const detail = parsed ? (payload?.error ?? payload) : null;
    const isObject = detail && typeof detail === 'object';
    throw serviceError(
      String((isObject ? detail.message : detail) || `HTTP ${response.status}`),
      {
        code: String((isObject && detail.code) || 'upstream_http_error'),
        status: response.status
      }
    );
  }

  if (!parsed) throw serviceError(`${service} returned invalid JSON`, { code: 'invalid_json' });
  return payload;
}

/** Small client for the canonical PVWatts v8 API, with an LRU result cache. */
class PVWattsClient {
  constructor({ apiUrl = PVWATTS_API_URL, cacheSize = 512, fetchImpl } = {}) {
    this.apiUrl = apiUrl;
    this.cacheSize = cacheSize;
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
  }

  async simulate(params, { apiKey, signal } = {}) {
    const inputs = validateSimulationParams(params);
    const cacheKey = JSON.stringify(inputs);
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }

    const query = new URLSearchParams({
      api_key: (apiKey || '').trim() || DEMO_KEY,
      system_capacity: inputs.system_capacity,
      module_type: inputs.module_type,
      array_type: inputs.array_type,
      losses: inputs.losses,
      tilt: inputs.tilt,
      azimuth: inputs.azimuth,
      dc_ac_ratio: inputs.dc_ac_ratio,
      inv_eff: inputs.inv_eff,
      gcr: inputs.gcr,
      use_wf_albedo: inputs.use_wf_albedo,
      bifaciality: inputs.bifaciality,
      // The API requires 12 monthly values in one pipe-delimited parameter.
      soiling: inputs.soiling.join('|'),
      lat: inputs.lat,
      lon: inputs.lon,
      dataset: 'nsrdb',
      radius: 0,
      timeframe: 'monthly'
    });
    if (inputs.albedo !== null) query.set('albedo', String(inputs.albedo));

    const payload = await requestJson(`${this.apiUrl}?${query}`, {
      service: 'PVWatts',
      signal,
      fetchImpl: this.fetchImpl
    });
    const result = normalizePvwattsResponse(payload, inputs);

    this.cache.set(cacheKey, result);
    while (this.cache.size > this.cacheSize) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return result;
  }
}

/**
 * Resolve a user-entered place/address, or accept a latitude/longitude pair.
 *
 * Searches are explicit (button/Enter), rather than request-on-every-keystroke,
 * to comply with the public Nominatim usage policy. The browser sets its own
 * User-Agent and Referer, which is how Nominatim identifies web clients.
 */
async function searchLocations(query, { signal, geocoderUrl = GEOCODER_URL, fetchImpl } = {}) {
  query = (query || '').trim();
  if (query.length < 2) {
    throw new Error('Enter at least two characters or a latitude, longitude pair');
  }
  if (query.length > 200) throw new Error('Location query is too long');

  const coordinateMatch = COORDINATE_QUERY.exec(query);
  if (coordinateMatch) {
    const lat = finiteNumber(coordinateMatch[1], 'latitude', -90, 90);
    const lon = finiteNumber(coordinateMatch[2], 'longitude', -180, 180);
    return [{ name: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, lat, lon, type: 'coordinates' }];
  }

  const searchParams = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '10'
  });
  const stateMatch = US_STATE_QUERY.exec(query);
  const requestedState = stateMatch ? stateMatch[1].toUpperCase() : null;
  if (requestedState && US_STATE_CODES.has(requestedState)) {
    // Nominatim otherwise interprets "WA" as Western Australia and can
    // bury the intended Washington result (as happened for Reston, WA).
    searchParams.set('countrycodes', 'us');
  }

  const payload = await requestJson(`${geocoderUrl}?${searchParams}`, {
    service: 'the location search service',
    signal,
    fetchImpl
  });
  if (!Array.isArray(payload)) {
    throw serviceError('Location search returned an unexpected response', {
      code: 'invalid_geocoder_response'
    });
  }

  const ranked = [];
  payload.slice(0, 10).forEach((item, index) => {
    let lat;
    let lon;
    try {
      lat = finiteNumber(item.lat, 'latitude', -90, 90);
      lon = finiteNumber(item.lon, 'longitude', -180, 180);
    } catch (_error) {
      return;
    }
    const address = item.address && typeof item.address === 'object' ? item.address : {};
    const isoRegion = String(address['ISO3166-2-lvl4'] || '').toUpperCase();
    const statePriority = requestedState && isoRegion === `US-${requestedState}` ? 0 : 1;
    ranked.push({
      statePriority,
      index,
      location: {
        name: item.display_name || item.name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
        lat,
        lon,
        type: item.type || 'place'
      }
    });
  });
  ranked.sort((a, b) => a.statePriority - b.statePriority || a.index - b.index);
  return ranked.slice(0, 5).map(candidate => candidate.location);
}

const PVWatts = {
  PVWattsClient,
  searchLocations,
  validateSimulationParams,
  normalizePvwattsResponse,
  MONTH_NAMES,
  PVWATTS_API_URL,
  GEOCODER_URL
};

if (typeof window !== 'undefined') window.PVWatts = PVWatts;
if (typeof module !== 'undefined' && module.exports) module.exports = PVWatts;
