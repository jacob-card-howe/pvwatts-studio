#!/usr/bin/env python3
"""
PVWatts CLI - Fast Command-Line Interface for PVWatts Solar Energy Estimations.

Usage examples:
  python pvwatts_cli.py --size 4.0 --tilt 20 --azimuth 180 --losses 14
  python pvwatts_cli.py --location seatac_tmy3 --size 6.0 --tilt 35 --azimuth 190
  python pvwatts_cli.py --sweep-tilt --size 6.0 --losses 11 --azimuth 180
  python pvwatts_cli.py --sweep-azimuth --size 6.0 --losses 11 --tilt 35
"""

import argparse
import sys
import os
import json
from pvwatts_fast import FastPVWatts


STATION_IDS = {
    "renton_tmy3": "renton_tmy3",
    "renton_tmyx": "renton_tmyx",
    "seatac_tmy3": "seatac_tmy3",
    "boeing_tmy3": "boeing_tmy3",
    "boston_tmy3": "boston_tmy3",
    "phoenix_tmy3": "phoenix_tmy3",
    "los_angeles_tmy3": "los_angeles_tmy3",
    "denver_tmy3": "denver_tmy3",
    "miami_tmy3": "miami_tmy3",
    "honolulu_tmy3": "honolulu_tmy3",
}

# Keep commands that named the former bundled EPWs working. Their contents
# were never parsed; the filenames selected the corresponding JSON dataset.
LEGACY_WEATHER_FILE_STATIONS = {
    "USA_WA_Renton.Muni.AP.727934_TMY3.epw": "renton_tmy3",
    "USA_WA_Renton.Muni.AP.727934_TMYx.2007-2021.epw": "renton_tmyx",
    "USA_WA_Seattle-Tacoma.Intl.AP.727930_TMY3.epw": "seatac_tmy3",
    "USA_WA_Seattle-King.County.Intl.AP-Boeing.Field.727935_TMY3.epw": "boeing_tmy3",
    "USA_MA_Boston-Logan.Intl.AP.725090_TMY3.epw": "boston_tmy3",
    "USA_AZ_Phoenix-Sky.Harbor.Intl.AP.722780_TMY3.epw": "phoenix_tmy3",
    "USA_CA_Los.Angeles.Intl.AP.722950_TMY3.epw": "los_angeles_tmy3",
    "USA_CO_Denver.Intl.AP.725650_TMY3.epw": "denver_tmy3",
    "USA_FL_Miami.Intl.AP.722020_TMY3.epw": "miami_tmy3",
    "USA_HI_Honolulu.Intl.AP.911820_TMY3.epw": "honolulu_tmy3",
}


def main():
    parser = argparse.ArgumentParser(description="PVWatts CLI - High-Performance Photovoltaic Simulation Engine")
    parser.add_argument("--location", default="renton_tmy3", help="Preprocessed weather station ID (e.g. renton_tmy3, seatac_tmy3, boston_tmy3, phoenix_tmy3)")
    parser.add_argument(
        "--weather-file",
        help=(
            "Legacy compatibility path whose filename identifies a preprocessed "
            "station; EPW contents are not parsed"
        ),
    )
    parser.add_argument("--size", type=float, default=4.0, help="DC system size (kW dc, default: 4.0)")
    parser.add_argument("--module-type", type=int, default=0, choices=[0, 1, 2], help="Module type: 0=Standard, 1=Premium, 2=Thin Film (default: 0)")
    parser.add_argument("--array-type", type=int, default=1, choices=[0, 1, 2, 3, 4], help="Array type: 0=Fixed Open Rack, 1=Fixed Roof Mount (default: 1)")
    parser.add_argument("--losses", type=float, default=14.0, help="System losses (%%, default: 14.0)")
    parser.add_argument("--tilt", type=float, default=20.0, help="Array tilt angle (deg, default: 20.0)")
    parser.add_argument("--azimuth", type=float, default=180.0, help="Array azimuth angle (deg, default: 180.0)")
    parser.add_argument("--dc-ac-ratio", type=float, default=1.2, help="DC to AC size ratio (default: 1.2)")
    parser.add_argument("--inv-eff", type=float, default=96.0, help="Inverter efficiency at rated power (%%, default: 96.0)")

    parser.add_argument("--sweep-tilt", action="store_true", help="Run a sweep across tilt angles from 0 to 90 deg")
    parser.add_argument("--sweep-azimuth", action="store_true", help="Run a sweep across azimuth angles from 90 to 270 deg")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")

    args = parser.parse_args()

    # Named stations load the preprocessed JSON used by FastPVWatts directly.
    # ``--weather-file`` remains available for compatibility with older callers;
    # FastPVWatts uses the filename to select a matching preprocessed station.
    if args.weather_file:
        weather_source = args.weather_file
        if not os.path.isfile(weather_source):
            legacy_station = LEGACY_WEATHER_FILE_STATIONS.get(os.path.basename(weather_source))
            if legacy_station:
                weather_source = legacy_station
            else:
                print(f"Error: Weather file not found at {weather_source}", file=sys.stderr)
                sys.exit(1)
    else:
        weather_source = STATION_IDS.get(args.location, STATION_IDS["renton_tmy3"])

    engine = FastPVWatts(weather_source)

    if args.sweep_tilt:
        tilts = [0, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90]
        results = []
        for t in tilts:
            r = engine.simulate(
                system_capacity_kw=args.size,
                module_type=args.module_type,
                array_type=args.array_type,
                losses=args.losses,
                tilt=float(t),
                azimuth=args.azimuth,
                dc_ac_ratio=args.dc_ac_ratio,
                inv_eff=args.inv_eff / 100.0
            )
            results.append({"tilt": t, "annual_ac_kwh": r["annual_ac_kwh"], "solrad": r["annual_solrad"]})

        if args.json:
            print(json.dumps(results, indent=2))
        else:
            max_kwh = max(x["annual_ac_kwh"] for x in results)
            print(f"=== Tilt Sweep (Size: {args.size} kW, Azimuth: {args.azimuth}°, Losses: {args.losses}%) ===")
            print(f"{'Tilt (deg)':<12} | {'Annual AC (kWh)':<16} | {'% of Max':<10}")
            print("-" * 45)
            for x in results:
                pct = (x["annual_ac_kwh"] / max_kwh) * 100.0
                print(f"{x['tilt']:<12} | {x['annual_ac_kwh']:>12.1f} | {pct:>8.1f}%")
        return

    if args.sweep_azimuth:
        azs = [90, 120, 135, 150, 165, 180, 190, 195, 210, 225, 240, 255, 270]
        results = []
        for a in azs:
            r = engine.simulate(
                system_capacity_kw=args.size,
                module_type=args.module_type,
                array_type=args.array_type,
                losses=args.losses,
                tilt=args.tilt,
                azimuth=float(a),
                dc_ac_ratio=args.dc_ac_ratio,
                inv_eff=args.inv_eff / 100.0
            )
            results.append({"azimuth": a, "annual_ac_kwh": r["annual_ac_kwh"], "solrad": r["annual_solrad"]})

        if args.json:
            print(json.dumps(results, indent=2))
        else:
            max_kwh = max(x["annual_ac_kwh"] for x in results)
            print(f"=== Azimuth Sweep (Size: {args.size} kW, Tilt: {args.tilt}°, Losses: {args.losses}%) ===")
            print(f"{'Azimuth (deg)':<14} | {'Annual AC (kWh)':<16} | {'% of Max':<10}")
            print("-" * 47)
            for x in results:
                pct = (x["annual_ac_kwh"] / max_kwh) * 100.0
                print(f"{x['azimuth']:<14} | {x['annual_ac_kwh']:>12.1f} | {pct:>8.1f}%")
        return

    # Single simulation run
    res = engine.simulate(
        system_capacity_kw=args.size,
        module_type=args.module_type,
        array_type=args.array_type,
        losses=args.losses,
        tilt=args.tilt,
        azimuth=args.azimuth,
        dc_ac_ratio=args.dc_ac_ratio,
        inv_eff=args.inv_eff / 100.0
    )

    if args.json:
        out = {
            "location": engine.meta.get("city", "Unknown"),
            "parameters": vars(args),
            "results": res
        }
        print(json.dumps(out, indent=2))
    else:
        print("=" * 60)
        print(f"PVWATTS SIMULATION RESULTS: {engine.meta.get('city', 'Location')}, {engine.meta.get('state-prov', '')}")
        print("=" * 60)
        print(f"DC System Size:        {args.size:.1f} kW")
        print(f"Module Type:           {['Standard', 'Premium', 'Thin Film'][args.module_type]}")
        print(f"Array Type:            {['Fixed Open Rack', 'Fixed Roof Mount'][args.array_type]}")
        print(f"System Losses:         {args.losses:.1f} %")
        print(f"Array Tilt:            {args.tilt:.1f} °")
        print(f"Array Azimuth:         {args.azimuth:.1f} °")
        print("-" * 60)
        print(f"Annual AC Energy:      {res['annual_ac_kwh']:,.1f} kWh ac")
        print(f"Annual Solar Rad:      {res['annual_solrad']:.2f} kWh/m2/day")
        cf = res.get('capacity_factor', res.get('capacityFactor', 0.0))
        print(f"Capacity Factor:       {cf:.1f} %")
        print(f"Energy Yield:          {res.get('kwh_per_kw', 0.0):.1f} kWh/kW")
        print("-" * 60)
        print("Monthly AC Energy (kWh):")
        for m, kwh, sol in zip(res["month_names"], res["monthly_ac"], res["monthly_solrad"]):
            print(f"  {m}: {kwh:>8.1f} kWh  ({sol:.2f} kWh/m2/day)")
        print("=" * 60)

if __name__ == "__main__":
    main()
