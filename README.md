# PVWatts Studio

A small, dependency-free static web interface for the official **PVWatts® v8 API**. It provides location search, monthly production charts, exports, advanced model inputs, and tilt/azimuth studies.

The site is plain HTML, CSS, and JavaScript with no backend and no build step. The browser calls the PVWatts and geocoding services directly, so it can be hosted on any static host, including a free Cloudflare Pages project.

## Independent-project disclaimer

> **PVWatts Studio is an independent, third-party educational project developed as part of graduate coursework.** It is not affiliated with, sponsored by, endorsed by, or an official product of the National Laboratory of the Rockies (NLR, formerly NREL), the U.S. Department of Energy, or the PVWatts program. The web application only sends requests to and consumes responses from the publicly available PVWatts API; it does not include or redistribute the PVWatts service or its source code. No ownership of PVWatts, its underlying models or data, or any related names or marks is claimed. PVWatts® and related marks are the property of their respective owners. Use of the upstream API remains subject to its applicable terms and policies.

![PVWatts Studio interface](docs/imgs/pvwatts_studio.png)

> **Which calculation path should I use?** The web application is the canonical path. It calls the current public PVWatts v8 service and uses the TMY3 station archive by default; the weather dataset can be switched to current NSRDB gridded TMY data, the older TMY2 station archive, or the international dataset for comparison.

## Quick start

Requirements:

- Any static file server for local development (Python 3 is used below, but nothing in the site requires it)
- Internet access for location search, Chart.js, and PVWatts calculations
- An [NLR developer API key](https://developer.nlr.gov/) (recommended)

```bash
python3 -m http.server -d static 8000
```

Open <http://localhost:8000> and enter an API key in the browser.

Opening `static/index.html` directly from the filesystem is not supported; serve the directory over HTTP so the browser sends a normal origin to the upstream services.

The public `DEMO_KEY` is used when no key is entered, but its low rate limit can produce HTTP 429 responses.

## Deploying to Cloudflare Pages

`static/` is the complete site. There is no build step and no server-side code, so it fits comfortably in the Cloudflare Pages free tier.

```bash
npx wrangler pages deploy static --project-name pvwatts-studio
```

For the git integration, set the build command to none and the output directory to `static`. Any other static host works the same way.

Both upstream services send `Access-Control-Allow-Origin: *` on success and on error responses, which is what makes the backend unnecessary.

## Features

- Official PVWatts v8 calculations using the TMY3 station archive by default
- Selectable weather dataset: TMY3 (default), NSRDB gridded TMY, TMY2, and International, so an estimate can be compared against the current gridded data or the legacy station archives
- Address, place, postal-code, and latitude/longitude search through OpenStreetMap Nominatim
- System size, module type, array type, losses, tilt, azimuth, DC/AC ratio, inverter efficiency, ground coverage ratio, albedo, bifaciality, and monthly irradiance-loss inputs
- Monthly and annual production, solar resource, capacity factor, and weather-grid metadata
- JSON and CSV exports
- A 77-combination tilt/azimuth parametric sweep
- A **Solar News** view that lists photovoltaic headlines from publisher feeds, filterable by topic, source, and free-text search, with every entry linking to the publisher
- A module datasheet reader that pulls specifications out of a manufacturer PDF into an editable table and works the standard datasheet calculations
- Debounced updates, stale-request cancellation, and in-memory calculation caching

## How it works

```text
Location text
  -> OpenStreetMap/Nominatim geocoding
  -> latitude/longitude
  -> official PVWatts v8 API
  -> SSC pvwattsv8 + selected NSRDB or TMY weather dataset
  -> normalized JSON response
  -> charts, table, and exports
```

[`static/pvwatts_client.js`](static/pvwatts_client.js) validates inputs in the browser, requests the selected `dataset` — `tmy3` by default, or `nsrdb`, `tmy2`, or `intl` — along with `radius=0` and `timeframe=monthly` from PVWatts, and normalizes the response into the shape the interface renders. The dataset and the station the upstream service selected are reported with every result and included in the JSON export. TMY3 stations are concentrated in the United States, so some locations need NSRDB or the international dataset.

A normal update costs one PVWatts request unless an identical calculation is served from the in-memory cache. A full parametric sweep can cost up to 77 requests, so use a personal developer key for batch studies.

## Datasheet reader

The **Datasheet Reader** tab opens a PV module specification sheet, finds the page carrying the specification tables, and fills an editable table with the values it recognises. The PDF is read in the browser through [pdf.js](https://mozilla.github.io/pdf.js/); nothing is uploaded and the panel makes no API requests.

Extraction is a reading aid, not an authority. Three things keep a wrong number from reaching a calculation:

1. **The source page sits beside the table.** Every filled value also names the datasheet row it was taken from, so confirming it is a glance rather than a hunt.
2. **Implausible candidates are rejected.** Each specification carries the range it can physically occupy, so a dimension callout or a neighbouring table that happens to land in the same PDF row is discarded instead of reported. A value that cannot be located is left blank and flagged — the reader never guesses.
3. **Independently stated numbers are cross-checked.** Pmax against Vmp x Imp, the stated module efficiency against Pmax divided by area, NOCT power against STC power, and the fill factor against the range a real module occupies. A disagreement names the rows to re-read.
4. **A second electrical block is only called NOCT when it states less power.** NOCT is measured at 800 W/m², so its power is always lower than STC. A sheet whose second block states *more* power is publishing bifacial gain (BNPI/BSTC), and it is labelled as such instead — reading it as NOCT would corrupt every NOCT-based result.

Every field is editable, and the calculations always run on the table as it stands rather than on the extraction:

| Quantity | Formula |
| --- | --- |
| Module area | height x length |
| Module efficiency | Pmax / (area x 1000 W/m²) x 100 |
| Fill factor (STC and NOCT) | (Vmp x Imp) / (Voc x Isc) |
| Minimum and maximum power | Pmax plus the stated power tolerance, in watts or percent |
| Power difference, NOCT vs STC | (high - low) / high x 100 |

Sheets that lay each specification out as a labelled row are read in full, including sheets that list several power classes in shared rows — a column picker selects the module and swaps every per-class value at once, while ratings stated once for the whole sheet stay put. Sheets that transpose the electrical table so models are rows and quantities are wrapped multi-line column headers (Canadian Solar) yield the mechanical and ratings blocks only; the electrical cells stay blank for manual entry rather than being guessed.

The extractor is verified against the published sheets for Silfab SIL-530 XM Bifacial, REC N-Peak 3 Black (390/400 W), Qcells Q.PEAK DUO ML-G12S (650–675 W), and Canadian Solar CS6.2-66TB.

The reader follows the System Simulator’s inputs-left, results-right layout. Specifications are grouped into expandable electrical, temperature, ratings, and mechanical sections. **Next blank** opens and focuses the next required value; each **Datasheet row** disclosure shows the full original source text. Editing a value updates its source annotation, unit conversion, calculations, and headline measurements immediately.

The same table works without a PDF — **Enter values manually** opens it empty, for figures given in a problem rather than read off a sheet. Manufacturer and model are under **Module details**. The source PDF has page navigation, zoom, and **Fit width**, and can be collapsed to bring calculations closer. On smaller screens, a results link connects the inputs to the overview, and calculation rows keep their result and formula visible without horizontal scrolling.

Results export as JSON or CSV from the overview heading, including each value's source, the calculations, and the outcome of every consistency check. Exports become available when at least one specification has a value.

## Solar news

The **Solar News** link in the footer opens an aggregated list of photovoltaic headlines, built in the Brutalist Report spirit: a date column, a headline, a one-line summary, and the publisher. Every entry is a link to the publisher's own page.

The list covers four topics and can be filtered by topic, by any single publisher, and by free text:

| Topic | Publishers |
| --- | --- |
| Industry | pv magazine (Global, USA, Australia), PV Tech, Solar Power World, Solar Builder, Renewable Energy World, Canary Media, CleanTechnica, Utility Dive |
| Research | Nature (Solar cells), Nature Energy, Progress in Photovoltaics, Solar RRL, ScienceDaily (Solar Energy), Berkeley Lab, MIT News (Energy) |
| Policy | The Guardian (Solar power), U.S. Department of Energy, EIA Today in Energy, Carbon Brief |
| Video | Solar Power World |

Broad feeds are filtered to photovoltaic items by keyword, and a feed's own list is capped so no single publisher can dominate the view.

### How the aggregation stays polite

The browser reads one static file, `static/news.json`. It never contacts a publisher, so no publisher receives traffic from this site and the view adds no third-party requests to a page load. The list itself is rebuilt by `tools/fetch_news.mjs`, which is run by the deploy workflow on a four-times-a-day schedule:

- one request per feed per rebuild, no retries, with a self-identifying `User-Agent`;
- a 15-second timeout for slow publishers, and at most three requests in flight at once;
- each publisher therefore sees four requests a day, well inside what these sites expect;
- if no source answers, the previous `static/news.json` is left intact rather than replaced with an empty list.

`static/news.json` is committed so the site works when served directly from `static/`, and is regenerated by CI before each deployment. The news view shows the rebuild time of the list it is displaying. GitHub pauses scheduled workflows in repositories that go 60 days without activity, so on an inactive repository the list goes stale at its last good rebuild until the workflow runs again.

To rebuild it locally:

```bash
node tools/fetch_news.mjs
```

To add a publisher, add an entry to `SOURCES` in [`tools/fetch_news.mjs`](tools/fetch_news.mjs) with an `id`, a `name`, a `category`, a `homepage`, and a feed `url`. The filter row in the news view is built from the payload, so no markup change is needed. `tests/test_news_fetcher.mjs` checks the source list and the extraction rules, and `tests/test_static_ui.py` checks the published payload against what the view expects.

## API key handling

The browser key field is a password input. The application does not write its value to local storage, session storage, exports, or application files. It is read at request time and sent only in the `api_key` query parameter that PVWatts itself requires. When the field is empty, the public `DEMO_KEY` is used.

Because there is no backend, every visitor supplies their own key and consumes their own quota. Do not deploy a personal key in the site source; it would be readable by anyone who opens the page.

The key remains visible in browser developer tools and is transmitted to NLR as required by the service.

## Development

Run the complete test suite:

```bash
node --test tests/test_pvwatts_client.mjs tests/test_datasheet_parser.mjs tests/test_news_fetcher.mjs
python3 -m unittest tests.test_static_ui -v
```

`tests/test_news_fetcher.mjs` runs the aggregator against recorded RSS 2.0 and Atom shapes, so it needs no network access and consumes no publisher traffic. `tests/test_static_ui.py` also checks the payload in `static/news.json` against the contract the news view relies on.

`tests/test_datasheet_parser.mjs` runs the extractor against the text layer of real manufacturer datasheets held in [`tests/fixtures/datasheets/`](tests/fixtures/datasheets/), asserting the exact values printed on those sheets.

The tests stub the upstream responses and parse coordinates locally, so they do not consume API quota.

For the reader’s browser regression and desktop/mobile screenshot pass, use Playwright CLI with a local static server on port 8765:

```bash
python3 tests/make_datasheet_pdf.py .impeccable/review/rec-text-fixture.pdf
python3 -m http.server --bind 127.0.0.1 -d static 8765
# In a second terminal:
playwright-cli open
playwright-cli run-code --filename=tests/datasheet_browser.js
playwright-cli close
```

This exercises the actual pdf.js loader with a labelled, text-only PDF generated from the REC fixture, plus manual entry, source annotations, unit conversions, column switching, exports, zoom, clear-during-load, and responsive layouts. It stubs PVWatts requests and writes local screenshots/exports under the ignored `.impeccable/review/` directory. The generated PDF is a UI test fixture, not the original manufacturer PDF.

Useful smoke test:

```bash
python3 -m http.server -d static 8000
```

When changing request or response fields, update the client tests and the browser markup checks together.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`static/`](static/) | The complete deployable site (313 KB, 81 KB gzipped) |
| [`static/index.html`](static/index.html) | Browser interface |
| [`static/pvwatts_client.js`](static/pvwatts_client.js) | Official v8 adapter, input validation, geocoder, and cache |
| [`static/app.js`](static/app.js) | Controls, charts, exports, and parametric sweep logic |
| [`static/news.js`](static/news.js) | Solar News tab: filter chips, search, and headline list |
| [`static/news.json`](static/news.json) | Generated aggregated headlines the news view reads |
| [`tools/fetch_news.mjs`](tools/fetch_news.mjs) | News aggregator: feed reader, source list, and polite fetch rules |
| [`static/datasheet_parser.js`](static/datasheet_parser.js) | Datasheet text-layer extraction, plausibility ranges, and derived metrics |
| [`static/datasheet.js`](static/datasheet.js) | Datasheet tab: PDF loading, page rendering, editable table, and exports |
| [`static/styles.css`](static/styles.css) | Interface styling |
| [`tests/`](tests/) | Client and browser-markup regression tests |

### Data footprint policy

Only data required at runtime is tracked:

- Copies of SSC source are not required because the web application calls the hosted PVWatts API and does not compile SSC locally.

- `tests/fixtures/datasheets/*.json` are text layers, not PDFs: only the strings and their positions are kept, at roughly 40 KB each, and they sit outside `static/`. They exist because the datasheet reader's accuracy claim is only meaningful when it is asserted against real published sheets.

- `static/news.json` is tracked because the news view needs it at runtime, and it is the file the deploy workflow regenerates before publishing. It holds headlines, links, and short summaries only.

Keep downloaded weather bundles, manufacturer PDFs, generated export formats, and source-code reference copies outside the repository. The ignore rules cover the former local artifact paths to prevent accidental reintroduction.

## Location search and attribution

Location searches are submitted only when the user presses **Search** or **Enter**, rather than on every keystroke, to comply with the public Nominatim usage policy. The browser identifies itself to Nominatim with its own `User-Agent` and `Referer`. Location data is © OpenStreetMap contributors.

PVWatts is a registered trademark of the National Laboratory of the Rockies (formerly NREL). See the [independent-project disclaimer](#independent-project-disclaimer) above.

## License

This project's own source is released under the [MIT License](LICENSE). The license covers only the code in this repository; it does not extend to the PVWatts service, NSRDB or TMY data, Chart.js, or OpenStreetMap data, which remain subject to their own terms.
