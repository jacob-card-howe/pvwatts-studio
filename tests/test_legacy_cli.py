"""Regression tests for the optional preprocessed-weather CLI."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from pvwatts_fast import FastPVWatts


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "pvwatts_cli.py"
CATALOG = ROOT / "static" / "data" / "catalog.json"


class TestLegacyCLI(unittest.TestCase):
    def test_every_catalog_station_has_a_loadable_dataset(self):
        stations = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.assertTrue(stations)
        for station in stations:
            with self.subTest(station=station["id"]):
                engine = FastPVWatts(station["id"])
                self.assertEqual(engine.data["id"], station["id"])
                self.assertEqual(engine.n, 8760)

    def test_named_station_works_outside_the_repository_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            completed = subprocess.run(
                [
                    sys.executable,
                    str(CLI),
                    "--location",
                    "seatac_tmy3",
                    "--size",
                    "4",
                    "--json",
                ],
                cwd=temp_dir,
                check=True,
                capture_output=True,
                text=True,
            )

        payload = json.loads(completed.stdout)
        self.assertEqual(payload["location"], "Seattle")
        self.assertGreater(payload["results"]["annual_ac_kwh"], 0)

    def test_legacy_weather_path_selects_a_preprocessed_station_by_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            weather_path = Path(temp_dir) / "seatac_tmy3.epw"
            weather_path.touch()
            completed = subprocess.run(
                [
                    sys.executable,
                    str(CLI),
                    "--weather-file",
                    str(weather_path),
                    "--json",
                ],
                check=True,
                capture_output=True,
                text=True,
            )

        payload = json.loads(completed.stdout)
        self.assertEqual(payload["location"], "Seattle")

    def test_removed_bundled_epw_path_remains_a_supported_alias(self):
        completed = subprocess.run(
            [
                sys.executable,
                str(CLI),
                "--weather-file",
                "weather_data/USA_WA_Seattle-Tacoma.Intl.AP.727930_TMY3.epw",
                "--json",
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

        payload = json.loads(completed.stdout)
        self.assertEqual(payload["location"], "Seattle")


if __name__ == "__main__":
    unittest.main()
