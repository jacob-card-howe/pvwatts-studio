"""HTTP-level tests for the local PVWatts Studio server."""

import json
import threading
import unittest
import urllib.error
import urllib.request

import server


class FakePVWattsClient:
    def __init__(self):
        self.calls = []
        self.api_keys = []

    def simulate(self, params, *, api_key=None):
        self.calls.append(params)
        self.api_keys.append(api_key)
        return {
            "annualAcKwh": 12024.6,
            "parameters": params,
            "model": "Official PVWatts v8 (SSC pvwattsv8)",
        }


class TestPVWattsHTTPServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_client = server.pvwatts_client
        cls.fake_client = FakePVWattsClient()
        server.pvwatts_client = cls.fake_client
        cls.httpd = server.ThreadedHTTPServer(("127.0.0.1", 0), server.PVWattsHTTPHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        server.pvwatts_client = cls.original_client

    def post_json(self, path, payload, *, headers=None):
        request_headers = {"Content-Type": "application/json"}
        request_headers.update(headers or {})
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers=request_headers,
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_simulate_endpoint_passes_json_to_v8_client(self):
        params = {
            "systemCapacityKw": 10,
            "losses": 14,
            "tilt": 20,
            "azimuth": 180,
            "lat": 47.48,
            "lon": -122.2,
        }
        status, payload = self.post_json("/api/simulate", params)
        self.assertEqual(status, 200)
        self.assertEqual(payload["annualAcKwh"], 12024.6)
        self.assertEqual(self.fake_client.calls[-1], params)
        self.assertIsNone(self.fake_client.api_keys[-1])

    def test_simulate_endpoint_forwards_browser_api_key(self):
        status, _payload = self.post_json(
            "/api/simulate",
            {"systemCapacityKw": 4, "lat": 47.69, "lon": -117.06},
            headers={"X-NLR-API-Key": "consumer-key"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.fake_client.api_keys[-1], "consumer-key")
        self.assertNotIn("consumer-key", json.dumps(self.fake_client.calls[-1]))

    def test_batch_endpoint_merges_shared_location(self):
        status, payload = self.post_json(
            "/api/simulate-batch",
            {
                "shared": {"lat": 47.48, "lon": -122.2},
                "requests": [
                    {"systemCapacityKw": 4, "tilt": 20},
                    {"systemCapacityKw": 6, "tilt": 35},
                ],
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["results"]), 2)
        self.assertEqual(self.fake_client.calls[-2]["lat"], 47.48)
        self.assertEqual(self.fake_client.calls[-1]["systemCapacityKw"], 6)

    def test_coordinate_location_search_does_not_need_network(self):
        with urllib.request.urlopen(
            self.base_url + "/api/locations?q=47.4799%2C%20-122.2034", timeout=5
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual(payload["results"][0]["type"], "coordinates")
        self.assertEqual(payload["results"][0]["lon"], -122.2034)

    def test_invalid_json_returns_json_error(self):
        request = urllib.request.Request(
            self.base_url + "/api/simulate",
            data=b"not-json",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=5)
        self.assertEqual(caught.exception.code, 400)
        try:
            payload = json.loads(caught.exception.read().decode("utf-8"))
        finally:
            caught.exception.close()
        self.assertEqual(payload["code"], "invalid_request")


if __name__ == "__main__":
    unittest.main()
