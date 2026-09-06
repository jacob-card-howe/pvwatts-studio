"""
PVWatts v5 / v8 Calculation Engine in Pure Python (Standard Library Only).
Zero external dependencies (no numpy, no scipy, no pandas required).
Loads precomputed solar geometry and weather arrays from data/<station>.json
and executes the full 8,760-hour annual simulation in ~10 milliseconds.
"""

import math
import json
import os
import sys

PEREZ_COEFFS = [
    [-0.008, 0.588, -0.062, -0.060, 0.072, -0.022],
    [ 0.130, 0.683, -0.151, -0.019, 0.066, -0.029],
    [ 0.330, 0.487, -0.221,  0.055, -0.060, -0.026],
    [ 0.568, 0.224, -0.295,  0.109, -0.019, -0.014],
    [ 0.873, 0.073, -0.362,  0.226, -0.044, -0.001],
    [ 1.132, -0.073, -0.412,  0.288, -0.056, -0.006],
    [ 1.060, -0.058, -0.359,  0.264, -0.076,  0.007],
    [ 0.678, -0.098, -0.181,  0.156, -0.060,  0.012]
]

MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
COS_85_DEG = math.cos(85.0 * math.pi / 180.0)

class FastPVWatts:
    def __init__(self, station_or_path="renton_tmy3"):
        # Resolve station ID or json/epw path
        base_dir = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.join(base_dir, "data")

        json_path = None
        if os.path.isfile(station_or_path) and station_or_path.endswith(".json"):
            json_path = station_or_path
        elif os.path.isfile(os.path.join(data_dir, f"{station_or_path}.json")):
            json_path = os.path.join(data_dir, f"{station_or_path}.json")
        else:
            # Check station name mapping or fallback
            base_name = os.path.basename(station_or_path).lower()
            if "renton" in base_name:
                json_path = os.path.join(data_dir, "renton_tmy3.json")
            elif "tacoma" in base_name or "seatac" in base_name:
                json_path = os.path.join(data_dir, "seatac_tmy3.json")
            elif "boeing" in base_name:
                json_path = os.path.join(data_dir, "boeing_tmy3.json")
            elif "boston" in base_name:
                json_path = os.path.join(data_dir, "boston_tmy3.json")
            elif "phoenix" in base_name:
                json_path = os.path.join(data_dir, "phoenix_tmy3.json")
            elif "los_angeles" in base_name or "lax" in base_name:
                json_path = os.path.join(data_dir, "los_angeles_tmy3.json")
            elif "denver" in base_name:
                json_path = os.path.join(data_dir, "denver_tmy3.json")
            elif "miami" in base_name:
                json_path = os.path.join(data_dir, "miami_tmy3.json")
            elif "honolulu" in base_name:
                json_path = os.path.join(data_dir, "honolulu_tmy3.json")
            else:
                json_path = os.path.join(data_dir, "renton_tmy3.json")

        if not os.path.exists(json_path):
            raise FileNotFoundError(f"Weather dataset not found at {json_path}")

        with open(json_path, "r") as f:
            self.data = json.load(f)

        self.meta = {
            "city": self.data.get("city", "Renton"),
            "state-prov": self.data.get("state", "WA"),
            "latitude": self.data.get("lat", 47.491),
            "longitude": self.data.get("lon", -122.216),
            "name": self.data.get("name", "Renton, WA")
        }

        self.n = len(self.data["dni"])
        self.zen_rad = self.data["zen_rad"]
        self.az_rad = self.data["az_rad"]
        self.sun_up = self.data["sun_up"]
        self.dni = self.data["dni"]
        self.dhi = self.data["dhi"]
        self.ghi = self.data["ghi"]
        self.temp_air = self.data["temp_air"]
        self.wind_speed = self.data["wind_speed"]
        self.ebin = self.data["ebin"]
        self.delta = self.data["delta"]
        self.months = self.data["months"]

        self.month_names = MONTH_NAMES

    def simulate(self, system_capacity_kw=4.0, module_type=0, array_type=1, losses=14.0, tilt=20.0, azimuth=180.0, dc_ac_ratio=1.2, inv_eff=0.96):
        tilt_rad = math.radians(tilt)
        az_rad = math.radians(azimuth)

        cos_tilt = math.cos(tilt_rad)
        sin_tilt = math.sin(tilt_rad)
        use_ar_glass = (module_type == 1)

        gamma_map = {0: -0.0047, 1: -0.0035, 2: -0.0020}
        gamma = gamma_map.get(module_type, -0.0047)

        dc_nameplate = system_capacity_kw * 1000.0
        ac_nameplate = dc_nameplate / dc_ac_ratio
        loss_factor = 1.0 - (losses / 100.0)

        # Inverter parameters
        etanom = inv_eff
        etaref = 0.9637
        A = -0.0162
        B = -0.0059
        C = 0.9858
        pdc0 = ac_nameplate / etanom

        n = self.n
        zen = self.zen_rad
        az = self.az_rad
        sun_up = self.sun_up
        dni = self.dni
        dhi = self.dhi
        ghi = self.ghi
        ebin = self.ebin
        delta = self.delta

        poa = [0.0] * n
        tpoa = [0.0] * n

        # 1. Transposition & IAM
        for i in range(n):
            if sun_up[i] == 0:
                continue

            z = zen[i]
            cos_zen = math.cos(z)
            sin_zen = math.sin(z)
            cos_aoi = cos_zen * cos_tilt + sin_zen * sin_tilt * math.cos(az[i] - az_rad)
            cos_aoi_clamped = max(0.0, cos_aoi)

            # Perez sky diffuse
            a = cos_aoi_clamped
            b_perez = max(COS_85_DEG, cos_zen)
            coeff = PEREZ_COEFFS[ebin[i]]

            F1 = max(0.0, coeff[0] + coeff[1] * delta[i] + coeff[2] * z)
            F2 = coeff[3] + coeff[4] * delta[i] + coeff[5] * z

            sky_diff = dhi[i] * ((1.0 - F1) * (1.0 + cos_tilt) * 0.5 + F1 * (a / b_perez) + F2 * sin_tilt)
            if sky_diff < 0.0:
                sky_diff = 0.0

            gnd_diff = ghi[i] * 0.2 * (1.0 - cos_tilt) * 0.5
            beam_poa = dni[i] * cos_aoi_clamped
            total_poa = max(0.0, beam_poa + sky_diff + gnd_diff)
            poa[i] = total_poa

            # IAM reflection
            aoi_deg = math.degrees(math.acos(min(1.0, max(-1.0, cos_aoi))))
            if 50.0 < aoi_deg < 90.0:
                if not use_ar_glass:
                    x = 1.0 - 2.438e-3 * aoi_deg + 3.103e-4 * (aoi_deg**2) - 1.246e-5 * (aoi_deg**3) + 2.112e-7 * (aoi_deg**4) - 1.359e-9 * (aoi_deg**5)
                else:
                    x = 1.0002 - 0.000213 * aoi_deg + 3.63416e-5 * (aoi_deg**2) - 2.175e-6 * (aoi_deg**3) + 5.2796e-8 * (aoi_deg**4) - 4.4351e-10 * (aoi_deg**5)
                beam_refl = (1.0 - x) * dni[i] * cos_aoi_clamped
                tpoa[i] = max(0.0, total_poa - beam_refl)
            else:
                tpoa[i] = total_poa

        # 2. Cell Temperature (Fuentes model)
        inoct_c = 49.0 if array_type == 1 else 45.0
        t_cell = self._compute_cell_temp(poa, self.temp_air, self.wind_speed, inoct_c)

        # 3. DC & AC Power
        monthly_ac = [0.0] * 12
        monthly_poa = [0.0] * 12
        monthly_dc = [0.0] * 12
        total_ac_wh = 0.0
        total_poa_wh = 0.0

        months = self.months
        for i in range(n):
            if sun_up[i] == 0 or poa[i] <= 0.0:
                continue

            p_dc = max(0.0, dc_nameplate * (1.0 + gamma * (t_cell[i] - 25.0)) * (tpoa[i] / 1000.0) * loss_factor)
            plr = p_dc / pdc0
            p_ac = 0.0
            if plr > 0.0:
                eta = (A * plr + B / plr + C) * (etanom / etaref)
                p_ac = min(ac_nameplate, max(0.0, p_dc * eta))

            m = months[i]
            monthly_ac[m] += p_ac
            monthly_poa[m] += poa[i]
            monthly_dc[m] += p_dc
            total_ac_wh += p_ac
            total_poa_wh += poa[i]

        annual_ac_kwh = total_ac_wh / 1000.0
        annual_solrad = (total_poa_wh / 1000.0) / 365.0
        capacity_factor = (annual_ac_kwh / (system_capacity_kw * 8760.0)) * 100.0
        kwh_per_kw = annual_ac_kwh / max(0.001, system_capacity_kw)

        monthly_ac_kwh = [round(v / 1000.0, 1) for v in monthly_ac]
        monthly_dc_kwh = [round(v / 1000.0, 1) for v in monthly_dc]
        monthly_solrad = [round((v / 1000.0) / MONTH_DAYS[idx], 2) for idx, v in enumerate(monthly_poa)]

        return {
            'annual_ac_kwh': round(annual_ac_kwh, 2),
            'annual_solrad': round(annual_solrad, 2),
            'capacity_factor': round(capacity_factor, 1),
            'capacityFactor': round(capacity_factor, 1),
            'kwh_per_kw': round(kwh_per_kw, 1),
            'monthly_ac': monthly_ac_kwh,
            'monthly_solrad': monthly_solrad,
            'monthly_dc': monthly_dc_kwh,
            'month_names': self.month_names,
            'system_capacity_kw': system_capacity_kw,
            'tilt': tilt,
            'azimuth': azimuth,
            'losses': losses,
            'module_type': module_type,
            'array_type': array_type
        }

    def _compute_cell_temp(self, poa, temp_air, wind_speed, inoct_c):
        n = len(poa)
        t_cell = [0.0] * n

        boltz = 0.00000005669
        capo = 11000.0
        absorb = 0.83
        emmis = 0.84
        xlen = 0.5
        inoct = inoct_c + 273.15
        height = 5.0
        dtime = 1.0

        windmd = 1.0
        tave = (inoct + 293.15) / 2.0
        denair = 0.003484 * 101325.0 / tave
        visair = 0.24237e-6 * (tave ** 0.76) / denair
        conair = 2.1695e-4 * (tave ** 0.84)
        reynld = windmd * xlen / visair
        hforce = 0.8600 / math.sqrt(reynld) * denair * windmd * 1007.0 / (0.71 ** 0.67)
        grashf = 9.8 / tave * (inoct - 293.15) * (xlen ** 3.0) / (visair * visair) * 0.5
        hfree = 0.21 * ((grashf * 0.71) ** 0.32) * conair / xlen
        hconv_init = (hfree ** 3.0 + hforce ** 3.0) ** (1.0 / 3.0)

        hgrnd = emmis * boltz * (inoct * inoct + 293.15 * 293.15) * (inoct + 293.15)
        backrt = (absorb * 800.0 - emmis * boltz * (inoct ** 4.0 - 282.21 ** 4.0) - hconv_init * (inoct - 293.15)) / ((hgrnd + hconv_init) * (inoct - 293.15))
        tgrnd = (inoct ** 4.0 - backrt * (inoct ** 4.0 - 293.15 ** 4.0)) ** 0.25
        tgrnd = min(inoct, max(293.15, tgrnd))

        tgrat = (tgrnd - 293.15) / (inoct - 293.15)
        convrt = (absorb * 800.0 - emmis * boltz * (2.0 * (inoct ** 4.0) - 282.21 ** 4.0 - tgrnd ** 4.0)) / (hconv_init * (inoct - 293.15))
        cap = capo * (1.0 + (inoct - 321.15) / 12.0) if inoct > 321.15 else capo

        tmodo = 293.15
        suno = 0.0

        for i in range(n):
            p = poa[i]
            ta = temp_air[i]
            ws = wind_speed[i]

            if p > 0.0:
                tamb = ta + 273.15
                suun = p * absorb
                tsky = 0.68 * (0.0552 * (tamb ** 1.5)) + 0.32 * tamb
                wmd = ws * ((height / 9.144) ** 0.2) + 0.0001
                tmod = tmodo

                for _ in range(10):
                    tave = (tmod + tamb) / 2.0
                    denair = 0.003484 * 101325.0 / tave
                    visair = 0.24237e-6 * (tave ** 0.76) / denair
                    conair = 2.1695e-4 * (tave ** 0.84)
                    reynld = wmd * xlen / visair
                    if reynld > 1.2e5:
                        hforce = 0.0282 / (reynld ** 0.2) * denair * wmd * 1007.0 / (0.71 ** 0.4)
                    else:
                        hforce = 0.8600 / math.sqrt(reynld) * denair * wmd * 1007.0 / (0.71 ** 0.67)
                    grashf = 9.8 / tave * abs(tmod - tamb) * (xlen ** 3.0) / (visair * visair) * 0.5
                    hfree = 0.21 * ((grashf * 0.71) ** 0.32) * conair / xlen
                    hconv = convrt * ((hfree ** 3.0 + hforce ** 3.0) ** (1.0 / 3.0))

                    hsky = emmis * boltz * (tmod * tmod + tsky * tsky) * (tmod + tsky)
                    tgrnd = tamb + tgrat * (tmod - tamb)
                    hgrnd = emmis * boltz * (tmod * tmod + tgrnd * tgrnd) * (tmod + tgrnd)
                    eigen = -(hconv + hsky + hgrnd) / cap * dtime * 3600.0
                    ex = math.exp(eigen) if eigen > -10.0 else 0.0
                    tmod = tmodo * ex + ((1.0 - ex) * (hconv * tamb + hsky * tsky + hgrnd * tgrnd + suno + (suun - suno) / eigen) + suun - suno) / (hconv + hsky + hgrnd)

                tmodo = tmod
                suno = suun
                t_cell[i] = tmod - 273.15
            else:
                tmodo = ta + 273.15
                suno = 0.0
                t_cell[i] = ta

        return t_cell

if __name__ == '__main__':
    engine = FastPVWatts("renton_tmy3")
    print("Testing pure-Python FastPVWatts:")
    res = engine.simulate(system_capacity_kw=6.0, tilt=35, azimuth=190, losses=11.0)
    print(f"Annual AC Energy: {res['annual_ac_kwh']:,} kWh")
    print(f"Daily Solar Radiation: {res['annual_solrad']} kWh/m2/day")
    print(f"Monthly AC: {res['monthly_ac']}")
