#!/usr/bin/env node
/**
 * Photovoltaic news aggregator for PVWatts Studio.
 *
 * Fetches a fixed list of publisher feeds and writes `static/news.json`, which
 * the browser reads from its own origin. Visitors never contact a news site,
 * and every publisher receives one request per scheduled build:
 *
 *   - the deploy workflow runs on a `17 *\/6 * * *` cron, so four requests a
 *     day per feed, well inside what any of these publishers expects;
 *   - one request per feed per run, no retries, a 15 s timeout, and a
 *     self-identifying User-Agent with a contact URL;
 *   - at most three requests in flight at once.
 *
 * Node standard library only: the site ships no build step and no npm
 * dependencies, so the feed reader is a small RSS 2.0 / Atom 1.0 extractor
 * rather than a parser package.
 *
 * Usage:
 *   node tools/fetch_news.mjs
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Scheduled rebuild interval. Keep in step with .github/workflows/deploy.yml. */
export const REFRESH_HOURS = 6;
/** Ceiling per feed, so a high-volume publisher cannot dominate the view. */
export const MAX_ITEMS_PER_SOURCE = 15;
/** Ceiling for the whole feed, which bounds the size of news.json. */
export const MAX_ITEMS_TOTAL = 200;
/** Summaries are boilerplate on many feeds; keep only the usable opening. */
export const MAX_SUMMARY_CHARS = 200;
export const REQUEST_TIMEOUT_MS = 15000;
export const USER_AGENT =
  'PVWattsStudioNews/1.0 (+https://github.com/jacob-card-howe/pvwatts-studio)';

/** Filter values in the news view are built from these category names. */
export const CATEGORIES = ['Industry', 'Research', 'Policy', 'Video'];

/**
 * Curated publishers. `keywords` narrows a broad feed to photovoltaic items
 * (case-insensitive regular expressions tested against title + summary), and
 * `limit` overrides the per-feed ceiling for exceptionally noisy feeds.
 */
export const SOURCES = [
  // Trade press: project announcements and technology news.
  {
    id: 'pv-magazine',
    name: 'pv magazine',
    category: 'Industry',
    homepage: 'https://www.pv-magazine.com/',
    url: 'https://www.pv-magazine.com/feed/',
  },
  {
    id: 'pv-magazine-usa',
    name: 'pv magazine USA',
    category: 'Industry',
    homepage: 'https://pv-magazine-usa.com/',
    url: 'https://pv-magazine-usa.com/feed/',
  },
  {
    id: 'pv-magazine-australia',
    name: 'pv magazine Australia',
    category: 'Industry',
    homepage: 'https://www.pv-magazine-australia.com/',
    url: 'https://www.pv-magazine-australia.com/feed/',
  },
  {
    id: 'pv-tech',
    name: 'PV Tech',
    category: 'Industry',
    homepage: 'https://www.pv-tech.org/',
    url: 'https://www.pv-tech.org/feed/',
    limit: 10,
  },
  {
    id: 'solar-power-world',
    name: 'Solar Power World',
    category: 'Industry',
    homepage: 'https://www.solarpowerworldonline.com/',
    url: 'https://www.solarpowerworldonline.com/feed/',
  },
  {
    id: 'solar-builder',
    name: 'Solar Builder',
    category: 'Industry',
    homepage: 'https://solarbuildermag.com/',
    url: 'https://solarbuildermag.com/feed/',
  },
  {
    id: 'renewable-energy-world',
    name: 'Renewable Energy World',
    category: 'Industry',
    homepage: 'https://www.renewableenergyworld.com/',
    url: 'https://www.renewableenergyworld.com/category/solar/feed/',
  },
  {
    id: 'canary-media',
    name: 'Canary Media',
    category: 'Industry',
    homepage: 'https://www.canarymedia.com/',
    url: 'https://www.canarymedia.com/feeds/latest',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b', 'perovskite'],
  },
  {
    id: 'cleantechnica',
    name: 'CleanTechnica',
    category: 'Industry',
    homepage: 'https://cleantechnica.com/',
    url: 'https://cleantechnica.com/feed/',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b', 'perovskite'],
    limit: 10,
  },
  {
    id: 'utility-dive',
    name: 'Utility Dive',
    category: 'Industry',
    homepage: 'https://www.utilitydive.com/',
    url: 'https://www.utilitydive.com/feeds/news/',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b'],
    limit: 8,
  },

  // Published research and laboratory announcements.
  {
    id: 'nature-solar-cells',
    name: 'Nature — Solar cells',
    category: 'Research',
    homepage: 'https://www.nature.com/subjects/solar-cells',
    url: 'https://www.nature.com/subjects/solar-cells.rss',
    limit: 10,
  },
  {
    id: 'nature-energy',
    name: 'Nature Energy',
    category: 'Research',
    homepage: 'https://www.nature.com/nenergy/',
    url: 'https://www.nature.com/nenergy.rss',
    keywords: ['solar', 'photovoltaic', 'perovskite', '\\bpv\\b'],
    limit: 10,
  },
  {
    id: 'progress-in-photovoltaics',
    name: 'Progress in Photovoltaics',
    category: 'Research',
    homepage: 'https://onlinelibrary.wiley.com/journal/1099159x',
    url: 'https://onlinelibrary.wiley.com/feed/1099159x/most-recent',
    limit: 10,
  },
  {
    id: 'solar-rrl',
    name: 'Solar RRL',
    category: 'Research',
    homepage: 'https://onlinelibrary.wiley.com/journal/2367198x',
    url: 'https://onlinelibrary.wiley.com/feed/2367198x/most-recent',
    limit: 10,
  },
  {
    id: 'sciencedaily-solar',
    name: 'ScienceDaily — Solar Energy',
    category: 'Research',
    homepage: 'https://www.sciencedaily.com/news/matter_energy/solar_energy/',
    url: 'https://www.sciencedaily.com/rss/matter_energy/solar_energy.xml',
    limit: 10,
  },
  {
    id: 'berkeley-lab',
    name: 'Berkeley Lab',
    category: 'Research',
    homepage: 'https://newscenter.lbl.gov/',
    url: 'https://newscenter.lbl.gov/feed/',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b', 'perovskite'],
  },
  {
    id: 'mit-news-energy',
    name: 'MIT News — Energy',
    category: 'Research',
    homepage: 'https://news.mit.edu/topic/energy',
    url: 'https://news.mit.edu/rss/topic/energy',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b', 'perovskite'],
  },

  // Policy, markets, and grid context.
  {
    id: 'guardian-solar',
    name: 'The Guardian — Solar power',
    category: 'Policy',
    homepage: 'https://www.theguardian.com/environment/solarpower',
    url: 'https://www.theguardian.com/environment/solarpower/rss',
  },
  {
    id: 'energy-gov',
    name: 'U.S. Department of Energy',
    category: 'Policy',
    homepage: 'https://www.energy.gov/news',
    url: 'https://www.energy.gov/rss/news',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b'],
  },
  {
    id: 'eia-today-in-energy',
    name: 'EIA — Today in Energy',
    category: 'Policy',
    homepage: 'https://www.eia.gov/todayinenergy/',
    url: 'https://www.eia.gov/rss/todayinenergy.xml',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b'],
  },
  {
    id: 'carbon-brief',
    name: 'Carbon Brief',
    category: 'Policy',
    homepage: 'https://www.carbonbrief.org/',
    url: 'https://www.carbonbrief.org/feed/',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b'],
  },

  // Publisher video channels.
  {
    id: 'solar-power-world-video',
    name: 'Solar Power World (video)',
    category: 'Video',
    homepage: 'https://www.youtube.com/@solarpowerworldonline',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCRjX-tuYsEMYxpWKIbopywQ',
    keywords: ['solar', 'photovoltaic', '\\bpv\\b', 'panel', 'inverter'],
    limit: 8,
  },
];

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

/** Decode the XML entities that actually appear in news feeds. */
export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/** Feeds hand over HTML in titles and summaries; the view renders plain text. */
export function stripMarkup(text) {
  let value = String(text);
  // The observed feeds are double-encoded at most; the bound is a single
  // character either way, and the trailing strip covers anything deeper.
  for (let pass = 0; pass < 3; pass += 1) {
    value = decodeEntities(stripTags(value));
  }
  return (
    stripTags(value)
      // WordPress feeds end every summary with this credit line.
      .replace(/\s*the post .*? appeared first on .*?\.\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function stripTags(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // A tag opens with a letter, so "efficiency < 20%" survives intact.
    .replace(/<\/?[a-z][^>]*>/gi, ' ');
}

function tagText(xml, names) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
    if (match && match[1].trim()) return match[1];
  }
  return '';
}

function atomLink(entry) {
  const tags = entry.match(/<link\b[^>]*>/gi) || [];
  const alternate = tags.find(tag => /rel=["']alternate["']/i.test(tag)) || tags[0];
  const href = alternate && alternate.match(/href=["']([^"']+)["']/i);
  return href ? href[1] : '';
}

/** Parse an RSS 2.0 or Atom 1.0 document into plain headline records. */
export function parseFeed(xml, source, { now = new Date(), maxAgeDays = 400 } = {}) {
  const blocks = [...String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(match => match[0]);
  const oldest = now.getTime() - maxAgeDays * 86400000;
  const items = [];

  for (const block of blocks) {
    const title = stripMarkup(tagText(block, ['title', 'media:title']));
    const link = stripMarkup(tagText(block, ['link'])) || atomLink(block);
    const rawDate = stripMarkup(
      tagText(block, ['pubDate', 'dc:date', 'published', 'updated', 'date', 'lastBuildDate'])
    );
    const published = new Date(rawDate);
    if (!title || !/^https?:\/\//i.test(link)) continue;
    if (Number.isNaN(published.getTime()) || published.getTime() < oldest) continue;
    items.push({
      title,
      url: link,
      published: published.toISOString(),
      summary: stripMarkup(
        tagText(block, ['description', 'summary', 'content:encoded', 'content'])
      ),
      source: source.id,
      sourceName: source.name,
      category: source.category,
    });
  }

  return source.keywords && source.keywords.length
    ? items.filter(item => matchesKeywords(item, source.keywords))
    : items;
}

export function matchesKeywords(item, patterns) {
  const haystack = `${item.title} ${item.summary}`;
  return patterns.some(pattern => new RegExp(pattern, 'i').test(haystack));
}

export function trimSummary(summary, limit = MAX_SUMMARY_CHARS) {
  const text = String(summary || '').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Dedupe key: ignore tracking parameters and cosmetic URL differences. */
export function canonicalUrl(url) {
  return String(url)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?&](?:utm_[^&#]*|fbclid=[^&#]*|ref=[^&#]*)/gi, '')
    .replace(/[?#]$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Newest first, one entry per story, capped per source and in total. */
export function selectItems(items, { perSource = MAX_ITEMS_PER_SOURCE, total = MAX_ITEMS_TOTAL } = {}) {
  const seen = new Set();
  const counts = new Map();
  const selected = [];

  const ordered = [...items].sort((a, b) => {
    const byDate = new Date(b.published) - new Date(a.published);
    return byDate !== 0 ? byDate : a.title.localeCompare(b.title);
  });

  for (const item of ordered) {
    const url = canonicalUrl(item.url);
    const title = item.title.toLowerCase();
    if (seen.has(url) || seen.has(`title:${title}`)) continue;
    const used = counts.get(item.source) || 0;
    if (used >= perSource) continue;
    seen.add(url);
    seen.add(`title:${title}`);
    counts.set(item.source, used + 1);
    selected.push(item);
    if (selected.length >= total) break;
  }

  return selected;
}

async function fetchSource(source) {
  try {
    const response = await fetch(source.url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) {
      console.error(`news: ${source.id} returned HTTP ${response.status}`);
      return { source, items: [], error: `HTTP ${response.status}` };
    }
    const body = await response.text();
    const items = prepareItems(parseFeed(body, source), source);
    if (!items.length) console.error(`news: ${source.id} yielded no usable items`);
    return { source, items, error: null };
  } catch (error) {
    console.error(`news: ${source.id} failed: ${error.message}`);
    return { source, items: [], error: error.message };
  }
}

/** One request per feed, one after another, so a publisher sees no burst. */
async function collectFeeds() {
  const results = [];
  for (const source of SOURCES) {
    results.push(await fetchSource(source));
  }
  return results;
}

/** Shorten summaries and discard future-dated items before selection. */
function prepareItems(items, source, now = Date.now()) {
  const limit = source.limit || MAX_ITEMS_PER_SOURCE;
  return items
    .filter(item => new Date(item.published).getTime() <= now + 86400000)
    .map(item => ({ ...item, summary: trimSummary(item.summary) }))
    .slice(0, limit);
}

export function buildPayload(results, { generated = new Date().toISOString(), sources = SOURCES } = {}) {
  return {
    generated,
    refreshHours: REFRESH_HOURS,
    categories: CATEGORIES,
    sources: sources.map(({ id, name, category, homepage }) => ({ id, name, category, homepage })),
    unavailable: results.filter(r => r.error).map(r => ({ id: r.source.id, name: r.source.name, error: r.error })),
    items: selectItems(results.flatMap(result => result.items)),
  };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(scriptDir, '..', 'static', 'news.json');

  const started = Date.now();
  const results = await collectFeeds();
  const payload = buildPayload(results);

  if (!payload.items.length) {
    // Never replace a good feed with an empty one: an unreachable network in
    // CI would otherwise publish a news view with nothing in it.
    console.error('news: no source returned usable items; keeping the existing feed');
    process.exitCode = 1;
    return;
  }

  await writeFile(out, `${JSON.stringify(payload)}\n`, 'utf8');

  const ok = results.filter(r => !r.error).length;
  console.log(
    `news: ${payload.items.length} items from ${ok}/${results.length} feeds ` +
      `(${(Date.now() - started) / 1000}s) -> ${out}`
  );
  if (payload.unavailable.length) {
    console.log(`news: unavailable: ${payload.unavailable.map(u => `${u.id} (${u.error})`).join(', ')}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}