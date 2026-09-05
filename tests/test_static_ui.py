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
        self.assertIn("const colorList = PARAMETRIC_COLORS;", self.javascript)
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

    def test_api_key_input_precedes_location_and_is_not_persisted(self):
        tag, attributes = self.parser.elements_by_id["input-api-key"]
        self.assertEqual(tag, "input")
        self.assertEqual(attributes["type"], "password")
        self.assertEqual(attributes["autocomplete"], "off")
        self.assertLess(self.html.index('id="input-api-key"'), self.html.index('id="input-location"'))
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

    def test_calculated_kpis_have_copy_buttons(self):
        output_ids = (
            "kpi-ac-annual",
            "kpi-solrad-annual",
            "kpi-capacity-factor",
            "kpi-yield",
        )
        self.assertEqual(self.html.count('class="copy-output-btn"'), len(output_ids))
        for output_id in output_ids:
            with self.subTest(output_id=output_id):
                self.assertIn(f'data-copy-target="{output_id}"', self.html)
        self.assertIn("navigator.clipboard?.writeText", self.javascript)
        self.assertIn("function writeClipboardText(text)", self.javascript)


if __name__ == "__main__":
    unittest.main()
