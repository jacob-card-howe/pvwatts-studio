/**
 * Tests for the photovoltaic news aggregator.
 *
 * The feed reader and the selection rules are the parts that can silently
 * corrupt the published list, so they are asserted against real feed shapes
 * (RSS 2.0, Atom, YouTube's Atom dialect) rather than against mocks of
 * themselves. No network access is required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATEGORIES,
  MAX_ITEMS_PER_SOURCE,
  MAX_ITEMS_TOTAL,
  MAX_SUMMARY_CHARS,
  REFRESH_HOURS,
  REQUEST_TIMEOUT_MS,
  SOURCES,
  buildPayload,
  canonicalUrl,
  decodeEntities,
  matchesKeywords,
  parseFeed,
  selectItems,
  stripMarkup,
  trimSummary,
} from '../tools/fetch_news.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-09-14T12:00:00Z');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Solar</title>
    <item>
      <title><![CDATA[Bifacial modules &amp; the 30% rule]]></title>
      <link>https://example.com/bifacial?utm_source=feed&amp;utm_medium=rss</link>
      <pubDate>Mon, 14 Sep 2026 09:57:02 +0000</pubDate>
      <description><![CDATA[<p>A short <strong>summary</strong> with markup.</p>]]></description>
    </item>
    <item>
      <title>Untitled but dated</title>
      <link>https://example.com/second</link>
      <dc:date>2026-09-10</dc:date>
      <description>Second item.</description>
    </item>
    <item>
      <title>No date</title>
      <link>https://example.com/undated</link>
      <description>Undated items cannot be ordered, so they are dropped.</description>
    </item>
    <item>
      <title>Stale</title>
      <link>https://example.com/stale</link>
      <pubDate>Sat, 01 Jan 2000 00:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Broken link</title>
      <link>not-a-url</link>
      <pubDate>Mon, 14 Sep 2026 08:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Journal</title>
  <entry>
    <title>Perovskite tandems reach 34% in the lab</title>
    <link rel="alternate" href="https://example.org/tandems"/>
    <updated>2026-09-12T07:30:00Z</updated>
    <summary>Stability remains the open question.</summary>
  </entry>
</feed>`;

const source = { id: 'example', name: 'Example Solar', category: 'Industry', url: 'https://example.com/feed' };

test('RSS items are normalized into plain headline records', () => {
  const items = parseFeed(RSS, source, { now: NOW });

  assert.equal(items.length, 2, 'undated, stale, and malformed entries are dropped');
  const [first, second] = items;
  assert.equal(first.title, 'Bifacial modules & the 30% rule', 'CDATA and entities are decoded');
  assert.equal(first.url, 'https://example.com/bifacial?utm_source=feed&utm_medium=rss');
  assert.equal(first.published, '2026-09-14T09:57:02.000Z');
  assert.equal(first.summary, 'A short summary with markup.', 'HTML is stripped from summaries');
  assert.equal(first.source, 'example');
  assert.equal(first.sourceName, 'Example Solar');
  assert.equal(first.category, 'Industry');
  assert.equal(second.published, '2026-09-10T00:00:00.000Z', 'dc:date is accepted');
});

test('Atom entries use their alternate link and updated stamp', () => {
  const [item] = parseFeed(ATOM, { ...source, id: 'journal', name: 'Example Journal', category: 'Research' }, { now: NOW });
  assert.equal(item.url, 'https://example.org/tandems');
  assert.equal(item.published, '2026-09-12T07:30:00.000Z');
  assert.equal(item.category, 'Research');
});

test('a feed with no recognisable entries yields an empty list rather than throwing', () => {
  assert.deepEqual(parseFeed('<html><body>Not a feed</body></html>', source, { now: NOW }), []);
});

test('markup and entities never reach the list as visible text', () => {
  assert.equal(stripMarkup('<p>Hello&nbsp;<b>world</b> &#8212; ok</p>'), 'Hello world — ok');
  assert.equal(decodeEntities('&amp;&lt;&gt;&quot;'), '&<>"');
  assert.equal(decodeEntities('&unknownentity;'), '&unknownentity;', 'unknown entities are preserved');
  // The Guardian and Utility Dive publish escaped HTML, which used to survive
  // as visible "<p>" text once the entities were decoded for display.
  assert.equal(
    stripMarkup('&lt;p&gt;New research shows who benefits&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Solar sharer&lt;/li&gt;&lt;/ul&gt;'),
    'New research shows who benefits Solar sharer'
  );
  assert.equal(stripMarkup('&amp;lt;p&amp;gt;Twice escaped&amp;amp;lt;/p&amp;gt;'), 'Twice escaped');
  assert.equal(stripMarkup('<![CDATA[<p>Raw HTML</p>]]>'), 'Raw HTML');
  assert.equal(stripMarkup('<p>Keep <strong>this</strong><!-- drop this --> <script>bad()</script></p>'), 'Keep this');
  assert.equal(stripMarkup('<style>.x{color:red}</style>Text'), 'Text');
  assert.equal(stripMarkup('Camp module efficiency &lt; 20 % and VOC &gt; 40 V'), 'Camp module efficiency < 20 % and VOC > 40 V');
  assert.equal(stripMarkup('Temperature < 300 K'), 'Temperature < 300 K', 'a comparison is not a tag');
  assert.equal(
    stripMarkup('Module prices fell again. The post Module prices fell again appeared first on Solar Example.'),
    'Module prices fell again.'
  );
});

test('keyword filters narrow broad feeds without case sensitivity', () => {
  const patterns = ['solar', '\\bpv\\b'];
  assert.ok(matchesKeywords({ title: 'Solar cell efficiency record', summary: '' }, patterns));
  assert.ok(matchesKeywords({ title: 'Grid update', summary: 'A 200 MW PV plant' }, patterns));
  assert.ok(!matchesKeywords({ title: 'Crude oil forecast', summary: 'Refinery margins' }, patterns));
});

test('summaries are trimmed on a word boundary with an ellipsis', () => {
  const long = 'word '.repeat(120).trim();
  const trimmed = trimSummary(long);
  assert.ok(trimmed.length <= MAX_SUMMARY_CHARS + 1, 'the ellipsis is the only addition');
  assert.ok(trimmed.endsWith('…'));
  assert.ok(!trimmed.slice(0, -1).endsWith(' '), 'no trailing space before the ellipsis');
  assert.equal(trimSummary('short'), 'short');
});

test('URLs are compared without tracking parameters or cosmetic differences', () => {
  const a = canonicalUrl('https://www.Example.com/story/?utm_source=x&utm_medium=y');
  const b = canonicalUrl('http://example.com/story');
  assert.equal(a, b);
});

test('selection dedupes, sorts newest first, and respects both caps', () => {
  const make = (id, sourceId, published) => ({
    title: `Story ${id}`,
    url: `https://example.com/${sourceId}/${id}`,
    published,
    summary: '',
    source: sourceId,
    sourceName: sourceId,
    category: 'Industry',
  });

  const items = [
    make('a', 'one', '2026-09-01T00:00:00Z'),
    make('b', 'one', '2026-09-05T00:00:00Z'),
    { ...make('a', 'one', '2026-09-06T00:00:00Z'), url: 'https://www.example.com/one/a?utm_source=feed' },
    ...Array.from({ length: 40 }, (_, index) => make(`x${index}`, 'two', `2026-09-${String((index % 9) + 1).padStart(2, '0')}T00:00:00Z`)),
  ];

  const selected = selectItems(items, { perSource: 5, total: 8 });
  assert.equal(selected.filter(item => item.source === 'two').length, 5, 'per-source cap holds');
  assert.equal(selected.filter(item => canonicalUrl(item.url).endsWith('/one/a')).length, 1, 'duplicates collapse');
  assert.equal(selected.length, 7, 'every remaining item survives while the total cap is not reached');

  const many = [];
  for (let index = 0; index < 20; index += 1) {
    many.push(make(`s${index}`, `publisher-${index}`, '2026-09-07T00:00:00Z'), make(`t${index}`, `publisher-${index}`, '2026-09-06T00:00:00Z'));
  }
  assert.equal(selectItems(many, { perSource: 5, total: 8 }).length, 8, 'total cap holds');

  for (let index = 1; index < selected.length; index += 1) {
    assert.ok(
      new Date(selected[index - 1].published) >= new Date(selected[index].published),
      'items are ordered newest first'
    );
  }

  assert.ok(MAX_ITEMS_TOTAL >= 100, 'the total cap leaves room for a useful page');
  assert.ok(MAX_ITEMS_PER_SOURCE <= 15, 'no single publisher can dominate the list');
});

test('the payload carries everything the news view filters on', () => {
  const items = parseFeed(RSS, source, { now: NOW });
  const payload = buildPayload(
    [
      { source, items, error: null },
      { source: SOURCES[0], items: [], error: 'HTTP 503' },
    ],
    { generated: NOW.toISOString() }
  );

  assert.equal(payload.generated, '2026-09-14T12:00:00.000Z');
  assert.equal(payload.refreshHours, REFRESH_HOURS);
  assert.deepEqual(payload.categories, CATEGORIES);
  assert.equal(payload.items.length, 2);
  assert.deepEqual(
    payload.sources.map(entry => entry.id).sort(),
    SOURCES.map(entry => entry.id).sort()
  );
  assert.deepEqual(payload.unavailable, [{ id: SOURCES[0].id, name: SOURCES[0].name, error: 'HTTP 503' }]);
  for (const entry of payload.sources) {
    assert.ok(entry.name && entry.category && entry.homepage, `${entry.id} is describable in the filter row`);
  }
});

test('publishers are curated: unique ids, https feeds, known categories', () => {
  const ids = new Set();
  for (const entry of SOURCES) {
    assert.match(entry.id, /^[a-z0-9-]+$/, `${entry.id} is a stable filter value`);
    assert.ok(!ids.has(entry.id), `${entry.id} is unique`);
    ids.add(entry.id);
    assert.match(entry.url, /^https:\/\//, `${entry.id} is fetched over https`);
    assert.match(entry.homepage, /^https:\/\//, `${entry.id} names a publisher page`);
    assert.ok(CATEGORIES.includes(entry.category), `${entry.id} belongs to a filterable category`);
    if (entry.keywords) {
      assert.ok(entry.keywords.length > 0);
      entry.keywords.forEach(pattern => assert.doesNotThrow(() => new RegExp(pattern)));
    }
  }
  for (const category of CATEGORIES) {
    assert.ok(SOURCES.some(entry => entry.category === category), `${category} has at least one publisher`);
  }
});

test('the scrape is forgiving: one request per feed, timed out, on a slow schedule', async () => {
  const fetcher = await readFile(path.join(ROOT, 'tools', 'fetch_news.mjs'), 'utf8');
  const workflow = await readFile(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
  const cron = workflow.match(/cron:\s*'([^']+)'/);
  assert.ok(cron, 'the deploy workflow rebuilds the feed on a schedule');

  const [, minute, hour] = cron[1].match(/^(\S+)\s+(\S+)\s+\*\s+\*\s+\*$/);
  assert.equal(hour.slice(0, 2), '*/', 'the rebuild repeats a fixed number of hours apart');
  const step = Number(hour.slice(2));
  assert.ok(step >= 4, `${step}-hour interval is deliberately slow`);
  assert.match(minute, /^\d+$/, 'scheduled off the hour rather than on it');
  assert.ok(REQUEST_TIMEOUT_MS <= 20000, 'a slow publisher cannot hold the rebuild open');
  assert.equal(fetcher.match(/await fetch\(/g).length, 1, 'each feed is requested once, one after another');
  assert.ok(!/Promise\.all/.test(fetcher), 'no request burst');
  assert.match(fetcher, /PVWattsStudioNews\/1\.0 \(\+https:\/\/github\.com/, 'the request identifies itself with a contact URL');
});
