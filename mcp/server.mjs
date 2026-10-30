/**
 * PVWatts Studio - Model Context Protocol server.
 *
 * A stateless Streamable HTTP endpoint (JSON-RPC 2.0 over POST) that lets an
 * agent run the same validated PVWatts v8 calls the web interface makes. It
 * reuses static/pvwatts_client.js, so the browser and the agents share one set
 * of input rules and one normalized result shape. It has no dependencies and
 * holds no per-session state, so it runs as a Cloudflare Pages Function.
 */

import PVWatts from '../static/pvwatts_client.js';

const { PVWattsClient, searchLocations, DATASETS } = PVWatts;

export const SERVER_INFO = Object.freeze({ name: 'pvwatts-studio', version: '1.0.0' });
export const SUPPORTED_PROTOCOLS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
const MAX_ORIENTATIONS = 12;
const USER_AGENT = 'pvwatts-studio-mcp (+https://jch-pvwatts-studio.pages.dev)';

const INSTRUCTIONS =
  'Estimate solar PV production with the official PVWatts v8 API. Give a place name or ' +
  'latitude/longitude plus system parameters; every field except the location is optional ' +
  'and defaults to the same values as the web interface. Use compare_orientations to ' +
  'rank candidate tilt/azimuth pairs. Azimuth is degrees clockwise from true north (180 = south).';

const SYSTEM_PROPERTIES = {
  location: {
    type: 'string',
    description: 'Place, address, postal code, or "lat, lon". Resolved to the best geocoder match. Ignored when latitude and longitude are given.'
  },
  latitude: { type: 'number', minimum: -90, maximum: 90 },
  longitude: { type: 'number', minimum: -180, maximum: 180 },
  system_capacity_kw: { type: 'number', minimum: 0.05, maximum: 500000, description: 'DC nameplate capacity in kW. Default 4.' },
  module_type: { type: 'integer', enum: [0, 1, 2], description: '0 standard, 1 premium, 2 thin film. Default 0.' },
  array_type: {
    type: 'integer',
    enum: [0, 1, 2, 3, 4],
    description: '0 fixed open rack, 1 fixed roof mount, 2 1-axis tracking, 3 1-axis backtracking, 4 2-axis tracking. Default 0.'
  },
  losses: { type: 'number', minimum: -5, maximum: 99, description: 'System losses in percent. Default 14.08.' },
  dc_ac_ratio: { type: 'number', minimum: 0.5, maximum: 3, description: 'Default 1.2.' },
  inverter_efficiency: { type: 'number', minimum: 90, maximum: 99.5, description: 'Percent. Default 96.' },
  ground_coverage_ratio: { type: 'number', minimum: 0.01, maximum: 0.99, description: 'Default 0.4.' },
  albedo: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, description: 'Ground reflectance. Omit to use the weather file albedo.' },
  bifaciality: { type: 'number', minimum: 0, maximum: 1, description: '0 for monofacial modules (default).' },
  monthly_irradiance_losses: {
    type: 'array',
    items: { type: 'number', minimum: 0, maximum: 100 },
    minItems: 12,
    maxItems: 12,
    description: 'Soiling or snow loss per month, percent, January first. Default all zero.'
  },
  dataset: {
    type: 'string',
    enum: Object.keys(DATASETS),
    description: 'Weather dataset. tmy3 (default, US-centric stations), nsrdb (current gridded), tmy2, intl.'
  },
  api_key: {
    type: 'string',
    description: 'NLR developer API key. Prefer the X-PVWatts-Api-Key header or the server default so the key stays out of transcripts.'
  }
};

const ORIENTATION = {
  type: 'object',
  properties: {
    tilt: { type: 'number', minimum: 0, maximum: 90 },
    azimuth: { type: 'number', minimum: 0, maximum: 360 }
  },
  required: ['tilt', 'azimuth'],
  additionalProperties: false
};

export const TOOLS = Object.freeze([
  {
    name: 'search_location',
    title: 'Search locations',
    description: 'Geocode a place, address, or postal code into up to five latitude/longitude candidates.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 2, maxLength: 200 } },
      required: ['query'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'estimate_production',
    title: 'Estimate PV production',
    description:
      'Run one official PVWatts v8 simulation. Returns annual and monthly AC/DC energy, solar resource, ' +
      'capacity factor, specific yield (kWh/kW), and the weather station used. Add tilt (0-90) and azimuth (0-360, true).',
    inputSchema: {
      type: 'object',
      properties: {
        ...SYSTEM_PROPERTIES,
        tilt: { type: 'number', minimum: 0, maximum: 90, description: 'Degrees from horizontal. Default 20.' },
        azimuth: { type: 'number', minimum: 0, maximum: 360, description: 'Degrees clockwise from true north. Default 180.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'compare_orientations',
    title: 'Compare orientations',
    description:
      `Run PVWatts once per candidate tilt/azimuth pair (up to ${MAX_ORIENTATIONS}, one API request each) ` +
      'and rank them by annual AC energy. Shares all other system parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SYSTEM_PROPERTIES,
        orientations: { type: 'array', items: ORIENTATION, minItems: 1, maxItems: MAX_ORIENTATIONS }
      },
      required: ['orientations'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }
]);

/** A failure the agent can read and act on, reported as a tool error. */
class ToolError extends Error {}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function userAgentFetch(fetchImpl) {
  return (url, options = {}) =>
    fetchImpl(url, { ...options, headers: { ...options.headers, 'User-Agent': USER_AGENT } });
}

/** Map the snake_case tool arguments to the names the browser client validates. */
function clientParams(args, location) {
  const params = {
    lat: location.lat,
    lon: location.lon,
    systemCapacityKw: args.system_capacity_kw,
    moduleType: args.module_type,
    arrayType: args.array_type,
    losses: args.losses,
    tilt: args.tilt,
    azimuth: args.azimuth,
    dcAcRatio: args.dc_ac_ratio,
    invEff: args.inverter_efficiency,
    groundCoverageRatio: args.ground_coverage_ratio,
    bifaciality: args.bifaciality,
    monthlyIrradianceLosses: args.monthly_irradiance_losses,
    dataset: args.dataset
  };
  if (args.albedo !== undefined && args.albedo !== null) {
    params.useWeatherFileAlbedo = false;
    params.albedo = args.albedo;
  }
  return params;
}

async function resolveLocation(args, { fetchImpl }) {
  const hasLat = args.latitude !== undefined && args.latitude !== null;
  const hasLon = args.longitude !== undefined && args.longitude !== null;
  if (hasLat !== hasLon) throw new ToolError('Provide both latitude and longitude, or a location.');
  if (hasLat) {
    return { lat: args.latitude, lon: args.longitude, name: `${args.latitude}, ${args.longitude}`, alternatives: [] };
  }
  if (typeof args.location !== 'string' || !args.location.trim()) {
    throw new ToolError('Provide latitude and longitude, or a location to search for.');
  }
  const [best, ...alternatives] = await searchLocations(args.location, { fetchImpl: userAgentFetch(fetchImpl) });
  if (!best) throw new ToolError(`No location found for "${args.location}". Try a more specific place or latitude/longitude.`);
  return { ...best, alternatives };
}

function summarize(result) {
  const station = result.stationInfo || {};
  return {
    annual_ac_kwh: round(result.annualAcKwh, 1),
    specific_yield_kwh_per_kw: round(result.kwhPerKw, 1),
    capacity_factor_percent: round(result.capacityFactor, 2),
    annual_solar_resource_kwh_m2_day: round(result.annualSolrad, 2),
    monthly: result.monthNames.map((month, index) => ({
      month,
      ac_kwh: round(result.monthlyAc[index], 1),
      dc_kwh: round(result.monthlyDc[index], 1),
      solar_resource_kwh_m2_day: round(result.monthlySolrad[index], 2),
      ...(result.monthlyPoa.length ? { poa_kwh_m2: round(result.monthlyPoa[index], 1) } : {})
    })),
    dataset: result.dataset,
    weather_station: {
      source: station.weather_data_source,
      city: station.city,
      state: station.state,
      lat: station.lat,
      lon: station.lon,
      distance_m: station.distance
    },
    model: result.model
  };
}

async function runTool(name, args, context) {
  const client = context.client;
  const options = { apiKey: args.api_key || context.apiKey };

  if (name === 'search_location') {
    const matches = await searchLocations(args.query, { fetchImpl: userAgentFetch(context.fetchImpl) });
    return { query: args.query, matches };
  }

  if (name === 'estimate_production') {
    const location = await resolveLocation(args, context);
    const params = clientParams(args, location);
    const result = await client.simulate(params, options);
    return {
      location: { name: location.name, lat: location.lat, lon: location.lon, other_matches: location.alternatives },
      ...summarize(result)
    };
  }

  if (name === 'compare_orientations') {
    const location = await resolveLocation(args, context);
    const base = clientParams(args, location);
    const results = await Promise.all(
      args.orientations.map(async ({ tilt, azimuth }) => {
        const result = await client.simulate({ ...base, tilt, azimuth }, options);
        return { tilt, azimuth, result };
      })
    );
    const ranked = results
      .sort((a, b) => b.result.annualAcKwh - a.result.annualAcKwh)
      .map(({ tilt, azimuth, result }, index) => ({
        rank: index + 1,
        tilt,
        azimuth,
        annual_ac_kwh: round(result.annualAcKwh, 1),
        specific_yield_kwh_per_kw: round(result.kwhPerKw, 1),
        capacity_factor_percent: round(result.capacityFactor, 2),
        monthly_ac_kwh: result.monthlyAc.map(value => round(value, 1))
      }));
    const topKwh = ranked[0].annual_ac_kwh;
    for (const row of ranked) row.vs_best_percent = round((row.annual_ac_kwh / topKwh - 1) * 100, 2);
    return {
      location: { name: location.name, lat: location.lat, lon: location.lon },
      dataset: results[0].result.dataset,
      weather_station: summarize(results[0].result).weather_station,
      best: { tilt: ranked[0].tilt, azimuth: ranked[0].azimuth },
      ranked
    };
  }

  throw new ToolError(`Unknown tool: ${name}`);
}

function toolResult(payload, isError = false) {
  const result = { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  if (isError) return { ...result, isError: true };
  return { ...result, structuredContent: payload };
}

async function callTool(params, context) {
  const tool = TOOLS.find(candidate => candidate.name === params?.name);
  if (!tool) return { error: { code: -32602, message: `Unknown tool: ${params?.name}` } };
  const args = params.arguments ?? {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    return { error: { code: -32602, message: 'arguments must be an object' } };
  }
  const unknown = Object.keys(args).filter(key => !(key in tool.inputSchema.properties));
  if (unknown.length) return { result: toolResult({ error: `Unknown argument(s): ${unknown.join(', ')}` }, true) };
  for (const field of tool.inputSchema.required || []) {
    if (args[field] === undefined) return { result: toolResult({ error: `Missing required argument: ${field}` }, true) };
  }
  try {
    return { result: toolResult(await runTool(tool.name, args, context)) };
  } catch (error) {
    // Validation and upstream failures are tool errors so the agent can retry.
    return { result: toolResult({ error: error.message, ...(error.code ? { code: error.code } : {}) }, true) };
  }
}

/** Handle one JSON-RPC message. Returns null for notifications. */
export async function handleMessage(message, context) {
  const isRequest = message && typeof message === 'object' && typeof message.method === 'string';
  if (!isRequest) {
    // Responses to server requests (we send none) and malformed input.
    const hasId = message && typeof message === 'object' && 'id' in message && !('result' in message || 'error' in message);
    return hasId ? rpcError(message.id, -32600, 'Invalid request') : null;
  }
  if (!('id' in message)) return null;

  const { id, method, params } = message;
  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const outcome = await callTool(params, context);
      return outcome.error ? rpcError(id, outcome.error.code, outcome.error.message) : rpcResult(id, outcome.result);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function tokensMatch(provided, expected) {
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-PVWatts-Api-Key, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400'
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS, ...extra }
  });
}

/**
 * Serve one HTTP request. `env.MCP_AUTH_TOKEN`, when set, is required as a
 * bearer token; `env.PVWATTS_API_KEY` is the default NLR key for callers that
 * send none.
 */
const sharedClient = new PVWattsClient();

export async function handleRequest(request, env = {}, { fetchImpl = fetch, client = sharedClient } = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') {
    return json(rpcError(null, -32000, 'This server answers POST requests only.'), 405, { Allow: 'POST, OPTIONS' });
  }

  if (env.MCP_AUTH_TOKEN) {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
    if (!match || !(await tokensMatch(match[1].trim(), env.MCP_AUTH_TOKEN))) {
      return json(rpcError(null, -32001, 'Unauthorized'), 401, { 'WWW-Authenticate': 'Bearer' });
    }
  }

  let body;
  try {
    body = await request.json();
  } catch (_error) {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }

  const headerKey = (request.headers.get('X-PVWatts-Api-Key') || '').trim();
  const context = { fetchImpl, client, apiKey: headerKey || env.PVWATTS_API_KEY };

  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, -32600, 'Invalid request'), 400);
    const replies = (await Promise.all(body.map(message => handleMessage(message, context)))).filter(Boolean);
    return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS_HEADERS });
  }
  const reply = await handleMessage(body, context);
  return reply ? json(reply) : new Response(null, { status: 202, headers: CORS_HEADERS });
}
