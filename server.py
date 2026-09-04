"""PVWatts Studio local web server.

The browser UI is served locally, while production estimates come from the
official PVWatts v8 API. That API runs NLR's ``pvwattsv8`` SSC module against
the current NSRDB TMY dataset, which keeps this app aligned with the public
PVWatts Calculator instead of relying on the former v5-era approximation.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import socketserver
import sys
import urllib.parse
from typing import Any

from pvwatts_api import ExternalServiceError, PVWattsV8Client, search_locations

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
MAX_BODY_BYTES = 1_000_000
MAX_BATCH_SIZE = 100
MAX_API_KEY_LENGTH = 256
API_KEY_HEADER = "X-NLR-API-Key"

pvwatts_client = PVWattsV8Client()


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class PVWattsHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/locations":
            query = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
            self._run_json_endpoint(lambda: {"results": search_locations(query)})
        elif path == "/api/stations":
            # Kept for clients from older revisions. The simulator no longer
            # limits users to this static station list.
            self._run_json_endpoint(self.get_stations)
        else:
            super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            params = self.read_json_body()
        except ValueError as exc:
            self.send_json_response({"error": str(exc), "code": "invalid_request"}, status=400)
            return

        if parsed.path == "/api/simulate":
            self._run_json_endpoint(lambda: self.handle_simulate(params))
        elif parsed.path == "/api/simulate-batch":
            self._run_json_endpoint(lambda: self.handle_simulate_batch(params))
        else:
            self.send_json_response({"error": "Endpoint not found", "code": "not_found"}, status=404)

    def read_json_body(self) -> dict[str, Any]:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if content_length <= 0:
            return {}
        if content_length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("Request body must be valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object")
        return payload

    def get_request_api_key(self) -> str | None:
        api_key = self.headers.get(API_KEY_HEADER, "").strip()
        if not api_key:
            return None
        if len(api_key) > MAX_API_KEY_LENGTH:
            raise ValueError(f"{API_KEY_HEADER} must be at most {MAX_API_KEY_LENGTH} characters")
        if any(ord(character) < 33 or ord(character) > 126 for character in api_key):
            raise ValueError(f"{API_KEY_HEADER} contains invalid characters")
        return api_key

    def handle_simulate(self, payload: dict[str, Any]) -> dict[str, Any]:
        return pvwatts_client.simulate(payload, api_key=self.get_request_api_key())

    def handle_simulate_batch(self, payload: dict[str, Any]) -> dict[str, Any]:
        requests = payload.get("requests")
        if not isinstance(requests, list):
            raise ValueError("requests must be an array")
        if not requests or len(requests) > MAX_BATCH_SIZE:
            raise ValueError(f"requests must contain between 1 and {MAX_BATCH_SIZE} simulations")

        shared = payload.get("shared", {})
        if not isinstance(shared, dict):
            raise ValueError("shared must be an object")

        api_key = self.get_request_api_key()
        results = []
        for request_params in requests:
            if not isinstance(request_params, dict):
                raise ValueError("Each simulation request must be an object")
            results.append(
                pvwatts_client.simulate({**shared, **request_params}, api_key=api_key)
            )
        return {"results": results}

    def _run_json_endpoint(self, callback: Any) -> None:
        try:
            self.send_json_response(callback())
        except ValueError as exc:
            self.send_json_response({"error": str(exc), "code": "invalid_parameters"}, status=400)
        except ExternalServiceError as exc:
            self.send_json_response({"error": str(exc), "code": exc.code}, status=exc.status)
        except Exception as exc:  # Keep API failures JSON-shaped for the browser.
            self.log_error("Unhandled API error: %s", exc)
            self.send_json_response(
                {"error": "The local server could not complete the request", "code": "internal_error"},
                status=500,
            )

    def get_stations(self) -> list[dict[str, Any]]:
        catalog_path = os.path.join(STATIC_DIR, "data", "catalog.json")
        if os.path.exists(catalog_path):
            with open(catalog_path, "r", encoding="utf-8") as catalog_file:
                return json.load(catalog_file)
        return []

    def send_json_response(self, data: Any, *, status: int = 200) -> None:
        payload = json.dumps(data, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")


def run_server() -> None:
    parser = argparse.ArgumentParser(description="PVWatts Studio Local Web Server")
    parser.add_argument(
        "--host",
        default=os.environ.get("HOST", "127.0.0.1"),
        help="Host interface to bind (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=int(os.environ.get("PORT", 8000)),
        help="Port to bind (default: 8000)",
    )
    args = parser.parse_args()

    port = args.port
    httpd = None
    for _attempt in range(20):
        try:
            httpd = ThreadedHTTPServer((args.host, port), PVWattsHTTPHandler)
            break
        except OSError as exc:
            if exc.errno in (98, 48):  # Linux/macOS: address already in use.
                print(f"Notice: Port {port} is in use, trying {port + 1}...")
                port += 1
            else:
                raise

    if httpd is None:
        print(f"Error: Could not bind to any port from {args.port} to {port - 1}", file=sys.stderr)
        sys.exit(1)

    key_source = "NLR_API_KEY/NREL_API_KEY" if os.environ.get("NLR_API_KEY") or os.environ.get("NREL_API_KEY") else "shared DEMO_KEY"
    print("=" * 72)
    display_host = "localhost" if args.host in {"127.0.0.1", "::1"} else args.host
    print("  PVWatts Studio Server is LIVE")
    print(f"  Web UI:       http://{display_host}:{port}")
    print("  Model/data:   Official PVWatts v8 + current NSRDB")
    print(f"  API key:      {key_source}")
    if key_source == "shared DEMO_KEY":
        print("  Tip: Set NLR_API_KEY to avoid the DEMO_KEY rate limit.")
    print("  Press Ctrl+C to stop the server.")
    print("=" * 72)
    sys.stdout.flush()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    run_server()
