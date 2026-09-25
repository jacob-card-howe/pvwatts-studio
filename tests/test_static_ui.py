"""Static checks for the browser controls and API integration."""

from html.parser import HTMLParser
from pathlib import Path
import re
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]


class InputParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inputs = []
        self.elements_by_id = {}

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "input":
            self.inputs.append(attributes)
        if "id" in attributes:
            self.elements_by_id[attributes["id"]] = (tag, attributes)


class TestStaticUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = InputParser()
        cls.html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        cls.parser.feed(cls.html)
        cls.javascript = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")
        cls.client = (ROOT / "static" / "pvwatts_client.js").read_text(encoding="utf-8")
        cls.datasheet = (ROOT / "static" / "datasheet.js").read_text(encoding="utf-8")
        cls.datasheet_parser = (ROOT / "static" / "datasheet_parser.js").read_text(encoding="utf-8")
        cls.news = (ROOT / "static" / "news.js").read_text(encoding="utf-8")

    def test_root_canvas_uses_the_page_background_during_overscroll(self):
        self.assertRegex(
            self.styles,
            r"html\s*\{[^}]*background-color:\s*var\(--bg-primary\)",
        )

    def test_workspace_backdrop_is_viewport_anchored_across_tabs(self):
        self.assertRegex(
            self.styles,
            r"body::before\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*background:\s*var\(--workspace-backdrop\)",
        )

    def test_umass_lowell_palette_styles_the_ui_and_parametric_chart(self):
        official_palette = {
            "blue": "#1257D1",
            "black": "#000000",
            "dark-blue": "#00396E",
            "light-blue": "#5ADBFF",
            "gray": "#878A8F",
            "bright-blue": "#00B5F1",
            "green": "#3BD5AE",
            "aqua": "#62DAFC",
            "yellow": "#FFD140",
            "orange": "#FB471F",
            "fern": "#027669",
            "river": "#4295A9",
            "gold": "#D0AF22",
            "maroon": "#9E3124",
        }
        for name, hex_value in official_palette.items():
            with self.subTest(name=name):
                self.assertIn(f"--uml-{name}: {hex_value};", self.styles)
                self.assertIn(hex_value, self.javascript)

        self.assertIn("const PARAMETRIC_COLORS = Object.freeze([", self.javascript)
        self.assertIn("PARAMETRIC_COLORS[azimuthIndex % PARAMETRIC_COLORS.length]", self.javascript)
        self.assertIn("#parametric-tab > .card::before", self.styles)

    def test_continuous_number_inputs_accept_arbitrary_decimals(self):
        input_ids = (
            "num-capacity",
            "num-losses",
            "num-tilt",
            "num-azimuth",
            "input-dc-ac-ratio",
            "input-inv-eff",
            "input-gcr",
            "input-albedo",
            "input-bifaciality",
        )
        for input_id in input_ids:
            with self.subTest(input_id=input_id):
                tag, attributes = self.parser.elements_by_id[input_id]
                self.assertEqual(tag, "input")
                self.assertEqual(attributes["type"], "number")
                self.assertEqual(attributes["step"], "any")

    def test_all_twelve_monthly_irradiance_inputs_accept_decimals(self):
        monthly = [
            attributes
            for attributes in self.parser.inputs
            if "monthly-loss-input" in attributes.get("class", "").split()
        ]
        self.assertEqual(len(monthly), 12)
        self.assertEqual({attributes["data-month"] for attributes in monthly}, {str(i) for i in range(12)})
        self.assertTrue(all(attributes.get("step") == "any" for attributes in monthly))

    def test_api_key_is_demoted_after_quick_estimate_and_is_not_persisted(self):
        tag, attributes = self.parser.elements_by_id["input-api-key"]
        self.assertEqual(tag, "input")
        self.assertEqual(attributes["type"], "password")
        self.assertEqual(attributes["autocomplete"], "off")
        self.assertGreater(self.html.index('id="input-api-key"'), self.html.index('id="input-location"'))
        self.assertIn('class="api-access-settings"', self.html)
        self.assertIn("function getApiKey()", self.javascript)
        self.assertIn("apiKey: getApiKey()", self.javascript)
        for source in (self.javascript, self.client):
            self.assertNotIn("localStorage", source)
            self.assertNotIn("sessionStorage", source)

    def test_the_app_is_static_and_calls_the_upstream_services_directly(self):
        """The site deploys as static files, so no same-origin backend may exist."""
        for source in (self.javascript, self.html):
            self.assertNotIn("/api/", source)
        self.assertIn("https://developer.nlr.gov/api/pvwatts/v8.json", self.client)
        self.assertIn("https://nominatim.openstreetmap.org/search", self.client)
        self.assertIn('src="pvwatts_client.js"', self.html)
        self.assertLess(
            self.html.index('src="pvwatts_client.js"'),
            self.html.index('src="app.js"'),
            "the client must be loaded before app.js uses it",
        )

    def test_default_location_is_consistent_and_valid(self):
        self.assertIn('value="Renton, WA"', self.html)
        self.assertIn("name: 'Renton, WA'", self.javascript)
        self.assertIn("lat: 47.491", self.javascript)
        self.assertIn("lon: -122.216", self.javascript)
        self.assertNotIn("Reston, WA", self.html)
        self.assertNotIn("Reston, WA", self.javascript)

    def test_the_weather_dataset_is_selectable_and_defaults_to_tmy3(self):
        tag, attributes = self.parser.elements_by_id["select-dataset"]
        self.assertEqual(tag, "select")
        self.assertEqual(attributes["aria-describedby"], "dataset-help")

        selector = self.html.split('id="select-dataset"', 1)[1].split("</select>", 1)[0]
        options = re.findall(r'<option value="([^"]+)"([^>]*)>', selector)
        self.assertEqual([value for value, _attrs in options], ["tmy3", "nsrdb", "tmy2", "intl"])
        self.assertIn("selected", options[0][1], "TMY3 must be the default dataset")
        self.assertIn("const DEFAULT_DATASET = 'tmy3';", self.client)

        # The selector sits with the advanced model inputs and drives the request.
        self.assertLess(self.html.index('class="advanced-settings"'), self.html.index('id="select-dataset"'))
        self.assertLess(self.html.index('id="select-dataset"'), self.html.index('class="monthly-loss-fieldset"'))
        self.assertIn("dataset: getSelectedDataset()", self.javascript)
        self.assertIn("document.getElementById('select-dataset').addEventListener('change'", self.javascript)
        self.assertIn("dataset: currentParams.dataset", self.javascript)
        self.assertIn("dataset: inputs.dataset", self.client)
        self.assertIn("const DATASETS = Object.freeze({", self.client)

    def test_the_dataset_reaches_the_status_copy_and_exports(self):
        self.assertIn("function datasetLabel(dataset)", self.javascript)
        self.assertIn("${datasetLabel(params.dataset)} data", self.javascript)
        self.assertIn("station?.weather_data_source", self.javascript)
        # The export already serializes getParams(), which now carries the dataset.
        self.assertIn("parameters: params", self.javascript)

    def test_the_active_station_line_is_emphasized_in_the_status(self):
        self.assertIn("function setSimulationStatus(message, type = '', emphasis = '')", self.javascript)
        self.assertIn("const strong = document.createElement('strong')", self.javascript)
        self.assertIn("setSimulationStatus(`${result.model} · ${result.version} · `, 'success', grid)", self.javascript)
        self.assertRegex(self.styles, r"\.simulation-status strong\s*\{[^}]*font-weight:\s*800;")

    def test_internal_exercise_suite_is_not_present(self):
        self.assertNotIn("exercise", self.html.lower())
        self.assertNotIn("exercise", self.javascript.lower())

    def test_independent_project_disclaimer_is_visible(self):
        self.assertIn('aria-label="Independent-project disclaimer"', self.html)
        self.assertIn("Independent educational project", self.html)
        self.assertIn("graduate coursework", self.html)
        self.assertIn("not affiliated with", self.html)
        self.assertIn("only consumes the public PVWatts API", self.html)

    def test_monthly_solar_chart_is_built_with_api_data(self):
        self.assertIn("function renderMonthlySolarRadiationChart(res)", self.javascript)
        self.assertIn("data: values", self.javascript)
        self.assertNotIn("chartMonthlySolrad.data.datasets[0].data = res.monthlySolrad", self.javascript)

    def test_calculated_kpis_have_disabled_copy_buttons_until_results_exist(self):
        output_ids = (
            "kpi-ac-annual",
            "kpi-solrad-annual",
            "kpi-capacity-factor",
            "kpi-yield",
        )
        self.assertEqual(self.html.count('class="copy-output-btn"'), len(output_ids) * 2)
        simulator_panel = self.html.split('id="simulator-tab"', 1)[1].split('id="parametric-tab"', 1)[0]
        self.assertEqual(simulator_panel.count('class="copy-output-btn"'), len(output_ids))
        for output_id in output_ids:
            with self.subTest(output_id=output_id):
                self.assertRegex(
                    self.html,
                    rf'class="copy-output-btn"[^>]+data-copy-target="{output_id}"[^>]+disabled',
                )
        for export_id in ("btn-export-json", "btn-export-csv"):
            tag, attributes = self.parser.elements_by_id[export_id]
            self.assertEqual(tag, "button")
            self.assertIn("disabled", attributes)
        self.assertIn("navigator.clipboard.writeText", self.javascript)
        self.assertIn("function setResultActionsEnabled(enabled)", self.javascript)

    def test_parametric_sweep_is_batched_cancellable_and_accessible(self):
        container_tag, container = self.parser.elements_by_id["sweep-chart-container"]
        loading_tag, loading = self.parser.elements_by_id["sweep-loading"]
        progress_tag, progress = self.parser.elements_by_id["sweep-progress"]
        run_tag, run_button = self.parser.elements_by_id["btn-run-sweep"]
        cancel_tag, cancel_button = self.parser.elements_by_id["btn-cancel-sweep"]

        self.assertEqual(container_tag, "div")
        self.assertEqual(container["aria-busy"], "false")
        self.assertEqual(loading_tag, "div")
        self.assertEqual(loading["role"], "status")
        self.assertEqual(loading["aria-live"], "polite")
        self.assertIn("hidden", loading)
        self.assertEqual(progress_tag, "progress")
        self.assertEqual(progress["max"], "77")
        self.assertEqual(run_tag, "button")
        self.assertIn("disabled", run_button)
        self.assertEqual(cancel_tag, "button")
        self.assertIn("hidden", cancel_button)
        self.assertIn("const SWEEP_CHUNK_SIZE = 7", self.javascript)
        self.assertIn("sweepController.abort()", self.javascript)
        self.assertIn("requests.slice(offset, offset + SWEEP_CHUNK_SIZE)", self.javascript)
        self.assertIn("const batchResults = await simulateBatch(batch, shared, sweepController.signal)", self.javascript)
        self.assertIn("function renderSweepTable(", self.javascript)
        self.assertIn('id="sweep-data-caption"', self.html)
        self.assertIn(".sweep-spinner", self.styles)

    def test_sweep_inherits_current_size_and_losses_without_hidden_overrides(self):
        self.assertIn("systemCapacityKw: currentParams.systemCapacityKw", self.javascript)
        self.assertIn("losses: currentParams.losses", self.javascript)
        self.assertNotIn("systemCapacityKw: 6", self.javascript)
        self.assertNotIn("losses: 11", self.javascript)
        self.assertIn('id="sweep-assumption-size"', self.html)
        self.assertIn('id="sweep-assumption-losses"', self.html)

    def test_csv_columns_match_the_visible_monthly_table(self):
        expected_headers = (
            "'Month'",
            "'Solar radiation (kWh/m²/day)'",
            "'Plane of array (kWh/m²)'",
            "'DC energy (kWh)'",
            "'AC energy (kWh)'",
        )
        self.assertIn("function createMonthlyCsv(res)", self.javascript)
        for header in expected_headers:
            self.assertIn(header, self.javascript)
        self.assertIn("monthlyPoa[month]", self.javascript)
        self.assertIn("res.monthlyDc[month]", self.javascript)
        self.assertIn("res.monthlyAc[month]", self.javascript)
        csv_function = self.javascript.split("function createMonthlyCsv(res)", 1)[1].split("// Export CSV", 1)[0]
        self.assertNotIn("kwhPerKw", csv_function)

    def test_workspace_tabs_expose_keyboard_and_selected_state(self):
        simulator_tag, simulator = self.parser.elements_by_id["tab-simulator"]
        parametric_tag, parametric = self.parser.elements_by_id["tab-parametric"]
        self.assertEqual(simulator_tag, "button")
        self.assertEqual(simulator["role"], "tab")
        self.assertEqual(simulator["aria-selected"], "true")
        self.assertEqual(parametric_tag, "button")
        self.assertEqual(parametric["role"], "tab")
        self.assertEqual(parametric["aria-selected"], "false")
        self.assertIn("event.key === 'ArrowRight'", self.javascript)
        self.assertIn("candidate.setAttribute('aria-selected'", self.javascript)

    def test_mobile_workflow_keeps_a_live_result_bridge_after_quick_inputs(self):
        self.assertIn('class="parameter-group quick-estimate-group"', self.html)
        self.assertIn('class="mobile-estimate-bridge"', self.html)
        self.assertLess(self.html.index('id="input-location"'), self.html.index('id="mobile-kpi-ac"'))
        self.assertLess(self.html.index('id="mobile-kpi-ac"'), self.html.index('id="slider-losses"'))
        self.assertIn("@media (max-width: 760px)", self.styles)
        self.assertIn("min-height: 44px", self.styles)

    def test_failed_recalculation_clears_stale_outputs(self):
        self.assertIn("function clearDisplayedResults()", self.javascript)
        self.assertIn("resultsArea.classList.add('is-updating')", self.javascript)
        self.assertGreaterEqual(self.javascript.count("clearDisplayedResults();"), 2)
        self.assertIn(".results-area.is-updating", self.styles)

    def test_datasheet_reader_is_a_third_workspace_tab(self):
        tag, attributes = self.parser.elements_by_id["tab-datasheet"]
        self.assertEqual(tag, "button")
        self.assertEqual(attributes["role"], "tab")
        self.assertEqual(attributes["aria-controls"], "datasheet-tab")
        self.assertEqual(attributes["aria-selected"], "false")
        self.assertEqual(attributes["tabindex"], "-1")

        panel_tag, panel = self.parser.elements_by_id["datasheet-tab"]
        self.assertEqual(panel_tag, "div")
        self.assertEqual(panel["role"], "tabpanel")
        self.assertEqual(panel["aria-labelledby"], "tab-datasheet")
        self.assertIn("hidden", panel)

        # The reader sits next to Parametric Studio in the tab strip.
        self.assertLess(self.html.index('id="tab-parametric"'), self.html.index('id="tab-datasheet"'))

    def test_datasheet_pdfs_stay_in_the_browser_and_use_no_api_quota(self):
        self.assertIn("await file.arrayBuffer()", self.datasheet)
        self.assertNotIn("FormData", self.datasheet)
        for forbidden in ("fetch(", "XMLHttpRequest", "pvwattsClient", "developer.nlr.gov"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.datasheet)
        self.assertIn("Nothing is uploaded", self.html)

    def test_pdf_reader_is_loaded_lazily_from_a_pinned_version(self):
        self.assertIn("const PDFJS_VERSION = '4.7.76'", self.datasheet)
        self.assertIn("pdfjs-dist@${PDFJS_VERSION}", self.datasheet)
        self.assertIn("import(/* webpackIgnore: true */", self.datasheet)
        # The library must not be pulled in on first paint.
        self.assertNotIn("pdfjs-dist", self.html)

    def test_every_extracted_value_is_editable_and_names_its_source_row(self):
        self.assertIn("input.className = 'ds-input'", self.datasheet)
        self.assertIn("input.addEventListener('input'", self.datasheet)
        self.assertIn("datasheetState.edited.add(row.key)", self.datasheet)
        self.assertIn("function sourceFor(", self.datasheet)
        self.assertIn("Not found \u2014 read it from the page", self.datasheet)
        self.assertIn("ds-row-missing", self.styles)
        # Calculations must follow the edited table, never the raw extraction.
        self.assertIn("DatasheetParser.computeMetrics(datasheetState.values)", self.datasheet)

    def test_the_source_page_is_rendered_beside_the_values_for_checking(self):
        self.assertIn('id="ds-canvas"', self.html)
        self.assertIn("Check every value against this page", self.html)
        self.assertIn("page.render({ canvasContext: context, viewport })", self.datasheet)
        self.assertIn('class="sim-grid ds-workspace"', self.html)
        self.assertIn("grid-template-columns: 380px 1fr", self.styles)
        self.assertLess(self.html.index('class="card ds-controls"'), self.html.index('id="ds-results"'))

    def test_implausible_values_are_rejected_rather_than_reported(self):
        self.assertIn("function inRange(field, value)", self.datasheet_parser)
        self.assertIn("const accepted = candidates.filter(candidate => candidate.ok)", self.datasheet_parser)
        self.assertIn("function crossChecks(values)", self.datasheet_parser)
        for label in ("Pmax vs Vmp x Imp (STC)", "Efficiency: datasheet vs Pmax / area"):
            with self.subTest(label=label):
                self.assertIn(label, self.datasheet_parser)

    def test_the_calculations_are_usable_without_a_pdf(self):
        self.assertIn('id="ds-manual"', self.html)
        self.assertIn("function startManualEntry()", self.datasheet)
        self.assertIn("dsElement('ds-viewer').hidden = true", self.datasheet)
        # Manual entry retains the same inputs-to-results layout as a PDF.
        self.assertIn("setDatasheetWorkspace(true)", self.datasheet)
        self.assertIn("dsElement('ds-derived').hidden = !active", self.datasheet)

    def test_datasheet_overview_exports_and_navigation_are_accessible(self):
        for key in ("power", "efficiency", "area", "fill-factor"):
            self.assertIn(f'ds-kpi-{key}', self.parser.elements_by_id)
        for key in ("ds-export-csv", "ds-export-json", "ds-clear"):
            tag, attrs = self.parser.elements_by_id[key]
            self.assertEqual(tag, "button")
            self.assertIn("disabled", attrs)
        self.assertLess(self.html.index('id="ds-export-csv"'), self.html.index('id="ds-viewer"'))
        self.assertIn('href="#ds-results-heading"', self.html)
        self.assertIn("input.closest('.ds-spec-group').open = true", self.datasheet)
        self.assertIn('id="ds-zoom-reset"', self.html)

    def test_datasheet_groups_preserve_native_disclosures_and_live_provenance(self):
        self.assertIn("group = document.createElement('details')", self.datasheet)
        self.assertIn("caption.textContent = `${row.group}", self.datasheet)
        self.assertIn("text.textContent = sourceText", self.datasheet)
        self.assertIn("updateAnnotations();", self.datasheet)
        self.assertIn("updateDatasheetSummary(metrics)", self.datasheet)
        self.assertIn("const hint = isFilled(currentValue) ? alternateUnit(row, currentValue) : null", self.datasheet)
        self.assertNotIn("-webkit-line-clamp", self.styles)
        self.assertIn("input.setAttribute('aria-describedby', source.id)", self.datasheet)

    def test_clearing_or_replacing_a_datasheet_invalidates_pending_loads(self):
        self.assertIn("loadSequence: 0", self.datasheet)
        self.assertIn("const sequence = ++datasheetState.loadSequence", self.datasheet)
        self.assertIn("datasheetState.loadSequence += 1", self.datasheet)
        self.assertIn("datasheetState.renderSequence += 1", self.datasheet)
        self.assertIn("datasheetState.zoom = 1", self.datasheet)
        self.assertIn("new ResizeObserver", self.datasheet)

    def test_overlapping_page_renders_cannot_show_the_wrong_page(self):
        # The whole workflow is "check this value against the page shown", so a
        # slower earlier render must never paint over a newer one.
        self.assertIn("renderSequence: 0", self.datasheet)
        self.assertIn("const sequence = ++datasheetState.renderSequence", self.datasheet)
        self.assertIn("const current = () => sequence === datasheetState.renderSequence", self.datasheet)
        self.assertIn("if (!current()) return;", self.datasheet)

    def test_datasheet_scripts_load_after_their_dependencies(self):
        self.assertLess(self.html.index('src="datasheet_parser.js"'), self.html.index('src="datasheet.js"'))
        self.assertIn('<script src="datasheet_parser.js"></script>', self.html)
        self.assertIn('<script src="datasheet.js"></script>', self.html)

    def test_footer_news_button_opens_the_news_workspace(self):
        self.assertIn('class="footer-links"', self.html)
        self.assertIn('id="footer-news"', self.html)
        self.assertLess(
            self.html.index('id="footer-news"'),
            self.html.index('class="footer-github"'),
            "the news button sits next to the GitHub link",
        )
        button_tag, button = self.parser.elements_by_id["footer-news"]
        self.assertEqual(button_tag, "button")
        self.assertEqual(button["aria-controls"], "news-tab")

        tab_tag, tab = self.parser.elements_by_id["tab-news"]
        self.assertEqual(tab_tag, "button")
        self.assertEqual(tab["role"], "tab")
        self.assertEqual(tab["aria-controls"], "news-tab")
        self.assertEqual(tab["aria-selected"], "false")
        self.assertEqual(tab["tabindex"], "-1")
        self.assertLess(self.html.index('id="tab-datasheet"'), self.html.index('id="tab-news"'))

        panel_tag, panel = self.parser.elements_by_id["news-tab"]
        self.assertEqual(panel_tag, "div")
        self.assertEqual(panel["role"], "tabpanel")
        self.assertEqual(panel["aria-labelledby"], "tab-news")
        self.assertIn("hidden", panel)

    def test_every_feed_is_filterable_in_the_news_view(self):
        for element_id in (
            "news-filter-category",
            "news-filter-source",
            "news-search",
            "news-reset",
            "news-list",
            "news-status",
        ):
            with self.subTest(element_id=element_id):
                self.assertIn(element_id, self.parser.elements_by_id)
        self.assertIn('aria-label="Filter by topic"', self.html)
        self.assertIn('aria-label="Filter by source"', self.html)
        # Categories and sources are built from the payload, so a newly added
        # publisher appears in the filter row without any markup change.
        self.assertIn("data.categories.map", self.news)
        self.assertIn("data.sources.map", self.news)
        self.assertIn("createNewsChip(entry.label, entry.value", self.news)
        self.assertIn("chip.dataset.value = value", self.news)
        self.assertIn("chip.setAttribute('aria-pressed'", self.news)
        self.assertIn("newsState.query", self.news)

    def test_news_filter_rows_collapse_behind_a_disclosure(self):
        # The chip rows start closed so the headlines sit near the top of the
        # tab; each summary still names the active choice.
        self.assertEqual(self.html.count('<details class="news-filter-group">'), 2)
        for element_id in ("news-filter-category-current", "news-filter-source-current"):
            with self.subTest(element_id=element_id):
                self.assertIn(element_id, self.parser.elements_by_id)
        self.assertIn("newsElement(`${containerId}-current`).textContent", self.news)

    def test_news_view_reads_one_static_file_and_never_contacts_a_publisher(self):
        self.assertIn("const NEWS_FEED_URL = 'news.json'", self.news)
        self.assertIn("fetch(NEWS_FEED_URL", self.news)
        for forbidden in ("localStorage", "sessionStorage", "XMLHttpRequest"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.news)
        # Outbound headline links are the only way off the site.
        self.assertIn("headline.rel = 'noopener noreferrer'", self.news)
        self.assertIn('src="news.js"', self.html)
        self.assertLess(self.html.index('src="app.js"'), self.html.index('src="news.js"'))
        self.assertIn(".news-item", self.styles)
        self.assertIn(".news-chip", self.styles)

    def test_published_news_feed_satisfies_the_view_contract(self):
        """The deployed list is generated, so its shape is asserted, not reviewed."""
        feed = ROOT / "static" / "news.json"
        self.assertTrue(feed.exists(), "static/news.json must be generated before the site is served")
        payload = json.loads(feed.read_text(encoding="utf-8"))

        self.assertEqual(payload["refreshHours"], 6)
        self.assertEqual(payload["categories"], ["Industry", "Research", "Policy", "Video"])
        self.assertGreater(len(payload["items"]), 0)

        source_ids = {source["id"] for source in payload["sources"]}
        self.assertEqual(len(source_ids), len(payload["sources"]), "source ids are unique")
        for entry in payload["unavailable"]:
            with self.subTest(unavailable=entry["id"]):
                self.assertIn(entry["id"], source_ids, "an unavailable feed is still a configured publisher")
        for source in payload["sources"]:
            with self.subTest(source=source["id"]):
                self.assertTrue(source["name"])
                self.assertIn(source["category"], payload["categories"])
                self.assertRegex(source["homepage"], r"^https://")

        for item in payload["items"]:
            with self.subTest(item=item["url"]):
                self.assertIn(item["source"], source_ids)
                self.assertIn(item["category"], payload["categories"])
                self.assertRegex(item["url"], r"^https://")
                self.assertRegex(item["published"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
                self.assertLessEqual(len(item["summary"]), 201)
                self.assertTrue(item["title"])
                # The view renders plain text, so no headline or summary may
                # carry markup or an undecoded entity into the list.
                for field in ("title", "summary"):
                    self.assertNotRegex(
                        item[field],
                        r"<[a-zA-Z/!]|&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);",
                        f"{field} still contains feed markup: {item[field][:120]!r}",
                    )

    def test_the_news_list_is_rebuilt_on_a_forgiving_schedule(self):
        workflow = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        self.assertIn("cron: '17 */6 * * *'", workflow)
        self.assertIn("node tools/fetch_news.mjs", workflow)
        fetcher = (ROOT / "tools" / "fetch_news.mjs").read_text(encoding="utf-8")
        self.assertIn("PVWattsStudioNews/1.0 (+https://github.com/jacob-card-howe/pvwatts-studio)", fetcher)
        self.assertIn("REQUEST_TIMEOUT_MS = 15000", fetcher)
        self.assertEqual(fetcher.count("await fetch("), 1, "each publisher is requested once, one after another")
        self.assertNotIn("Promise.all", fetcher, "no request burst")

if __name__ == "__main__":
    unittest.main()
