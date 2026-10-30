// Checks for the MCP endpoint. Run with:
//   node tests/test_mcp_server.mjs
// Upstream calls are stubbed, so this consumes no API quota.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { handleRequest, TOOLS } from '../mcp/server.mjs';

const require = createRequire(import.meta.url);
const { PVWattsClient } = require('../static/pvwatts_client.js');

const OUTPUTS = {
  ac_annual: 5200.0,
  solrad_annual: 4.1,
  capacity_factor: 14.8,
  ac_monthly: Array.from({ length: 12 }, (_value, index) => 400 + index),
  dc_monthly: Array.from({ length: 12 }, (_value, index) => 420 + index),
  solrad_monthly: Array.from({ length: 12 }, () => 4.1),
  poa_monthly: Array.from({ length: 12 }, () => 120.0)
};

/** Route PVWatts and geocoder URLs to canned replies and record every call. */
function stubUpstream({ geocoder = [], pvwatts = outputsFor } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, headers: options.headers || {} });
    const body = parsed.hostname.includes('openstreetmap') ? geocoder : pvwatts(parsed);
    return { ok: true, status: 200, json: async () => body };
  };
  return { calls, fetchImpl, client: new PVWattsClient({ fetchImpl }) };
}

function outputsFor(url) {
  // Make the south-facing request the most productive so rankings are checkable.
  const azimuth = Number(url.searchParams.get('azimuth'));
  const acAnnual = 6000 - Math.abs(azimuth - 180) * 10;
  return { outputs: { ...OUTPUTS, ac_annual: acAnnual }, station_info: { city: 'SEATTLE', lat: 47.5 }, version: '8.3.0' };
}

function post(body, headers = {}) {
  return new Request('https://example.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function rpc(method, params, { env = {}, upstream = stubUpstream(), headers } = {}) {
  const response = await handleRequest(
    post({ jsonrpc: '2.0', id: 1, method, params }, headers),
    env,
    upstream
  );
  return { response, body: response.status === 202 ? null : await response.json(), upstream };
}

test('initialize negotiates the protocol version and advertises tools', async () => {
  const { body } = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {} });
  assert.equal(body.result.protocolVersion, '2025-03-26');
  assert.ok(body.result.capabilities.tools);
  const fallback = await rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(fallback.body.result.protocolVersion, '2025-06-18');
});

test('tools/list exposes every tool with an object input schema', async () => {
  const { body } = await rpc('tools/list');
  assert.deepEqual(body.result.tools.map(tool => tool.name), ['search_location', 'estimate_production', 'compare_orientations']);
  for (const tool of TOOLS) assert.equal(tool.inputSchema.type, 'object');
});

test('notifications get 202 and no body; unknown methods error', async () => {
  const notification = await handleRequest(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), {}, stubUpstream());
  assert.equal(notification.status, 202);
  const { body } = await rpc('nope');
  assert.equal(body.error.code, -32601);
});

test('GET is refused and malformed JSON is a parse error', async () => {
  const get = await handleRequest(new Request('https://example.test/mcp'), {}, stubUpstream());
  assert.equal(get.status, 405);
  const bad = await handleRequest(
    new Request('https://example.test/mcp', { method: 'POST', body: '{' }),
    {},
    stubUpstream()
  );
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
});

test('estimate_production maps arguments onto the PVWatts request', async () => {
  const { body, upstream } = await rpc('tools/call', {
    name: 'estimate_production',
    arguments: {
      latitude: 47.491,
      longitude: -122.216,
      system_capacity_kw: 8,
      tilt: 30,
      azimuth: 200,
      array_type: 1,
      albedo: 0.3,
      dataset: 'nsrdb'
    }
  });
  assert.equal(body.result.isError, undefined);
  const data = body.result.structuredContent;
  assert.equal(data.annual_ac_kwh, 5800);
  assert.equal(data.specific_yield_kwh_per_kw, 725);
  assert.equal(data.monthly.length, 12);
  const query = upstream.calls[0].url.searchParams;
  assert.equal(query.get('system_capacity'), '8');
  assert.equal(query.get('tilt'), '30');
  assert.equal(query.get('azimuth'), '200');
  assert.equal(query.get('array_type'), '1');
  assert.equal(query.get('albedo'), '0.3');
  assert.equal(query.get('use_wf_albedo'), '0');
  assert.equal(query.get('dataset'), 'nsrdb');
});

test('estimate_production geocodes a place name and sends the app User-Agent', async () => {
  const upstream = stubUpstream({
    geocoder: [{ lat: '47.4829', lon: '-122.2171', display_name: 'Renton, King County, Washington, United States', type: 'city' }]
  });
  const { body } = await rpc('tools/call', { name: 'estimate_production', arguments: { location: 'Renton, WA' } }, { upstream });
  assert.equal(body.result.structuredContent.location.name, 'Renton, King County, Washington, United States');
  const geocode = upstream.calls.find(call => call.url.hostname.includes('openstreetmap'));
  assert.match(geocode.headers['User-Agent'], /pvwatts-studio-mcp/);
  const pvwatts = upstream.calls.find(call => !call.url.hostname.includes('openstreetmap'));
  assert.equal(pvwatts.url.searchParams.get('lat'), '47.4829');
});

test('compare_orientations ranks candidates by annual energy', async () => {
  const { body, upstream } = await rpc('tools/call', {
    name: 'compare_orientations',
    arguments: {
      latitude: 47.5,
      longitude: -122.2,
      orientations: [
        { tilt: 20, azimuth: 90 },
        { tilt: 30, azimuth: 180 },
        { tilt: 25, azimuth: 220 }
      ]
    }
  });
  const data = body.result.structuredContent;
  assert.deepEqual(data.ranked.map(row => row.azimuth), [180, 220, 90]);
  assert.deepEqual(data.best, { tilt: 30, azimuth: 180 });
  assert.equal(data.ranked[0].vs_best_percent, 0);
  assert.ok(data.ranked[2].vs_best_percent < 0);
  assert.equal(upstream.calls.length, 3);
});

test('bad input comes back as a tool error, not a protocol error', async () => {
  const cases = [
    { name: 'estimate_production', arguments: { latitude: 47 } },
    { name: 'estimate_production', arguments: { latitude: 47, longitude: -122, tilt: 120 } },
    { name: 'estimate_production', arguments: { latitude: 47, longitude: -122, bogus: 1 } },
    { name: 'compare_orientations', arguments: { latitude: 47, longitude: -122 } }
  ];
  for (const call of cases) {
    const { body } = await rpc('tools/call', call);
    assert.equal(body.result.isError, true, JSON.stringify(call));
    assert.ok(JSON.parse(body.result.content[0].text).error);
  }
  const unknown = await rpc('tools/call', { name: 'nope', arguments: {} });
  assert.equal(unknown.body.error.code, -32602);
});

test('API key precedence: argument, then header, then server default, then DEMO_KEY', async () => {
  const keyUsed = async (args, { env, headers } = {}) => {
    const upstream = stubUpstream();
    await rpc('tools/call', { name: 'estimate_production', arguments: { latitude: 47, longitude: -122, ...args } }, { env, headers, upstream });
    return upstream.calls[0].url.searchParams.get('api_key');
  };
  assert.equal(await keyUsed({ api_key: 'ARG' }, { env: { PVWATTS_API_KEY: 'ENV' }, headers: { 'X-PVWatts-Api-Key': 'HDR' } }), 'ARG');
  assert.equal(await keyUsed({ tilt: 1 }, { env: { PVWATTS_API_KEY: 'ENV' }, headers: { 'X-PVWatts-Api-Key': 'HDR' } }), 'HDR');
  assert.equal(await keyUsed({ tilt: 2 }, { env: { PVWATTS_API_KEY: 'ENV' } }), 'ENV');
  assert.equal(await keyUsed({ tilt: 3 }), 'DEMO_KEY');
});

test('MCP_AUTH_TOKEN, when set, gates the endpoint', async () => {
  const env = { MCP_AUTH_TOKEN: 'secret' };
  const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
  const missing = await handleRequest(post(body), env, stubUpstream());
  assert.equal(missing.status, 401);
  const wrong = await handleRequest(post(body, { Authorization: 'Bearer nope' }), env, stubUpstream());
  assert.equal(wrong.status, 401);
  const ok = await handleRequest(post(body, { Authorization: 'Bearer secret' }), env, stubUpstream());
  assert.equal(ok.status, 200);
});
