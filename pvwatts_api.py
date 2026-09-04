"""Clients and adapters for the official PVWatts v8 and location APIs.

The production estimate is intentionally delegated to the official NLR
PVWatts v8 service. That service runs the same ``pvwattsv8`` SSC module and
current NSRDB TMY data as the public PVWatts calculator. Keeping a hand-written
v5-era approximation here was the reason this project disagreed with PVWatts.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from typing import Any, Callable

PVWATTS_API_URL = os.environ.get(
    "PVWATTS_API_URL", "https://developer.nlr.gov/api/pvwatts/v8.json"
)
GEOCODER_URL = os.environ.get(
    "PVWATTS_GEOCODER_URL", "https://nominatim.openstreetmap.org/search"
)
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
COORDINATE_QUERY = re.compile(
    r"^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[, ]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$"
)
US_STATE_QUERY = re.compile(
    r"(?:,\s*|\s+)([A-Za-z]{2})(?:\s*,?\s*(?:US|USA|United States))?\s*$",
    re.IGNORECASE,
)
US_STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC",
}


class ExternalServiceError(RuntimeError):
    """An upstream geocoding or PVWatts service returned an error."""

    def __init__(self, message: str, *, status: int = 502, code: str = "upstream_error"):
        super().__init__(message)
        self.status = status
        self.code = code


def _finite_number(value: Any, name: str, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number") from exc
    if not math.isfinite(number) or number < minimum or number > maximum:
        raise ValueError(f"{name} must be between {minimum:g} and {maximum:g}")
    return number


def _exclusive_fraction(value: Any, name: str) -> float:
    number = _finite_number(value, name, 0, 1)
    if number <= 0 or number >= 1:
        raise ValueError(f"{name} must be greater than 0 and less than 1")
    return number


def _binary_flag(value: Any, name: str) -> int:
    if isinstance(value, bool):
        return int(value)
    number = _finite_number(value, name, 0, 1)
    if number not in (0, 1):
        raise ValueError(f"{name} must be 0 or 1")
    return int(number)


def _monthly_values(value: Any, name: str) -> tuple[float, ...]:
    if isinstance(value, str):
        value = value.split("|")
    if not isinstance(value, (list, tuple)) or len(value) != 12:
        raise ValueError(f"{name} must contain exactly 12 monthly values")
    return tuple(
        _finite_number(month_value, f"{name}[{month_index}]", 0, 100)
        for month_index, month_value in enumerate(value)
    )


def validate_simulation_params(params: dict[str, Any]) -> dict[str, Any]:
    """Validate browser parameters and return canonical PVWatts values."""

    module_number = _finite_number(params.get("moduleType", 0), "moduleType", 0, 2)
    array_number = _finite_number(params.get("arrayType", 0), "arrayType", 0, 4)
    module_type = int(module_number)
    array_type = int(array_number)
    if module_type != module_number:
        raise ValueError("moduleType must be an integer")
    if array_type != array_number:
        raise ValueError("arrayType must be an integer")

    inv_eff = _finite_number(params.get("invEff", 96.0), "invEff", 0, 100)
    # Backwards compatibility with the old browser engine's fractional value.
    if inv_eff <= 1.0:
        inv_eff *= 100.0
    if inv_eff < 90.0 or inv_eff > 99.5:
        raise ValueError("invEff must be between 90 and 99.5 percent")

    use_wf_albedo = _binary_flag(
        params.get("useWeatherFileAlbedo", True), "useWeatherFileAlbedo"
    )
    albedo = None
    if not use_wf_albedo:
        albedo = _exclusive_fraction(params.get("albedo"), "albedo")

    return {
        "system_capacity": _finite_number(
            params.get("systemCapacityKw", 4.0), "systemCapacityKw", 0.05, 500000
        ),
        "module_type": module_type,
        "array_type": array_type,
        "losses": _finite_number(params.get("losses", 14.08), "losses", -5, 99),
        "tilt": _finite_number(params.get("tilt", 20.0), "tilt", 0, 90),
        # The API requires azimuth to be less than 360. Treat 360 as north/0.
        "azimuth": _finite_number(params.get("azimuth", 180.0), "azimuth", 0, 360) % 360,
        "dc_ac_ratio": _finite_number(params.get("dcAcRatio", 1.2), "dcAcRatio", 0.5, 3),
        "inv_eff": inv_eff,
        "gcr": _finite_number(
            params.get("groundCoverageRatio", 0.4), "groundCoverageRatio", 0.01, 0.99
        ),
        "use_wf_albedo": use_wf_albedo,
        "albedo": albedo,
        "bifaciality": _finite_number(params.get("bifaciality", 0), "bifaciality", 0, 1),
        "soiling": _monthly_values(
            params.get("monthlyIrradianceLosses", [0] * 12), "monthlyIrradianceLosses"
        ),
        "lat": _finite_number(params.get("lat"), "lat", -90, 90),
        "lon": _finite_number(params.get("lon"), "lon", -180, 180),
    }


def normalize_pvwatts_response(payload: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    """Map the official snake_case response to the browser's stable shape."""

    top_level_error = payload.get("error")
    if top_level_error:
        if isinstance(top_level_error, dict):
            message = top_level_error.get("message") or str(top_level_error)
            code = top_level_error.get("code", "pvwatts_error")
        else:
            message = str(top_level_error)
            code = "pvwatts_error"
        status = 429 if str(code).upper() in {"OVER_RATE_LIMIT", "RATE_LIMIT"} else 502
        if status == 429:
            message = (
                "PVWatts rate limit reached. Enter your free NLR developer key in the app "
                "or set NLR_API_KEY instead of using the shared DEMO_KEY."
            )
        raise ExternalServiceError(message, status=status, code=str(code))

    errors = payload.get("errors") or []
    if errors:
        raise ExternalServiceError("; ".join(str(error) for error in errors), status=422, code="pvwatts_error")

    outputs = payload.get("outputs") or {}
    required = ("ac_annual", "solrad_annual", "capacity_factor", "ac_monthly", "dc_monthly", "solrad_monthly")
    missing = [name for name in required if name not in outputs]
    if missing:
        raise ExternalServiceError(
            f"PVWatts returned an incomplete response (missing {', '.join(missing)})",
            code="invalid_pvwatts_response",
        )

    monthly_fields = ("ac_monthly", "dc_monthly", "solrad_monthly")
    invalid_monthly = [name for name in monthly_fields if not isinstance(outputs[name], list) or len(outputs[name]) != 12]
    if invalid_monthly:
        raise ExternalServiceError(
            f"PVWatts returned invalid monthly data for {', '.join(invalid_monthly)}",
            code="invalid_pvwatts_response",
        )

    capacity = float(inputs["system_capacity"])
    annual_ac = float(outputs["ac_annual"])
    poa_monthly = [float(value) for value in outputs.get("poa_monthly", [])]
    if poa_monthly and len(poa_monthly) != 12:
        raise ExternalServiceError(
            "PVWatts returned invalid monthly plane-of-array data",
            code="invalid_pvwatts_response",
        )
    return {
        "annualAcKwh": annual_ac,
        "annualSolrad": float(outputs["solrad_annual"]),
        "capacityFactor": float(outputs["capacity_factor"]),
        "kwhPerKw": annual_ac / capacity,
        "monthlyAc": [float(value) for value in outputs["ac_monthly"]],
        "monthlyDc": [float(value) for value in outputs["dc_monthly"]],
        "monthlySolrad": [float(value) for value in outputs["solrad_monthly"]],
        "monthlyPoa": poa_monthly,
        "monthNames": MONTH_NAMES,
        "stationInfo": payload.get("station_info") or {},
        "warnings": payload.get("warnings") or [],
        "version": payload.get("version", "8"),
        "model": "Official PVWatts v8 (SSC pvwattsv8)",
        "dataset": "NSRDB",
        "parameters": {
            "systemCapacityKw": capacity,
            "moduleType": int(inputs["module_type"]),
            "arrayType": int(inputs["array_type"]),
            "losses": float(inputs["losses"]),
            "tilt": float(inputs["tilt"]),
            "azimuth": float(inputs["azimuth"]),
            "dcAcRatio": float(inputs["dc_ac_ratio"]),
            "invEff": float(inputs["inv_eff"]),
            "groundCoverageRatio": float(inputs["gcr"]),
            "useWeatherFileAlbedo": bool(inputs["use_wf_albedo"]),
            "albedo": None if inputs["albedo"] is None else float(inputs["albedo"]),
            "bifaciality": float(inputs["bifaciality"]),
            "monthlyIrradianceLosses": [float(value) for value in inputs["soiling"]],
            "lat": float(inputs["lat"]),
            "lon": float(inputs["lon"]),
        },
    }


class PVWattsV8Client:
    """Small, thread-safe client for the canonical PVWatts v8 API."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        api_url: str = PVWATTS_API_URL,
        timeout: float = 30.0,
        opener: Callable[..., Any] | None = None,
        cache_size: int = 512,
    ):
        self.api_key = api_key or os.environ.get("NLR_API_KEY") or os.environ.get("NREL_API_KEY") or "DEMO_KEY"
        self.api_url = api_url
        self.timeout = timeout
        self.opener = opener or urllib.request.urlopen
        self.cache_size = cache_size
        self._cache: OrderedDict[tuple[tuple[str, Any], ...], dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def simulate(
        self, params: dict[str, Any], *, api_key: str | None = None
    ) -> dict[str, Any]:
        inputs = validate_simulation_params(params)
        request_api_key = api_key.strip() if api_key and api_key.strip() else self.api_key
        cache_key = tuple(sorted(inputs.items()))
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached is not None:
                self._cache.move_to_end(cache_key)
                return cached

        query: dict[str, str | float | int] = {
            "api_key": request_api_key,
            "system_capacity": inputs["system_capacity"],
            "module_type": inputs["module_type"],
            "array_type": inputs["array_type"],
            "losses": inputs["losses"],
            "tilt": inputs["tilt"],
            "azimuth": inputs["azimuth"],
            "dc_ac_ratio": inputs["dc_ac_ratio"],
            "inv_eff": inputs["inv_eff"],
            "gcr": inputs["gcr"],
            "use_wf_albedo": inputs["use_wf_albedo"],
            "bifaciality": inputs["bifaciality"],
            # The API requires 12 monthly values in one pipe-delimited parameter.
            "soiling": "|".join(f"{value:g}" for value in inputs["soiling"]),
            "lat": inputs["lat"],
            "lon": inputs["lon"],
            "dataset": "nsrdb",
            "radius": 0,
            "timeframe": "monthly",
        }
        if inputs["albedo"] is not None:
            query["albedo"] = inputs["albedo"]
        url = f"{self.api_url}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": "PVWatts-Studio/2.0"},
        )
        payload = self._request_json(request, service="PVWatts")
        result = normalize_pvwatts_response(payload, inputs)

        with self._lock:
            self._cache[cache_key] = result
            self._cache.move_to_end(cache_key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
        return result

    def _request_json(self, request: urllib.request.Request, *, service: str) -> Any:
        try:
            with self.opener(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode("utf-8"))
                error = payload.get("error", payload)
                message = error.get("message") if isinstance(error, dict) else str(error)
                code = error.get("code", "upstream_http_error") if isinstance(error, dict) else "upstream_http_error"
            except Exception:
                message = exc.reason or f"HTTP {exc.code}"
                code = "upstream_http_error"
            if exc.code == 429:
                message = (
                    f"{service} rate limit reached. Enter your free NLR developer key in the app "
                    "or set NLR_API_KEY instead of using the shared DEMO_KEY."
                )
                code = "rate_limit"
            raise ExternalServiceError(str(message), status=exc.code, code=str(code)) from exc
        except urllib.error.URLError as exc:
            raise ExternalServiceError(f"Could not reach {service}: {exc.reason}") from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ExternalServiceError(f"{service} returned invalid JSON", code="invalid_json") from exc


def search_locations(
    query: str,
    *,
    timeout: float = 15.0,
    opener: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    """Resolve a user-entered place/address, or accept a latitude/longitude pair.

    Searches are explicit (button/Enter), rather than request-on-every-keystroke,
    to comply with the public Nominatim usage policy.
    """

    query = (query or "").strip()
    if len(query) < 2:
        raise ValueError("Enter at least two characters or a latitude, longitude pair")
    if len(query) > 200:
        raise ValueError("Location query is too long")

    coordinate_match = COORDINATE_QUERY.match(query)
    if coordinate_match:
        lat = _finite_number(coordinate_match.group(1), "latitude", -90, 90)
        lon = _finite_number(coordinate_match.group(2), "longitude", -180, 180)
        return [{"name": f"{lat:.6f}, {lon:.6f}", "lat": lat, "lon": lon, "type": "coordinates"}]

    search_params: dict[str, str | int] = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": 10,
    }
    state_match = US_STATE_QUERY.search(query)
    requested_state = state_match.group(1).upper() if state_match else None
    if requested_state in US_STATE_CODES:
        # Nominatim otherwise interprets "WA" as Western Australia and can
        # bury the intended Washington result (as happened for Reston, WA).
        search_params["countrycodes"] = "us"

    params = urllib.parse.urlencode(search_params)
    request = urllib.request.Request(
        f"{GEOCODER_URL}?{params}",
        headers={
            "Accept": "application/json",
            "User-Agent": "PVWatts-Studio/2.0 (local educational calculator)",
        },
    )
    open_url = opener or urllib.request.urlopen
    try:
        with open_url(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ExternalServiceError(f"Location search failed (HTTP {exc.code})", status=exc.code, code="geocoder_error") from exc
    except urllib.error.URLError as exc:
        raise ExternalServiceError(f"Could not reach the location search service: {exc.reason}", code="geocoder_unavailable") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ExternalServiceError("Location search returned invalid JSON", code="invalid_geocoder_response") from exc

    if not isinstance(payload, list):
        raise ExternalServiceError(
            "Location search returned an unexpected response",
            code="invalid_geocoder_response",
        )

    ranked_results = []
    for index, item in enumerate(payload[:10]):
        try:
            lat = _finite_number(item.get("lat"), "latitude", -90, 90)
            lon = _finite_number(item.get("lon"), "longitude", -180, 180)
        except ValueError:
            continue
        address = item.get("address") if isinstance(item.get("address"), dict) else {}
        iso_region = str(address.get("ISO3166-2-lvl4", "")).upper()
        state_priority = 0 if requested_state and iso_region == f"US-{requested_state}" else 1
        ranked_results.append(
            (
                state_priority,
                index,
                {
                    "name": item.get("display_name") or item.get("name") or f"{lat:.6f}, {lon:.6f}",
                    "lat": lat,
                    "lon": lon,
                    "type": item.get("type", "place"),
                },
            )
        )
    ranked_results.sort(key=lambda candidate: (candidate[0], candidate[1]))
    return [candidate[2] for candidate in ranked_results[:5]]
