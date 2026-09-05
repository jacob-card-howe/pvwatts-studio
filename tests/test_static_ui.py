"""Static checks for the browser controls and API integration."""

from html.parser import HTMLParser
from pathlib import Path
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

    def test_root_canvas_uses_the_page_background_during_overscroll(self):
        self.assertRegex(
            self.styles,
            r"html\s*\{[^}]*background-color:\s*var\(--bg-primary\)",
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
        self.assertIn("headers['X-NLR-API-Key'] = apiKey", self.javascript)
        self.assertNotIn("localStorage", self.javascript)
        self.assertNotIn("sessionStorage", self.javascript)

    def test_default_location_is_consistent_and_valid(self):
        self.assertIn('value="Renton, WA"', self.html)
        self.assertIn("name: 'Renton, WA'", self.javascript)
        self.assertIn("lat: 47.491", self.javascript)
        self.assertIn("lon: -122.216", self.javascript)
        self.assertNotIn("Reston, WA", self.html)
        self.assertNotIn("Reston, WA", self.javascript)

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
        self.assertEqual(self.html.count('class="copy-output-btn"'), len(output_ids))
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
        self.assertIn("navigator.clipboard?.writeText", self.javascript)
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


if __name__ == "__main__":
    unittest.main()
