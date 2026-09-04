"""Tests for the official PVWatts v8 adapter and dynamic location search."""

import io
import json
import unittest
import urllib.parse

from pvwatts_api import PVWattsV8Client, search_locations, validate_simulation_params


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
        return False


class RecordingOpener:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append((request, timeout))
        return FakeResponse(json.dumps(self.payload).encode("utf-8"))


PVWATTS_RESPONSE = {
    "version": "8.4.0",
    "errors": [],
    "warnings": [],
    "station_info": {
        "lat": 47.69,
        "lon": -117.06,
        "weather_data_source": "NSRDB PSM V3 GOES tmy-2020 3.2.0",
    },
    "outputs": {
        # Live PVWatts v8.5 response for the supplied Reston reference case.
        "ac_annual": 12025.05991620007,
        "solrad_annual": 4.261982402358623,
        "capacity_factor": 13.72723734726033,
        "ac_monthly": [
            395.5167307111715, 558.8709363185872, 860.0738554613732,
            1222.241908915542, 1419.932070857991, 1384.060826606296,
            1741.439111407985, 1535.859357964722, 1225.66337638501,
            844.4462291856071, 458.0055140315348, 378.9499983542308,
        ],
        "dc_monthly": [
            420.3222536160926, 590.7018269842138, 906.1607759403628,
            1283.383006485548, 1490.733878339166, 1454.119308350957,
            1824.703022657512, 1609.826317052463, 1285.579990294269,
            888.7781278357485, 485.688879127793, 402.8985822021388,
        ],
        "poa_monthly": [
            46.79114481597258, 67.68617597529655, 106.6580664472848,
            154.8533150284258, 186.1458486025337, 185.2792404600588,
            237.2746237057607, 206.651653809472, 160.9544914087389,
            106.082090503416, 55.91116477352121, 45.35094080816801,
        ],
        "solrad_monthly": [
            1.50939176825718, 2.417363427689163, 3.440582788622092,
            5.161777167614193, 6.00470479363012, 6.175974682001959,
            7.654020119540669, 6.666182380950709, 5.365149713624629,
            3.422002919465031, 1.863705492450707, 1.462933574457033,
        ],
    },
}


class TestPVWattsV8Client(unittest.TestCase):
    def test_preserves_valid_zero_values(self):
        params = validate_simulation_params(
            {
                "systemCapacityKw": 10,
                "moduleType": 0,
                "arrayType": 0,
                "losses": 0,
                "tilt": 0,
                "azimuth": 0,
                "dcAcRatio": 1.2,
                "invEff": 96,
                "lat": 0,
                "lon": 0,
            }
        )
        self.assertEqual(params["array_type"], 0)
        self.assertEqual(params["losses"], 0)
        self.assertEqual(params["tilt"], 0)
        self.assertEqual(params["azimuth"], 0)
        self.assertEqual(params["lat"], 0)
        self.assertEqual(params["lon"], 0)
        self.assertEqual(params["gcr"], 0.4)
        self.assertEqual(params["use_wf_albedo"], 1)
        self.assertEqual(params["bifaciality"], 0)
        self.assertEqual(params["soiling"], (0.0,) * 12)

    def test_preserves_decimal_continuous_inputs(self):
        params = validate_simulation_params(
            {
                "systemCapacityKw": 6.125,
                "moduleType": 0,
                "arrayType": 0,
                "losses": 14.0875,
                "tilt": 20.125,
                "azimuth": 180.625,
                "dcAcRatio": 1.2375,
                "invEff": 96.125,
                "groundCoverageRatio": 0.4125,
                "lat": 47.6905,
                "lon": -117.0605,
            }
        )
        self.assertEqual(params["system_capacity"], 6.125)
        self.assertEqual(params["losses"], 14.0875)
        self.assertEqual(params["tilt"], 20.125)
        self.assertEqual(params["azimuth"], 180.625)
        self.assertEqual(params["dc_ac_ratio"], 1.2375)
        self.assertEqual(params["inv_eff"], 96.125)
        self.assertEqual(params["gcr"], 0.4125)

    def test_calls_official_v8_with_current_nsrdb_and_normalizes_result(self):
        opener = RecordingOpener(PVWATTS_RESPONSE)
        client = PVWattsV8Client(api_key="test-key", opener=opener)
        request = {
            "systemCapacityKw": 10,
            "moduleType": 0,
            "arrayType": 0,
            "losses": 14.08,
            "tilt": 20,
            "azimuth": 180,
            "dcAcRatio": 1.2,
            "invEff": 96,
            "lat": 47.69,
            "lon": -117.06,
        }

        result = client.simulate(request)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(opener.requests[0][0].full_url).query)
        self.assertEqual(query["api_key"], ["test-key"])
        self.assertEqual(query["dataset"], ["nsrdb"])
        self.assertEqual(query["timeframe"], ["monthly"])
        self.assertEqual(query["gcr"], ["0.4"])
        self.assertEqual(query["use_wf_albedo"], ["1"])
        self.assertEqual(query["bifaciality"], ["0.0"])
        self.assertEqual(query["soiling"], ["0|0|0|0|0|0|0|0|0|0|0|0"])
        self.assertNotIn("albedo", query)
        self.assertEqual(query["system_capacity"], ["10.0"])
        self.assertEqual(query["array_type"], ["0"])
        self.assertEqual(query["losses"], ["14.08"])
        self.assertEqual(query["lat"], ["47.69"])
        self.assertEqual(query["lon"], ["-117.06"])
        self.assertEqual(result["annualAcKwh"], 12025.05991620007)
        self.assertEqual(round(result["annualAcKwh"]), 12025)
        self.assertEqual(result["kwhPerKw"], 1202.505991620007)
        self.assertEqual(result["model"], "Official PVWatts v8 (SSC pvwattsv8)")
        self.assertEqual(result["stationInfo"]["lat"], 47.69)
        self.assertEqual(result["parameters"]["groundCoverageRatio"], 0.4)
        self.assertTrue(result["parameters"]["useWeatherFileAlbedo"])
        self.assertEqual(result["parameters"]["monthlyIrradianceLosses"], [0.0] * 12)

        # Identical calculations use the bounded in-process cache.
        self.assertIs(client.simulate(request), result)
        self.assertEqual(len(opener.requests), 1)

    def test_per_request_api_key_overrides_the_server_default(self):
        opener = RecordingOpener(PVWATTS_RESPONSE)
        client = PVWattsV8Client(api_key="server-key", opener=opener)
        client.simulate(
            {
                "systemCapacityKw": 4,
                "losses": 14.08,
                "tilt": 20,
                "azimuth": 180,
                "lat": 47.69,
                "lon": -117.06,
            },
            api_key="consumer-key",
        )

        query = urllib.parse.parse_qs(
            urllib.parse.urlparse(opener.requests[0][0].full_url).query
        )
        self.assertEqual(query["api_key"], ["consumer-key"])

    def test_passes_advanced_inputs_to_the_official_api(self):
        opener = RecordingOpener(PVWATTS_RESPONSE)
        client = PVWattsV8Client(api_key="test-key", opener=opener)
        losses = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75]
        result = client.simulate(
            {
                "systemCapacityKw": 6.25,
                "moduleType": 1,
                "arrayType": 3,
                "losses": 11.125,
                "tilt": 0.5,
                "azimuth": 180.75,
                "dcAcRatio": 1.225,
                "invEff": 96.125,
                "groundCoverageRatio": 0.375,
                "useWeatherFileAlbedo": False,
                "albedo": 0.275,
                "bifaciality": 0.7125,
                "monthlyIrradianceLosses": losses,
                "lat": 47.69,
                "lon": -117.06,
            }
        )

        query = urllib.parse.parse_qs(urllib.parse.urlparse(opener.requests[0][0].full_url).query)
        self.assertEqual(query["gcr"], ["0.375"])
        self.assertEqual(query["use_wf_albedo"], ["0"])
        self.assertEqual(query["albedo"], ["0.275"])
        self.assertEqual(query["bifaciality"], ["0.7125"])
        self.assertEqual(
            query["soiling"],
            ["0|0.25|0.5|0.75|1|1.25|1.5|1.75|2|2.25|2.5|2.75"],
        )
        self.assertEqual(result["parameters"]["albedo"], 0.275)
        self.assertEqual(result["parameters"]["monthlyIrradianceLosses"], losses)

    def test_rejects_invalid_advanced_inputs(self):
        base = {
            "systemCapacityKw": 4,
            "lat": 47.69,
            "lon": -117.06,
        }
        with self.assertRaisesRegex(ValueError, "groundCoverageRatio"):
            validate_simulation_params({**base, "groundCoverageRatio": 0})
        with self.assertRaisesRegex(ValueError, "albedo"):
            validate_simulation_params(
                {**base, "useWeatherFileAlbedo": False, "albedo": 1}
            )
        with self.assertRaisesRegex(ValueError, "exactly 12"):
            validate_simulation_params({**base, "monthlyIrradianceLosses": [0] * 11})
        with self.assertRaisesRegex(ValueError, r"monthlyIrradianceLosses\[3\]"):
            validate_simulation_params(
                {**base, "monthlyIrradianceLosses": [0, 0, 0, 100.1] + [0] * 8}
            )

    def test_accepts_legacy_fractional_inverter_efficiency(self):
        params = validate_simulation_params(
            {
                "systemCapacityKw": 4,
                "moduleType": 0,
                "arrayType": 1,
                "losses": 14,
                "tilt": 20,
                "azimuth": 180,
                "dcAcRatio": 1.2,
                "invEff": 0.96,
                "lat": 47.48,
                "lon": -122.2,
            }
        )
        self.assertEqual(params["inv_eff"], 96.0)


class TestLocationSearch(unittest.TestCase):
    def test_accepts_coordinates_without_an_external_request(self):
        results = search_locations("47.4799, -122.2034", opener=lambda *_args, **_kwargs: None)
        self.assertEqual(results[0]["lat"], 47.4799)
        self.assertEqual(results[0]["lon"], -122.2034)
        self.assertEqual(results[0]["type"], "coordinates")

    def test_normalizes_place_search_results(self):
        opener = RecordingOpener(
            [
                {
                    "display_name": "Reston Court, Perth, Western Australia",
                    "lat": "-31.8397287",
                    "lon": "115.7793421",
                    "type": "residential",
                    "address": {"ISO3166-2-lvl4": "AU-WA"},
                },
                {
                    "display_name": "East Reston Avenue, Liberty Lake, Washington",
                    "lat": "47.6762117",
                    "lon": "-117.0732038",
                    "type": "residential",
                    "address": {"ISO3166-2-lvl4": "US-WA"},
                },
            ]
        )
        results = search_locations("Reston, WA", opener=opener)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["name"], "East Reston Avenue, Liberty Lake, Washington")
        self.assertAlmostEqual(results[0]["lat"], 47.6762117)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(opener.requests[0][0].full_url).query)
        self.assertEqual(query["q"], ["Reston, WA"])
        self.assertEqual(query["limit"], ["10"])
        self.assertEqual(query["countrycodes"], ["us"])


if __name__ == "__main__":
    unittest.main()
