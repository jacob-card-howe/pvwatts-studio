# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

PVWatts Studio primarily serves students and educators who need to configure a photovoltaic system, understand its modeled performance, and communicate or compare the resulting estimates.

## Product Purpose

PVWatts Studio provides a clearer, more usable interface for producing credible solar-production estimates with the official PVWatts v8 model and current NSRDB data. A successful session ends with a trustworthy location- and system-specific estimate that the user can inspect or export; users should also be able to compare selected configurations and explain the effect of their assumptions.

## Positioning

PVWatts Studio is an independent educational interface for the official PVWatts calculation service. It combines official-model fidelity with a local, lightweight workflow, immediate parameter feedback, transparent monthly results, exports, and direct tilt/azimuth comparison—created specifically to improve on the usability of the official calculator without replacing its modeling engine.

## Operating Context

Users run a local Python server, open the browser application, choose a location, enter standard or advanced PV system assumptions, and review annual and monthly performance outputs. They can copy headline values, export JSON or CSV results, and run a 77-combination tilt/azimuth study. Location search uses OpenStreetMap Nominatim; production estimates use the hosted PVWatts service. A personal NLR developer API key can be entered for the browser session or supplied to the local server when shared `DEMO_KEY` limits are insufficient.

The browser application is the canonical calculation path. The retained command-line engine uses bundled preprocessed historical station data and exists only for offline comparison; it is not the authoritative path when results must match the current public PVWatts calculator.

## Capabilities and Constraints

- Official PVWatts v8 calculations with current NSRDB typical meteorological year data.
- Address, place, postal-code, and latitude/longitude search.
- Standard and advanced model inputs, including system size, module and array types, losses, tilt, azimuth, DC/AC ratio, inverter efficiency, ground coverage ratio, albedo, bifaciality, and monthly irradiance losses.
- Monthly and annual production, solar resource, capacity factor, energy yield, weather-grid metadata, JSON/CSV exports, and a 77-case tilt/azimuth comparison.
- Python 3.10+ with no third-party package installation; the application uses the Python standard library and a plain HTML/CSS/JavaScript frontend.
- Internet access is required for geocoding, Chart.js, and canonical PVWatts calculations.
- API quotas are an operating constraint. The shared `DEMO_KEY` can return rate-limit errors, and a full comparison can consume up to 77 PVWatts requests.
- Browser-provided API keys must remain session-only: they are sent to the local server for the corresponding request and are not written to browser storage, exports, or application files.
- The server binds to loopback by default to avoid exposing a browser-provided key to other devices.

## Brand Commitments

The product name is **PVWatts Studio**. It is an independent, third-party educational project developed as part of graduate coursework. It must not be presented as affiliated with, sponsored by, endorsed by, or an official product of the National Laboratory of the Rockies (formerly NREL), the U.S. Department of Energy, or the PVWatts program. PVWatts® and related marks remain the property of their respective owners, and visible attribution and non-affiliation language must be preserved.

The product voice should remain technically precise, educational, and explicit about model provenance, data source, uncertainty-inducing assumptions, API limits, and the distinction between this interface and the upstream service.

The UMass Lowell-derived color scheme currently defined in `static/styles.css` is a binding visual identity constraint and should be preserved in future design work. The interface does not need to name or explicitly reference UMass Lowell; preserve the palette without implying institutional affiliation or endorsement.

## Evidence on Hand

- `README.md`: product scope, canonical workflow, operational requirements, feature inventory, API-key policy, data policy, and independent-project disclaimer.
- `static/index.html`: current product copy, complete input and output structure, exports, comparison workflow, attribution, and visible disclaimer.
- `static/app.js`: interactive behavior, request lifecycle, current charts, comparison logic, exports, and session-only API-key handling.
- `pvwatts_api.py` and `server.py`: official-service integration, validation rules, caching, geocoding, local serving, and error behavior.
- `tests/`: automated evidence for adapter normalization, HTTP behavior, static UI commitments, browser key handling, and the legacy CLI boundary.
- `docs/imgs/pvwatts_studio.png`: a committed screenshot of the current interface.
- No testimonials, customer adoption evidence, production-deployment claims, or comparative usability study are present; future work must not fabricate them.

## Product Principles

1. **Official results, clearly sourced.** Preserve the official PVWatts v8 and current NSRDB path and make the provenance of every estimate clear.
2. **Credibility through transparency.** Expose the assumptions, units, data source, validation boundaries, and limitations needed to understand and teach the result.
3. **Comparison should deepen understanding.** Make meaningful system choices easy to compare without implying unsupported precision or certainty.
4. **Local and lightweight by default.** Preserve the dependency-free local workflow and careful, session-only handling of user-supplied credentials.
5. **Independent, never misleading.** Keep the educational and non-affiliated status unambiguous wherever the product is presented.
