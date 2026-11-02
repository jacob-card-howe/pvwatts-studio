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
const NOW = Date.parse('2026-09-15T12:00:00Z');
const NEWS = {
  generated: '2026-09-15T06:00:00.000Z',
  refreshHours: 6,
  items: [
    { title: 'Older research result', url: 'https://example.org/a', published: '2026-09-01T00:00:00.000Z', summary: 'Perovskite cells.', source: 'nature-energy', sourceName: 'Nature Energy', category: 'Research' },
    { title: 'Utility signs solar PPA', url: 'https://example.org/b', published: '2026-09-15T08:00:00.000Z', summary: `Long ${'text '.repeat(100)}`, source: 'pv-magazine', sourceName: 'pv magazine', category: 'Industry' },
    { title: 'Tariff ruling on modules', url: 'https://example.org/c', published: '2026-09-14T08:00:00.000Z', summary: 'Policy change.', source: 'pv-magazine', sourceName: 'pv magazine', category: 'Policy' }
  ]
};

function stubUpstream({ geocoder = [], pvwatts = outputsFor, news = NEWS, newsStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, headers: options.headers || {} });
    if (parsed.pathname === '/news.json') return { ok: newsStatus === 200, status: newsStatus, json: async () => news };
    const body = parsed.hostname.includes('openstreetmap') ? geocoder : pvwatts(parsed);
    return { ok: true, status: 200, json: async () => body };
  };
  return { calls, fetchImpl, now: () => NOW, client: new PVWattsClient({ fetchImpl }) };
}

function outputsFor(url) {
  // Make the south-facing request the most productive so rankings are checkable.
  const azimuth = Number(url.searchParams.get('azimuth'));
  const acAnnual = 6000 - Math.abs(azimuth - 180) * 10;
  return { outputs: { ...OUTPUTS, ac_annual: acAnnual }, station_info: { city: 'SEATTLE', lat: 47.5 }, version: '8.3.0' };
}

const KEYED = { Authorization: 'Bearer abcdefgh12345678' };

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
  assert.deepEqual(body.result.tools.map(tool => tool.name), ['search_location', 'estimate_production', 'compare_orientations', 'summarize_news']);
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
  const { body } = await rpc('tools/call', { name: 'estimate_production', arguments: { location: 'Renton, WA' } }, { upstream, headers: KEYED });
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
  }, { headers: KEYED });
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

test('the caller\'s NREL key is forwarded: bearer or header, otherwise DEMO_KEY', async () => {
  const keyUsed = async headers => {
    const upstream = stubUpstream();
    await rpc('tools/call', { name: 'estimate_production', arguments: { latitude: 47, longitude: -122 } }, { headers, upstream });
    return upstream.calls[0].url.searchParams.get('api_key');
  };
  assert.equal(await keyUsed({ Authorization: 'Bearer MyOwnKey12345' }), 'MyOwnKey12345');
  assert.equal(await keyUsed({ 'X-PVWatts-Api-Key': 'HeaderKey12345' }), 'HeaderKey12345');
  assert.equal(await keyUsed({ Authorization: 'Bearer DEMO_KEY' }), 'DEMO_KEY');
  assert.equal(await keyUsed({}), 'DEMO_KEY');
});

test('a malformed key is rejected before any upstream call', async () => {
  const upstream = stubUpstream();
  for (const value of ['Bearer short', 'Bearer has spaces in it', 'Bearer a&api_key=evil12345']) {
    const response = await handleRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: value }), {}, upstream);
    assert.equal(response.status, 401, value);
  }
  assert.equal(upstream.calls.length, 0);
});

test('without a key, only lat/lon estimates and news are available', async () => {
  const denied = [
    { name: 'search_location', arguments: { query: 'Renton, WA' } },
    { name: 'estimate_production', arguments: { location: 'Renton, WA' } },
    { name: 'compare_orientations', arguments: { latitude: 47, longitude: -122, orientations: [{ tilt: 20, azimuth: 180 }] } }
  ];
  for (const call of denied) {
    const upstream = stubUpstream();
    const { body } = await rpc('tools/call', call, { upstream });
    assert.equal(body.result.isError, true, call.name);
    assert.match(body.result.content[0].text, /NREL API key/);
    assert.equal(upstream.calls.length, 0, call.name);
  }
  const estimate = await rpc('tools/call', { name: 'estimate_production', arguments: { latitude: 47, longitude: -122 } });
  assert.equal(estimate.body.result.isError, undefined);
  const news = await rpc('tools/call', { name: 'summarize_news', arguments: {} });
  assert.equal(news.body.result.isError, undefined);
});

test('the key never appears in a tool result or the tool schemas', async () => {
  const { body } = await rpc('tools/call', { name: 'estimate_production', arguments: { latitude: 47, longitude: -122 } }, { headers: KEYED });
  assert.ok(!JSON.stringify(body).includes('abcdefgh12345678'));
  assert.ok(!JSON.stringify(TOOLS).includes('api_key'));
});

test('summarize_news lists the newest items first with trimmed excerpts and an overview', async () => {
  const { body } = await rpc('tools/call', { name: 'summarize_news', arguments: {} });
  const data = body.result.structuredContent;
  assert.deepEqual(data.items.map(item => item.title), ['Utility signs solar PPA', 'Tariff ruling on modules', 'Older research result']);
  assert.equal(data.items[0].published, '2026-09-15T08:00:00.000Z');
  assert.equal(data.items[0].age_hours, 4);
  assert.ok(data.items[0].excerpt.length <= 281 && data.items[0].excerpt.endsWith('\u2026'));
  assert.deepEqual(data.overview.by_topic, { Industry: 1, Policy: 1, Research: 1 });
  assert.deepEqual(data.overview.by_source, { 'pv magazine': 2, 'Nature Energy': 1 });
  assert.equal(data.feed.age_hours, 6);
  assert.equal(data.feed.note, undefined);
});

test('summarize_news filters by topic, source, text, age, and limit', async () => {
  const run = async args => (await rpc('tools/call', { name: 'summarize_news', arguments: args })).body.result.structuredContent;
  assert.deepEqual((await run({ category: 'Policy' })).items.map(item => item.source_id), ['pv-magazine']);
  assert.equal((await run({ source: 'pv-magazine' })).matched, 2);
  assert.equal((await run({ query: 'PEROVSKITE' })).matched, 1);
  assert.equal((await run({ since_days: 2 })).matched, 2);
  const limited = await run({ limit: 1 });
  assert.equal(limited.returned, 1);
  assert.equal(limited.matched, 3);
});

test('summarize_news reports a stale feed, a missing feed, and bad arguments', async () => {
  const stale = await rpc('tools/call', { name: 'summarize_news', arguments: {} }, {
    upstream: stubUpstream({ news: { ...NEWS, generated: '2026-09-10T00:00:00.000Z' } })
  });
  assert.match(stale.body.result.structuredContent.feed.note, /not been rebuilt/);

  const missing = await rpc('tools/call', { name: 'summarize_news', arguments: {} }, { upstream: stubUpstream({ newsStatus: 404 }) });
  assert.equal(missing.body.result.isError, true);
  assert.match(missing.body.result.content[0].text, /unavailable/);

  for (const args of [{ limit: 0 }, { limit: 99 }, { category: 'Gossip' }, { since_days: -1 }]) {
    const { body } = await rpc('tools/call', { name: 'summarize_news', arguments: args });
    assert.equal(body.result.isError, true, JSON.stringify(args));
  }
});

test('summarize_news reads the feed through the Pages ASSETS binding when present', async () => {
  const requested = [];
  const env = { ASSETS: { fetch: async request => { requested.push(new URL(request.url).pathname); return Response.json(NEWS); } } };
  const upstream = stubUpstream();
  const { body } = await rpc('tools/call', { name: 'summarize_news', arguments: { limit: 1 } }, { env, upstream });
  assert.equal(body.result.structuredContent.returned, 1);
  assert.deepEqual(requested, ['/news.json']);
  assert.equal(upstream.calls.length, 0);
});
