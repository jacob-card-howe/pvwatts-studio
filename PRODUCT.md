# Product

## Platform

web

## Users

PVWatts Studio primarily serves students and educators who need to configure a photovoltaic system, understand its modeled performance, and communicate or compare the resulting estimates.

## Product Purpose

PVWatts Studio provides a clearer, more usable interface for producing credible solar-production estimates with the official PVWatts v8 model and NSRDB weather data. It uses the TMY3 station archive by default, with current NSRDB gridded data, TMY2, and the international dataset selectable. A successful session ends with a trustworthy location- and system-specific estimate that the user can inspect or export; users should also be able to compare selected configurations and explain the effect of their assumptions.

## Positioning

PVWatts Studio is an independent educational interface for the official PVWatts calculation service. It combines official-model fidelity with a local, lightweight workflow, immediate parameter feedback, transparent monthly results, exports, and direct tilt/azimuth comparison—created specifically to improve on the usability of the official calculator without replacing its modeling engine.

## Operating Context

Users run a local Python server, open the browser application, choose a location, enter standard or advanced PV system assumptions, and review annual and monthly performance outputs. They can copy headline values, export JSON or CSV results, search for the optimal tilt and azimuth with two PVWatts requests, and run the 77-combination official tilt/azimuth grid. Location search uses OpenStreetMap Nominatim; production estimates use the hosted PVWatts service. A personal NLR developer API key can be entered for the browser session when shared `DEMO_KEY` limits are insufficient.

## Capabilities and Constraints

- Official PVWatts v8 calculations with the TMY3 station archive by default.
- A selectable weather dataset — TMY3 (default), NSRDB gridded TMY, TMY2, or International — so an estimate can be compared against the current gridded data or the legacy station archives; the dataset and the selected climate station are reported with the result and exported. TMY3 stations are US-centric, so some locations need NSRDB or the international dataset.
- Address, place, postal-code, and latitude/longitude search.
- Standard and advanced model inputs, including system size, module and array types, losses, tilt, azimuth, DC/AC ratio, inverter efficiency, ground coverage ratio, albedo, bifaciality, and monthly irradiance losses.
- Monthly and annual production, solar resource, capacity factor, energy yield, weather-grid metadata, JSON/CSV exports, and a 77-case tilt/azimuth comparison.
- An optimal-orientation search for fixed monofacial arrays: one hourly PVWatts request supplies the weather, an in-browser model adapted from the open-source SAM Simulation Core searches every orientation after checking itself against the official result, and one official request confirms the optimum. Local values are labelled as calibrated estimates; the reported optimum energy is always the official figure.
- A Solar News view that aggregates photovoltaic headlines from publisher, journal, and agency feeds, filterable by topic, by any single publisher, and by free text. Aggregation happens on a slow schedule in the build rather than in the browser, so the site adds no requests to publishers and no third-party requests to a page load; every headline links back to the publisher.
- It is a reading aid, not an authority: headlines and summaries come from each publisher's own feed and the view shows when the list was last rebuilt.
- A module datasheet reader that extracts specifications from a manufacturer PDF in the browser, renders the source page beside an editable table, cross-checks independently stated values, and computes module area, efficiency, fill factor, power-tolerance bounds, and the NOCT-versus-STC power difference. Extraction is presented as a reading aid to be confirmed, never as an authority; values that cannot be located are left blank rather than guessed. Inverter datasheets are out of scope for now.
- Python 3.10+ with no third-party package installation; the application uses the Python standard library and a plain HTML/CSS/JavaScript frontend.
- Internet access is required for geocoding, Chart.js, and canonical PVWatts calculations. The news view needs no third-party access: it reads a static file in the deployed site.
- Publisher feeds are contacted only by `tools/fetch_news.mjs`, which runs four times a day with one request per feed; adding a publisher means adding it to the curated `SOURCES` list, not scraping a site at runtime.
- API quotas are an operating constraint. The shared `DEMO_KEY` can return rate-limit errors. The orientation search uses two PVWatts requests; the official grid comparison can consume up to 77.
- Browser-provided API keys must remain session-only: they are sent to the local server for the corresponding request and are not written to browser storage, exports, or application files.
- The server binds to loopback by default to avoid exposing a browser-provided key to other devices.

## Brand Commitments

The product name is **PVWatts Studio**. It is an independent, third-party educational project developed as part of graduate coursework. It must not be presented as affiliated with, sponsored by, endorsed by, or an official product of the National Laboratory of the Rockies (formerly NREL), the U.S. Department of Energy, or the PVWatts program. PVWatts® and related marks remain the property of their respective owners, and visible attribution and non-affiliation language must be preserved.

The product voice should remain technically precise, educational, and explicit about model provenance, data source, uncertainty-inducing assumptions, API limits, and the distinction between this interface and the upstream service.

The UMass Lowell-derived color scheme currently defined in `static/styles.css` is a binding visual identity constraint and should be preserved in future design work. The interface does not need to name or explicitly reference UMass Lowell; preserve the palette without implying institutional affiliation or endorsement.

## Evidence on Hand

- `README.md`: product scope, canonical workflow, operational requirements, feature inventory, API-key policy, data policy, and independent-project disclaimer.
- `static/news.json`: generated headline list, source metadata, and rebuild timestamp the news view renders.
- `tools/fetch_news.mjs`: curated source list and the polite fetch schedule behind that file.
- `static/index.html`: current product copy, complete input and output structure, exports, comparison workflow, attribution, and visible disclaimer.
- `static/app.js`: interactive behavior, request lifecycle, current charts, comparison logic, exports, and session-only API-key handling.
- `static/pvwatts_client.js`: official-service integration, validation rules, caching, geocoding, and error behavior.
- `tests/`: automated evidence for adapter normalization, HTTP behavior, static UI commitments, and browser key handling.
- `tests/fixtures/datasheets/`: text layers of published Silfab, REC, and Canadian Solar module datasheets, used to assert the reader returns the exact values those sheets print.
- `docs/imgs/pvwatts_studio.png`: a committed screenshot of the current interface.
- No testimonials, customer adoption evidence, production-deployment claims, or comparative usability study are present; future work must not fabricate them.

## Product Principles

1. **Official results, clearly sourced.** Preserve the official PVWatts v8 path, keep the selected dataset and station provenance visible, and make the provenance of every estimate clear.
2. **Credibility through transparency.** Expose the assumptions, units, data source, validation boundaries, and limitations needed to understand and teach the result.
3. **Comparison should deepen understanding.** Make meaningful system choices easy to compare without implying unsupported precision or certainty.
4. **Local and lightweight by default.** Preserve the dependency-free local workflow and careful, session-only handling of user-supplied credentials.
5. **Independent, never misleading.** Keep the educational and non-affiliated status unambiguous wherever the product is presented.
