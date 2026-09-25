"""Regenerate tests/fixtures/orientation/greensboro_tmy3.json.

The fixture pins the in-browser orientation model (static/orientation_model.js)
to the reference PVWatts v8 engine. It runs NREL-PySAM's Pvwattsv8 module, the
same SAM Simulation Core code the PVWatts API wraps, on the Greensboro, NC TMY3
file that ships with pvlib, and records:

- the hourly weather PVWatts reports back (dn, df, tamb, wspd) and the station
  header, exactly as an hourly API response would carry them;
- the official hourly plane-of-array irradiance at 20 degrees / 180 degrees;
- annual AC energy for several systems and orientations;
- a brute-force 1-degree search around the optimum for one system.

This is a development tool, not part of the site. It needs third-party packages:

    pip install nrel-pysam pvlib
    python tools/make_orientation_fixture.py
"""

import json
import os
from pathlib import Path

import pvlib
import PySAM.Pvwattsv8 as pvwatts

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tests" / "fixtures" / "orientation" / "greensboro_tmy3.json"
WEATHER_FILE = os.path.join(os.path.dirname(pvlib.__file__), "data", "723170TYA.CSV")

SYSTEMS = {
    "standard_rack_4kw": dict(kw=4, module=0, array=0, losses=14.08, dcac=1.2, inv=96, gcr=0.4, soiling=[0] * 12),
    "standard_rack_50kw": dict(kw=50, module=0, array=0, losses=20.72, dcac=1.2, inv=96, gcr=0.4, soiling=[0] * 12),
    "premium_roof_7kw": dict(kw=7.5, module=1, array=1, losses=14, dcac=1.3, inv=97, gcr=0.4,
                             soiling=[2, 2, 1, 0, 0, 0, 0, 0, 0, 1, 2, 3]),
    "thin_film_rack_1mw": dict(kw=1000, module=2, array=0, losses=14, dcac=1.4, inv=98, gcr=0.6, soiling=[0] * 12),
}
ORIENTATIONS = [(0, 180), (10, 180), (20, 180), (30, 180), (40, 180), (60, 180), (90, 180),
                (20, 90), (30, 135), (30, 225), (45, 270), (25, 0), (15, 350), (50, 200)]
SEARCH_SYSTEM = "standard_rack_50kw"
SEARCH_TILTS = range(22, 37)
SEARCH_AZIMUTHS = range(170, 196)


def run(system, tilt, azimuth):
    model = pvwatts.new()
    model.SolarResource.solar_resource_file = WEATHER_FILE
    model.SolarResource.use_wf_albedo = 1
    design = model.SystemDesign
    design.system_capacity = system["kw"]
    design.module_type = system["module"]
    design.array_type = system["array"]
    design.losses = system["losses"]
    design.tilt = tilt
    design.azimuth = azimuth
    design.dc_ac_ratio = system["dcac"]
    design.inv_eff = system["inv"]
    design.gcr = system["gcr"]
    design.bifaciality = 0
    design.soiling = system["soiling"]
    model.execute(0)
    # Copy outputs out before the model is released.
    return model.Outputs.export()


def rounded(values, digits):
    return [round(float(value), digits) for value in values]


def main():
    base = run(SYSTEMS["standard_rack_4kw"], 20, 180)
    fixture = {
        "source": "NREL-PySAM Pvwattsv8 on pvlib's 723170TYA.CSV (Greensboro, NC TMY3)",
        "station": {"lat": base["lat"], "lon": base["lon"], "tz": base["tz"], "elev": base["elev"]},
        "weather": {
            "dn": rounded(base["dn"], 1),
            "df": rounded(base["df"], 1),
            "tamb": rounded(base["tamb"], 2),
            "wspd": rounded(base["wspd"], 2),
        },
        "official": {"tilt": 20, "azimuth": 180, "system": "standard_rack_4kw",
                     "ac_annual": base["ac_annual"], "poa": rounded(base["poa"], 2)},
        "systems": {},
        "search": {"system": SEARCH_SYSTEM, "grid": {}},
    }
    for name, system in SYSTEMS.items():
        rows = [{"tilt": tilt, "azimuth": azimuth, "ac_annual": run(system, tilt, azimuth)["ac_annual"]}
                for tilt, azimuth in ORIENTATIONS]
        fixture["systems"][name] = {"system": system, "rows": rows}

    grid = {}
    for tilt in SEARCH_TILTS:
        for azimuth in SEARCH_AZIMUTHS:
            grid[f"{tilt},{azimuth}"] = run(SYSTEMS[SEARCH_SYSTEM], tilt, azimuth)["ac_annual"]
    best = max(grid, key=grid.get)
    fixture["search"]["grid"] = grid
    fixture["search"]["best"] = {"tilt": int(best.split(",")[0]), "azimuth": int(best.split(",")[1]),
                                 "ac_annual": grid[best]}

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}; optimum {best} = {grid[best]:.1f} kWh")


if __name__ == "__main__":
    main()
