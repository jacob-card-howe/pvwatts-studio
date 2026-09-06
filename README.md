# PVWatts Studio

A small, dependency-free static web interface for the official **PVWatts® v8 API**. It provides location search, monthly production charts, exports, advanced model inputs, and tilt/azimuth studies.

The site is plain HTML, CSS, and JavaScript with no backend and no build step. The browser calls the PVWatts and geocoding services directly, so it can be hosted on any static host, including a free Cloudflare Pages project.

## Independent-project disclaimer

> **PVWatts Studio is an independent, third-party educational project developed as part of graduate coursework.** It is not affiliated with, sponsored by, endorsed by, or an official product of the National Laboratory of the Rockies (NLR, formerly NREL), the U.S. Department of Energy, or the PVWatts program. The web application only sends requests to and consumes responses from the publicly available PVWatts API; it does not include or redistribute the PVWatts service or its source code. No ownership of PVWatts, its underlying models or data, or any related names or marks is claimed. PVWatts® and related marks are the property of their respective owners. Use of the upstream API remains subject to its applicable terms and policies.

![PVWatts Studio interface](docs/imgs/pvwatts_studio.png)

> **Which calculation path should I use?** The web application is the canonical path. It calls the current public PVWatts v8 service and NSRDB TMY data. The optional command-line engine uses bundled, preprocessed historical station data and is retained for offline comparisons.

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

- Official PVWatts v8 calculations using current NSRDB TMY data
- Address, place, postal-code, and latitude/longitude search through OpenStreetMap Nominatim
- System size, module type, array type, losses, tilt, azimuth, DC/AC ratio, inverter efficiency, ground coverage ratio, albedo, bifaciality, and monthly irradiance-loss inputs
- Monthly and annual production, solar resource, capacity factor, and weather-grid metadata
- JSON and CSV exports
- A 77-combination tilt/azimuth parametric sweep
- Debounced updates, stale-request cancellation, and in-memory calculation caching

## How it works

```text
Location text
  -> OpenStreetMap/Nominatim geocoding
  -> latitude/longitude
  -> official PVWatts v8 API
  -> SSC pvwattsv8 + current NSRDB TMY
  -> normalized JSON response
  -> charts, table, and exports
```

[`static/pvwatts_client.js`](static/pvwatts_client.js) validates inputs in the browser, requests `dataset=nsrdb`, `radius=0`, and `timeframe=monthly` from PVWatts, and normalizes the response into the shape the interface renders.

A normal update costs one PVWatts request unless an identical calculation is served from the in-memory cache. A full parametric sweep can cost up to 77 requests, so use a personal developer key for batch studies.

## API key handling

The browser key field is a password input. The application does not write its value to local storage, session storage, exports, or application files. It is read at request time and sent only in the `api_key` query parameter that PVWatts itself requires. When the field is empty, the public `DEMO_KEY` is used.

Because there is no backend, every visitor supplies their own key and consumes their own quota. Do not deploy a personal key in the site source; it would be readable by anyone who opens the page.

The key remains visible in browser developer tools and is transmitted to NLR as required by the service.

## Optional historical CLI

The CLI runs the retained pure-Python approximation against preprocessed hourly station arrays. It does not call the public API and should not be used when results must match the current public PVWatts calculator.

```bash
python3 pvwatts_cli.py --location renton_tmy3 --size 4 --tilt 20 --azimuth 180
python3 pvwatts_cli.py --location seatac_tmy3 --size 6 --json
python3 pvwatts_cli.py --sweep-tilt --size 6 --losses 11 --azimuth 180
```

Available station IDs are listed in [`data/catalog.json`](data/catalog.json).

`--weather-file` remains for compatibility with older callers. Its filename is used to select a matching preprocessed station; the CLI does **not** parse arbitrary EPW contents. Commands that referenced the former bundled `weather_data/*.epw` paths continue to resolve to the equivalent preprocessed dataset.

## Development

Run the complete test suite:

```bash
node --test tests/test_pvwatts_client.mjs
python3 -m unittest tests.test_static_ui tests.test_legacy_cli -v
```

The tests stub the upstream responses and parse coordinates locally, so they do not consume API quota.

Useful smoke tests:

```bash
python3 pvwatts_cli.py --location renton_tmy3 --json
python3 -m http.server -d static 8000
```

When changing request or response fields, update the client tests and the browser markup checks together.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`static/`](static/) | The complete deployable site (~140 KB) |
| [`static/index.html`](static/index.html) | Browser interface |
| [`static/pvwatts_client.js`](static/pvwatts_client.js) | Official v8 adapter, input validation, geocoder, and cache |
| [`static/app.js`](static/app.js) | Controls, charts, exports, and parametric sweep logic |
| [`static/styles.css`](static/styles.css) | Interface styling |
| [`tests/`](tests/) | Client, browser-markup, and legacy CLI regression tests |
| [`pvwatts_cli.py`](pvwatts_cli.py) | Optional historical-weather command-line interface |
| [`pvwatts_fast.py`](pvwatts_fast.py) | Optional pure-Python historical calculation engine |
| [`data/`](data/) | Preprocessed hourly arrays required by the historical engine |

### Data footprint policy

Only data required at runtime is tracked:

- `data/*.json` supports the optional historical CLI and engine. It sits outside `static/` so it is not part of the deployed site.
- Raw EPW bundles are not required because the historical engine reads the preprocessed JSON arrays directly.
- Copies of SSC source are not required because the web application calls the hosted PVWatts API and does not compile SSC locally.

Keep downloaded weather bundles, generated export formats, and source-code reference copies outside the repository. The ignore rules cover the former local artifact paths to prevent accidental reintroduction.

## Location search and attribution

Location searches are submitted only when the user presses **Search** or **Enter**, rather than on every keystroke, to comply with the public Nominatim usage policy. The browser identifies itself to Nominatim with its own `User-Agent` and `Referer`. Location data is © OpenStreetMap contributors.

PVWatts is a registered trademark of the National Laboratory of the Rockies (formerly NREL). See the [independent-project disclaimer](#independent-project-disclaimer) above.

## License

This project's own source is released under the [MIT License](LICENSE). The license covers only the code in this repository; it does not extend to the PVWatts service, NSRDB data, Chart.js, or OpenStreetMap data, which remain subject to their own terms.
