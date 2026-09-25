/**
 * PVWatts Studio - Solar News tab.
 *
 * Renders the aggregated feed written by `tools/fetch_news.mjs` to
 * `news.json`. The browser reads one same-origin static file: it never
 * contacts a news publisher, sends no query to a third party, and stores
 * nothing. The list is rebuilt on a schedule, so filtering and searching are
 * local operations over the last payload.
 */

const NEWS_FEED_URL = 'news.json';
const NEWS_CATEGORY_ALL = 'all';

const newsState = {
  data: null,
  category: NEWS_CATEGORY_ALL,
  source: NEWS_CATEGORY_ALL,
  query: '',
  loading: false,
};

function newsElement(id) {
  return document.getElementById(id);
}

function formatNewsTimestamp(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });
}

function formatNewsAge(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function newsItemMatches(item) {
  if (newsState.category !== NEWS_CATEGORY_ALL && item.category !== newsState.category) return false;
  if (newsState.source !== NEWS_CATEGORY_ALL && item.source !== newsState.source) return false;
  if (!newsState.query) return true;
  const haystack = `${item.title} ${item.summary} ${item.sourceName}`.toLowerCase();
  return haystack.includes(newsState.query);
}

function createNewsChip(label, value, pressed, onSelect) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'news-chip';
  chip.textContent = label;
  chip.dataset.value = value;
  chip.setAttribute('aria-pressed', String(pressed));
  chip.addEventListener('click', () => onSelect(value));
  return chip;
}

function renderNewsFilters() {
  const { data } = newsState;
  const rows = [
    ['news-filter-category', 'All topics', data.categories.map(name => ({ label: name, value: name })), 'category'],
    ['news-filter-source', 'All sources', data.sources.map(source => ({ label: source.name, value: source.id })), 'source'],
  ];

  for (const [containerId, allLabel, entries, key] of rows) {
    const chips = [createNewsChip(allLabel, NEWS_CATEGORY_ALL, newsState[key] === NEWS_CATEGORY_ALL, select => {
      newsState[key] = select;
      renderNewsFilters();
      renderNewsList();
    })];
    for (const entry of entries) {
      chips.push(createNewsChip(entry.label, entry.value, newsState[key] === entry.value, select => {
        newsState[key] = select;
        renderNewsFilters();
        renderNewsList();
      }));
    }
    newsElement(containerId).replaceChildren(...chips);
  }
}

function createNewsItem(item) {
  const row = document.createElement('li');
  row.className = 'news-item';

  const when = document.createElement('time');
  when.className = 'news-item-when';
  when.dateTime = item.published;
  when.textContent = formatNewsAge(item.published);

  const body = document.createElement('div');
  body.className = 'news-item-body';

  const headline = document.createElement('a');
  headline.className = 'news-item-headline';
  headline.href = item.url;
  headline.target = '_blank';
  headline.rel = 'noopener noreferrer';
  headline.textContent = item.title;
  // The headline is the only thing that leaves the site, so its destination is
  // stated rather than left to the browser's status bar.
  headline.title = `${item.sourceName} — ${item.title}`;
  body.append(headline);

  if (item.summary) {
    const summary = document.createElement('p');
    summary.className = 'news-item-summary';
    summary.textContent = item.summary;
    body.append(summary);
  }

  const meta = document.createElement('p');
  meta.className = 'news-item-meta';
  const category = document.createElement('span');
  category.className = 'news-item-category';
  category.textContent = item.category;
  const source = document.createElement('span');
  source.className = 'news-item-source';
  source.textContent = item.sourceName;
  meta.append(category, source);
  body.append(meta);

  row.append(when, body);
  return row;
}

function renderNewsList() {
  const { data } = newsState;
  const list = newsElement('news-list');
  const status = newsElement('news-status');

  if (!data) {
    list.replaceChildren();
    return;
  }

  const items = data.items.filter(newsItemMatches);
  const fragment = document.createDocumentFragment();
  items.forEach(item => fragment.append(createNewsItem(item)));
  list.replaceChildren(fragment);

  const total = data.items.length;
  const filtered =
    items.length !== total || newsState.category !== NEWS_CATEGORY_ALL || newsState.source !== NEWS_CATEGORY_ALL || Boolean(newsState.query);
  status.textContent = filtered
    ? `Showing ${items.length} of ${total} headlines.`
    : `${total} headlines, newest first.`;
  newsElement('news-empty').hidden = items.length > 0;
  renderNewsUpdated(data);
}

// Two unbreakable phrases, so a narrow card wraps the readout between them
// instead of mid-date or past the card edge.
function renderNewsUpdated(data) {
  const when = document.createElement('span');
  when.className = 'news-updated-when';
  when.textContent = `Rebuilt ${formatNewsTimestamp(data.generated)}`;
  const cadence = document.createElement('span');
  cadence.className = 'news-updated-cadence';
  cadence.textContent = `every ${data.refreshHours} hours`;
  newsElement('news-updated').replaceChildren(when, cadence);
}

function renderNewsUnavailable() {
  const note = newsElement('news-unavailable');
  const missing = newsState.data ? newsState.data.unavailable : [];
  note.hidden = missing.length === 0;
  note.textContent = missing.length
    ? `${missing.length} ${missing.length === 1 ? 'feed was' : 'feeds were'} unavailable at the last rebuild: ${missing
        .map(entry => entry.name)
        .join(', ')}.`
    : '';
}

async function loadNewsFeed() {
  if (newsState.loading || newsState.data) return;
  newsState.loading = true;
  const status = newsElement('news-status');
  status.textContent = 'Loading aggregated headlines…';

  try {
    const response = await fetch(NEWS_FEED_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error('unexpected feed shape');
    newsState.data = data;
    renderNewsFilters();
    renderNewsList();
    renderNewsUnavailable();
  } catch (error) {
    status.textContent = `The aggregated feed could not be loaded (${error.message}). Running the site locally? Generate it with "node tools/fetch_news.mjs".`;
    newsElement('news-updated').textContent = '';
  } finally {
    newsState.loading = false;
  }
}

function resetNewsFilters() {
  newsState.category = NEWS_CATEGORY_ALL;
  newsState.source = NEWS_CATEGORY_ALL;
  newsState.query = '';
  newsElement('news-search').value = '';
  renderNewsFilters();
  renderNewsList();
}

/** Open the news workspace from the footer button. */
function openNewsTab() {
  const tab = newsElement('tab-news');
  if (!tab) return;
  tab.click();
  const panel = newsElement('news-tab');
  if (panel) panel.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function initNewsTab() {
  const search = newsElement('news-search');
  search.addEventListener('input', () => {
    newsState.query = search.value.trim().toLowerCase();
    renderNewsList();
  });
  newsElement('news-reset').addEventListener('click', resetNewsFilters);
  newsElement('footer-news').addEventListener('click', openNewsTab);

  const tab = newsElement('tab-news');
  tab.addEventListener('click', () => {
    loadNewsFeed();
  });
  // Arrow-key navigation in the tab strip activates tabs without a click.
  window.addEventListener('pvwatts:tabchange', event => {
    if (event.detail && event.detail.tab === 'tab-news') loadNewsFeed();
  });

  newsElement('news-empty').hidden = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNewsTab);
} else {
  initNewsTab();
}
