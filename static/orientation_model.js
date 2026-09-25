/**
 * PVWatts Studio - in-browser orientation model for fixed PV arrays.
 *
 * The app fetches one year of hourly weather from the PVWatts v8 API once
 * (timeframe=hourly), then this module re-runs the fixed-array energy chain
 * locally for any tilt and azimuth. That turns a tilt/azimuth search from one
 * API request per orientation into one request per location.
 *
 * The chain follows the open-source SAM Simulation Core (SSC) `pvwattsv8`
 * compute module for fixed open-rack and fixed roof-mount arrays:
 *   - sun position with sunrise/sunset-hour interpolation (lib_irradproc)
 *   - Perez 1990 transposition with PVWatts' low-sun and zero-diffuse cases
 *   - row-to-row self-shading for open-rack arrays (lib_pvshade, linear beam
 *     loss plus sky and ground view-factor derates)
 *   - monthly soiling, DeSoto cover transmittance with an anti-reflective
 *     coating, and the DeSoto air-mass spectral modifier
 *   - NOCT cell temperature and the CEC six-parameter single-diode module
 *     model for PVWatts' standard, premium, and thin-film module types
 *   - DC losses and the Sandia inverter model with PVWatts' fixed coefficients
 *
 * Sun position uses the NOAA/Meeus equations with SPA's refraction correction
 * rather than the full NREL SPA series; the difference is hundredths of a
 * degree. Results are an independent estimate and are calibrated against the
 * official API result at the orientation the weather was fetched with.
 *
 * Portions are adapted from SSC (https://github.com/NatLabRockies/ssc):
 *
 *   BSD 3-Clause License
 *   Copyright (c) Alliance for Energy Innovation, LLC.
 *   All rights reserved.
 *
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions are met:
 *   1. Redistributions of source code must retain the above copyright notice,
 *      this list of conditions and the following disclaimer.
 *   2. Redistributions in binary form must reproduce the above copyright
 *      notice, this list of conditions and the following disclaimer in the
 *      documentation and/or other materials provided with the distribution.
 *   3. Neither the name of the copyright holder nor the names of its
 *      contributors may be used to endorse or promote products derived from
 *      this software without specific prior written permission.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 *   ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 *   LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 *   CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *   SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 *   INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 *   CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *   ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *   POSSIBILITY OF SUCH DAMAGE.
 */

(function (global) {
  'use strict';

  const DEG = Math.PI / 180;
  const HOURS_PER_YEAR = 8760;
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Array types the local model reproduces. Trackers and bifacial modules
  // still use the official API sweep.
  const FIXED_OPEN_RACK = 0;
  const FIXED_ROOF_MOUNT = 1;

  // CEC six-parameter models behind PVWatts' three module types (SSC
  // cmod_pvwattsv8). `stcEff` sets the notional module area for row geometry.
  const MODULES = Object.freeze({
    0: { stcEff: 0.19, Area: 1.6864, Vmp: 35.8, Imp: 9.01, Voc: 43.3, alphaIsc: 0.004755, a: 1.65916, Il: 9.51393, Io: 4.37813e-11, Rs: 0.269953, Rsh: 654.059, Adj: 5.79586 },
    1: { stcEff: 0.21, Area: 1.6297, Vmp: 54.7, Imp: 5.98, Voc: 64.9, alphaIsc: 0.0026, a: 2.45326, Il: 6.4704, Io: 2.01784e-11, Rs: 0.421231, Rsh: 261.723, Adj: 9.56482 },
    2: { stcEff: 0.18, Area: 2.4751, Vmp: 183.6, Imp: 2.37, Voc: 219.6, alphaIsc: 0.00102, a: 7.97293, Il: 2.55475, Io: 2.69243e-12, Rs: 4.60991, Rsh: 2476.95, Adj: -2.49865 }
  });

  const PEREZ_F11 = [-0.0083117, 0.1299457, 0.3296958, 0.5682053, 0.8730280, 1.1326077, 1.0601591, 0.6777470];
  const PEREZ_F12 = [0.5877285, 0.6825954, 0.4868735, 0.1874525, -0.3920403, -1.2367284, -1.5999137, -0.3272588];
  const PEREZ_F13 = [-0.0620636, -0.1513752, -0.2210958, -0.2951290, -0.3616149, -0.4118494, -0.3589221, -0.2504286];
  const PEREZ_F21 = [-0.0596012, -0.0189325, 0.0554140, 0.1088631, 0.2255647, 0.2877813, 0.2642124, 0.1561313];
  const PEREZ_F22 = [0.0721249, 0.0659650, -0.0639588, -0.1519229, -0.4620442, -0.8230357, -1.1272340, -1.3765031];
  const PEREZ_F23 = [-0.0220216, -0.0288748, -0.0260542, -0.0139754, 0.0012448, 0.0558651, 0.1310694, 0.2506212];
  const PEREZ_EPS_BINS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2];
  const AIR_MASS_COEFFS = [0.918093, 0.086257, -0.024459, 0.002816, -0.000126];

  // Per-hour sky cases, matching the branches of SSC's perez().
  const SKY_DARK = 0;       // sun down, or beam exceeds extraterrestrial
  const SKY_LOW_SUN = 1;    // zenith beyond 87.5 degrees: isotropic diffuse only
  const SKY_NO_DIFFUSE = 2; // diffuse <= 0: beam only
  const SKY_PEREZ = 3;

  /* ------------------------------------------------------------------ */
  /* Sun position                                                        */
  /* ------------------------------------------------------------------ */

  function dayOfYear(month, day) {
    let total = day;
    for (let m = 0; m < month - 1; m += 1) total += DAYS_IN_MONTH[m];
    return total;
  }

  function julianDay(year, month, day, hourUt) {
    let y = year;
    let m = month;
    if (m <= 2) { y -= 1; m += 12; }
    const a = Math.floor(y / 100);
    const b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 + hourUt / 24;
  }

  /** Declination (rad) and equation of time (minutes) from NOAA/Meeus. */
  function solarTerms(jd) {
    const t = (jd - 2451545) / 36525;
    const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
    const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const mr = m * DEG;
    const c = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
      + Math.sin(2 * mr) * (0.019993 - 0.000101 * t)
      + Math.sin(3 * mr) * 0.000289;
    const omega = (125.04 - 1934.136 * t) * DEG;
    const lambda = (l0 + c - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
    const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * DEG;
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(lambda));
    const y = Math.tan(obliquity / 2) ** 2;
    const l0r = l0 * DEG;
    const eot = 4 / DEG * (y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr)
      + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r)
      - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr));
    return { declination, eot };
  }

  /** Solar declination (degrees) at noon UT on a calendar day of the model year. */
  function solarDeclination(month, day, year = 1997) {
    return solarTerms(julianDay(year, month, day, 12)).declination / DEG;
  }

  /**
   * Sunrise and sunset in local standard hours, evaluated at local noon like
   * SSC. Returns -100/100 for polar day and 100/-100 for polar night.
   */
  function sunriseSunset(year, month, day, lat, lon, tz) {
    const { declination, eot } = solarTerms(julianDay(year, month, day, 12 - tz));
    const latR = lat * DEG;
    const cosH = (Math.sin(-0.8333 * DEG) - Math.sin(latR) * Math.sin(declination))
      / (Math.cos(latR) * Math.cos(declination));
    if (cosH <= -1) return { sunrise: -100, sunset: 100 };
    if (cosH >= 1) return { sunrise: 100, sunset: -100 };
    const halfDay = Math.acos(cosH) / DEG / 15;
    const transit = 12 + tz - lon / 15 - eot / 60;
    return { sunrise: transit - halfDay, sunset: transit + halfDay };
  }

  /**
   * Refraction-corrected zenith and azimuth (degrees, azimuth east of north)
   * for a local standard time expressed in fractional hours.
   */
  function sunPosition(year, month, day, localHour, lat, lon, tz, pressure, temperature) {
    const { declination, eot } = solarTerms(julianDay(year, month, day, localHour - tz));
    const trueSolarMinutes = localHour * 60 + eot + 4 * lon - 60 * tz;
    const hourAngle = (trueSolarMinutes / 4 - 180) * DEG;
    const latR = lat * DEG;
    let cosZ = Math.sin(latR) * Math.sin(declination) + Math.cos(latR) * Math.cos(declination) * Math.cos(hourAngle);
    cosZ = Math.min(1, Math.max(-1, cosZ));
    const zenith0 = Math.acos(cosZ) / DEG;

    const azimuth = (Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(latR) - Math.tan(declination) * Math.cos(latR)
    ) / DEG + 180) % 360;

    // SPA atmospheric refraction correction (SUN_RADIUS + 0.5667 cutoff).
    const e0 = 90 - zenith0;
    let refraction = 0;
    if (e0 >= -(0.26667 + 0.5667)) {
      refraction = (pressure / 1010) * (283 / (273 + temperature))
        * 1.02 / (60 * Math.tan((e0 + 10.3 / (e0 + 5.11)) * DEG));
      if (!Number.isFinite(refraction)) refraction = 0;
    }
    let zenith = 90 - (e0 + refraction);
    zenith = Math.min(180, Math.max(0, zenith));
    return { zenith, azimuth };
  }

  /** Standard-atmosphere station pressure (mbar) when the weather has none. */
  function pressureFromElevation(elevation) {
    return 1013.25 * Math.pow(1 - 2.25577e-5 * Math.max(0, elevation), 5.25588);
  }

  /* ------------------------------------------------------------------ */
  /* Module optics, temperature, and electrical models                  */
  /* ------------------------------------------------------------------ */

  function transmittance(theta1Deg, nCover, nIncoming, k, thickness) {
    const theta1 = theta1Deg * DEG;
    const theta2 = Math.asin(nIncoming / nCover * Math.sin(theta1));
    const tr = 1 - 0.5 * (
      Math.sin(theta2 - theta1) ** 2 / Math.sin(theta2 + theta1) ** 2
      + Math.tan(theta2 - theta1) ** 2 / Math.tan(theta2 + theta1) ** 2
    );
    return { tau: tr * Math.exp(-k * thickness / Math.cos(theta2)), refracted: theta2 / DEG };
  }

  const N_GLASS = 1.526;
  const L_GLASS = 0.002;
  const K_GLASS = 4;
  const N_ARC = 1.3;
  const L_ARC = L_GLASS * 0.01;
  const K_ARC = 4;

  /** Anti-reflective-coated glass transmittance at an incidence angle. */
  function coatedTransmittance(thetaDeg) {
    const coating = transmittance(thetaDeg, N_ARC, 1, K_ARC, L_ARC);
    return coating.tau * transmittance(coating.refracted, N_GLASS, N_ARC, K_GLASS, L_GLASS).tau;
  }

  // SSC normalizes by the coating at 1 degree followed by glass entered from
  // air (not from the coating), which lifts every modifier before the cap at
  // 1. Reproduced as written so results line up with PVWatts.
  const TAU_NORMAL = (() => {
    const coating = transmittance(1, N_ARC, 1, K_ARC, L_ARC);
    return coating.tau * transmittance(coating.refracted, N_GLASS, 1, K_GLASS, L_GLASS).tau;
  })();

  /** DeSoto beam incidence-angle modifier (cover transmittance ratio). */
  function beamIam(aoiDeg) {
    const theta = Math.min(89, Math.max(1, aoiDeg));
    return Math.min(1, coatedTransmittance(theta) / TAU_NORMAL);
  }

  /** DeSoto diffuse modifiers depend only on tilt (uncoated glass, as in SSC). */
  function diffuseIams(tiltDeg) {
    const thetaSky = 59.7 - 0.1388 * tiltDeg + 0.001497 * tiltDeg * tiltDeg;
    const thetaGnd = 90 - 0.5788 * tiltDeg + 0.002693 * tiltDeg * tiltDeg;
    const sky = Math.min(1, transmittance(Math.min(89, Math.max(1, thetaSky)), N_GLASS, 1, K_GLASS, L_GLASS).tau / TAU_NORMAL);
    const gnd = Math.min(1, transmittance(Math.min(89, Math.max(1, thetaGnd)), N_GLASS, 1, K_GLASS, L_GLASS).tau / TAU_NORMAL);
    return { sky, gnd };
  }

  /** DeSoto air-mass spectral modifier (SSC King model with default coefficients). */
  function spectralFactor(zenithDeg, elevation) {
    const z = Math.min(86, Math.max(0, zenithDeg));
    const am = 1 / (Math.cos(z * DEG) + 0.5057 * Math.pow(96.080 - z, -1.634)) * Math.exp(-0.0001184 * elevation);
    const c = AIR_MASS_COEFFS;
    const f = c[0] + am * (c[1] + am * (c[2] + am * (c[3] + am * c[4])));
    return f > 0 ? f : 0;
  }

  const KB = 8.618e-5;
  const T_REF = 298.15;

  function openVoltage(voc0, a, il, io, rsh) {
    let low = 0;
    let high = voc0 * 1.5;
    let voc = voc0;
    for (let i = 0; i < 5000 && Math.abs(high - low) > 0.001; i += 1) {
      const current = il - io * (Math.exp(voc / a) - 1) - voc / rsh;
      if (current < 0) high = voc;
      if (current > 0) low = voc;
      voc = (high + low) / 2;
    }
    return voc;
  }

  function currentAtVoltage(v, guess, a, il, io, rs, rsh) {
    let next = guess;
    let previous = 0;
    for (let i = 0; i < 4000 && Math.abs(next - previous) > 0.0001; i += 1) {
      previous = next;
      const ex = io * Math.exp((v + previous * rs) / a);
      const f = il - previous - (ex - io) - (v + previous * rs) / rsh;
      const fPrime = -1 - ex * rs / a - rs / rsh;
      next = Math.max(0, previous - f / fPrime);
    }
    return next;
  }

  /** CEC six-parameter module power (W per module) at effective irradiance and cell temperature. */
  function cecModulePower(mod, gEff, tCellC) {
    if (!(gEff >= 1)) return 0;
    const t = tCellC + 273.15;
    const muIsc = mod.alphaIsc * (1 - mod.Adj / 100);
    const il = Math.max(0, gEff / 1000 * (mod.Il + muIsc * (t - T_REF)));
    const eg = 1.12 * (1 - 0.0002677 * (t - T_REF));
    const io = mod.Io * Math.pow(t / T_REF, 3) * Math.exp(1 / KB * (1.12 / T_REF - eg / t));
    const a = mod.a * t / T_REF;
    const rsh = mod.Rsh * 1000 / gEff;
    const voc = openVoltage(mod.Voc, a, il, io, rsh);

    // Golden-section search for the maximum-power voltage on [0, Voc].
    const ratio = (Math.sqrt(5) - 1) / 2;
    let lo = 0;
    let hi = voc;
    let x1 = hi - ratio * (hi - lo);
    let x2 = lo + ratio * (hi - lo);
    const power = v => v * currentAtVoltage(v, 0.9 * il, a, il, io, mod.Rs, rsh);
    let p1 = power(x1);
    let p2 = power(x2);
    while (hi - lo > 1e-5 * voc) {
      if (p1 < p2) {
        lo = x1; x1 = x2; p1 = p2;
        x2 = lo + ratio * (hi - lo); p2 = power(x2);
      } else {
        hi = x2; x2 = x1; p2 = p1;
        x1 = hi - ratio * (hi - lo); p1 = power(x1);
      }
    }
    return Math.max(p1, p2);
  }

  // Efficiency lookup table (W per module per W/m2) over irradiance and cell
  // temperature. Bilinear interpolation keeps the single-diode solve out of
  // the orientation search while staying within a few hundredths of a percent.
  const LUT_G_FINE_MAX = 100;
  const LUT_G_MAX = 1600;
  const LUT_G_COARSE_STEP = 10;
  const LUT_T_MIN = -60;
  const LUT_T_MAX = 120;
  const lutCache = new Map();

  function lutIrradianceNodes() {
    const nodes = [];
    for (let g = 1; g <= LUT_G_FINE_MAX; g += 1) nodes.push(g);
    for (let g = LUT_G_FINE_MAX + LUT_G_COARSE_STEP; g <= LUT_G_MAX; g += LUT_G_COARSE_STEP) nodes.push(g);
    return nodes;
  }

  function efficiencyTable(moduleType) {
    if (lutCache.has(moduleType)) return lutCache.get(moduleType);
    const mod = MODULES[moduleType];
    const gNodes = lutIrradianceNodes();
    const tCount = LUT_T_MAX - LUT_T_MIN + 1;
    const table = new Float64Array(gNodes.length * tCount);
    gNodes.forEach((g, gi) => {
      for (let ti = 0; ti < tCount; ti += 1) {
        table[gi * tCount + ti] = cecModulePower(mod, g, LUT_T_MIN + ti) / g;
      }
    });
    const lut = { mod, table, tCount, gCount: gNodes.length };
    lutCache.set(moduleType, lut);
    return lut;
  }

  function lookupModulePower(lut, gEff, tCellC) {
    if (!(gEff >= 1)) return 0;
    if (gEff > LUT_G_MAX || tCellC < LUT_T_MIN || tCellC > LUT_T_MAX) {
      return cecModulePower(lut.mod, gEff, tCellC);
    }
    let gIndex;
    let gFrac;
    if (gEff <= LUT_G_FINE_MAX) {
      const x = gEff - 1;
      gIndex = Math.min(LUT_G_FINE_MAX - 2, Math.floor(x));
      gFrac = x - gIndex;
    } else {
      const x = (gEff - LUT_G_FINE_MAX) / LUT_G_COARSE_STEP;
      const cell = Math.min(lut.gCount - LUT_G_FINE_MAX - 1, Math.floor(x));
      gIndex = LUT_G_FINE_MAX - 1 + cell;
      gFrac = x - cell;
    }
    const tx = tCellC - LUT_T_MIN;
    const tIndex = Math.min(lut.tCount - 2, Math.floor(tx));
    const tFrac = tx - tIndex;
    const n = lut.tCount;
    const t = lut.table;
    const i00 = gIndex * n + tIndex;
    const i10 = i00 + n;
    const eta = (t[i00] * (1 - tFrac) + t[i00 + 1] * tFrac) * (1 - gFrac)
      + (t[i10] * (1 - tFrac) + t[i10 + 1] * tFrac) * gFrac;
    return eta * gEff;
  }

  /** Fraction of isotropic sky diffuse still seen by a row (SSC sssky_diffuse_table). */
  function skyDiffuseDerate(tiltDeg, gcr) {
    if (tiltDeg === 0) return 1;
    const steps = 250;
    const step = 1 / steps;
    const tanTilt = Math.tan(tiltDeg * DEG);
    const sinTilt = Math.sin(tiltDeg * DEG);
    const aSky = Math.PI + Math.PI / Math.sqrt(1 + tanTilt * tanTilt);
    let total = 0;
    for (let n = 0; n < steps; n += 1) {
      const arg = 1 / tanTilt - 1 / (gcr * sinTilt * (1 - n * step));
      const gamma = -Math.PI / 2 + Math.atan(arg);
      const tg = Math.tan(tiltDeg * DEG + gamma);
      let aShade = Math.PI + Math.PI / Math.sqrt(1 + tg * tg);
      if (tiltDeg * DEG + gamma > Math.PI / 2) aShade = 2 * Math.PI - aShade;
      total += (aShade / aSky) * step;
    }
    return Math.min(1, total);
  }

  /* ------------------------------------------------------------------ */
  /* Weather preparation                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Timestamp conventions for the hourly weather.
   * 'interpolate': hourly averages stamped mid-hour, with SSC's sunrise and
   *   sunset hour interpolation (TMY2/TMY3/international files without a
   *   minute column).
   * 'instant30' / 'instant0': weather files with a minute column (e.g. NSRDB
   *   PSM TMY CSVs), where SSC evaluates the sun at hh:30 or hh:00.
   */
  const TIME_MODES = ['interpolate', 'instant30', 'instant0'];

  function monthDayHour(index) {
    let dayIndex = Math.floor(index / 24);
    const hour = index % 24;
    let month = 0;
    while (dayIndex >= DAYS_IN_MONTH[month]) {
      dayIndex -= DAYS_IN_MONTH[month];
      month += 1;
    }
    return { month: month + 1, day: dayIndex + 1, hour };
  }

  function numericSeries(values, name) {
    if (!Array.isArray(values) && !ArrayBuffer.isView(values)) {
      throw new Error(`Hourly weather is missing ${name}`);
    }
    if (values.length !== HOURS_PER_YEAR) {
      throw new Error(`Hourly ${name} must have ${HOURS_PER_YEAR} values (got ${values.length})`);
    }
    return Float64Array.from(values, Number);
  }

  /**
   * Precompute everything that does not depend on the array orientation:
   * sun geometry, sky-model coefficients, and spectral factors for each
   * daylight hour.
   */
  function prepareWeather(weather, { timeMode = 'interpolate', year = 1997 } = {}) {
    if (!TIME_MODES.includes(timeMode)) throw new Error(`Unknown time mode ${timeMode}`);
    const lat = Number(weather.lat);
    const lon = Number(weather.lon);
    const tz = Number(weather.tz);
    const elevation = Math.max(0, Number(weather.elev) || 0);
    if (![lat, lon, tz].every(Number.isFinite)) throw new Error('Hourly weather needs station latitude, longitude, and time zone');

    const dn = numericSeries(weather.dn, 'beam irradiance (dn)');
    const df = numericSeries(weather.df, 'diffuse irradiance (df)');
    const tamb = numericSeries(weather.tamb, 'ambient temperature (tamb)');
    const wspd = numericSeries(weather.wspd, 'wind speed (wspd)');
    const alb = weather.alb ? numericSeries(weather.alb, 'albedo (alb)') : null;
    const pres = weather.pres ? numericSeries(weather.pres, 'pressure (pres)') : null;
    const defaultPressure = pressureFromElevation(elevation);

    const hours = [];
    let riseSetDay = -1;
    let rise = 0;
    let set = 0;
    for (let i = 0; i < HOURS_PER_YEAR; i += 1) {
      const { month, day, hour } = monthDayHour(i);
      const dayIndex = Math.floor(i / 24);
      if (dayIndex !== riseSetDay) {
        ({ sunrise: rise, sunset: set } = sunriseSunset(year, month, day, lat, lon, tz));
        riseSetDay = dayIndex;
      }

      let tCalc = null;
      if (timeMode === 'interpolate') {
        const tCur = hour + 0.5;
        if (tCur >= rise - 0.5 && tCur < rise + 0.5) tCalc = (rise + tCur + 0.5) / 2;
        else if (tCur > set - 0.5 && tCur <= set + 0.5) tCalc = (tCur - 0.5 + set) / 2;
        else if ((rise < set && tCur >= rise && tCur <= set) || (rise > set && (tCur <= set || tCur >= rise))) tCalc = tCur;
      } else {
        const tCur = hour + (timeMode === 'instant30' ? 0.5 : 0);
        if ((rise < set && tCur >= rise && tCur <= set) || (rise > set && (tCur <= set || tCur >= rise))) tCalc = tCur;
      }
      if (tCalc === null) continue;

      const pressure = pres && pres[i] > 800 ? pres[i] : defaultPressure;
      const { zenith, azimuth } = sunPosition(year, month, day, tCalc, lat, lon, tz, pressure, tamb[i]);
      const zen = zenith * DEG;
      const cosZ = Math.cos(zen);
      const gon = 1367 * (1 + 0.033 * Math.cos(360 / 365 * dayOfYear(month, day) * DEG));
      const hextra = zenith > 0 && zenith < 90 ? gon * cosZ : (zenith === 0 ? gon : 0);
      const beam = Math.max(0, dn[i]);
      const diffuse = df[i];

      let sky = SKY_PEREZ;
      let f1 = 0;
      let f2 = 0;
      let zh = 1;
      if (beam * cosZ > hextra) sky = SKY_DARK;
      else if (zen < 0 || zen > 1.5271631) sky = SKY_LOW_SUN;
      else if (diffuse <= 0) sky = SKY_NO_DIFFUSE;
      else {
        zh = cosZ > 0.0871557 ? cosZ : 0.0871557;
        const airMass = 1 / (cosZ + 0.15 * Math.pow(93.9 - zenith, -1.253));
        const delta = diffuse * airMass / 1367;
        const t3 = zenith ** 3 * 0.000005534;
        const eps = ((beam + diffuse) / diffuse + t3) / (1 + t3);
        let bin = 0;
        while (bin < 7 && eps > PEREZ_EPS_BINS[bin]) bin += 1;
        f1 = Math.max(0, PEREZ_F11[bin] + PEREZ_F12[bin] * delta + PEREZ_F13[bin] * zen);
        f2 = PEREZ_F21[bin] + PEREZ_F22[bin] * delta + PEREZ_F23[bin] * zen;
      }
      if (sky === SKY_DARK) continue;

      hours.push({
        index: i,
        month,
        sky,
        zenith,
        azimuth,
        sinZ: Math.sin(zen),
        cosZ,
        dnRaw: dn[i],
        beam,
        diffuse: sky === SKY_LOW_SUN ? Math.max(0, diffuse) : diffuse,
        f1,
        f2,
        zh,
        tamb: tamb[i],
        wind: Math.max(0.001, wspd[i] * 0.51),
        albedo: alb && alb[i] > 0 && alb[i] < 1 ? alb[i] : null,
        scf: spectralFactor(zenith, elevation)
      });
    }

    // Structure-of-arrays copy for the hot loop.
    const n = hours.length;
    const pick = (key, Type = Float64Array) => Type.from(hours, h => h[key]);
    return {
      lat, lon, tz, elevation, timeMode,
      count: n,
      index: pick('index', Int32Array),
      month: pick('month', Int8Array),
      sky: pick('sky', Int8Array),
      zenith: pick('zenith'),
      solarAzimuth: pick('azimuth'),
      sinZ: pick('sinZ'),
      cosZ: pick('cosZ'),
      dnRaw: pick('dnRaw'),
      beam: pick('beam'),
      diffuse: pick('diffuse'),
      f1: pick('f1'),
      f2: pick('f2'),
      zh: pick('zh'),
      tamb: pick('tamb'),
      wind: pick('wind'),
      albedo: Float64Array.from(hours, h => (h.albedo === null ? NaN : h.albedo)),
      scf: pick('scf')
    };
  }

  /* ------------------------------------------------------------------ */
  /* System setup and simulation                                         */
  /* ------------------------------------------------------------------ */

  function localModelSupport(system) {
    const arrayType = Number(system.arrayType);
    if (arrayType !== FIXED_OPEN_RACK && arrayType !== FIXED_ROOF_MOUNT) {
      return { supported: false, reason: 'The local optimizer covers fixed open-rack and fixed roof-mount arrays. Tracking arrays still use the official sweep.' };
    }
    if (Number(system.bifaciality) > 0) {
      return { supported: false, reason: 'The local optimizer does not model bifacial rear-side gain yet. Set bifacial to No or use the official sweep.' };
    }
    return { supported: true, reason: '' };
  }

  /** Derive PVWatts' fixed geometry, thermal, and inverter assumptions from the inputs. */
  function prepareSystem(system) {
    const support = localModelSupport(system);
    if (!support.supported) throw new Error(support.reason);
    const moduleType = Number(system.moduleType) || 0;
    const mod = MODULES[moduleType];
    if (!mod) throw new Error('moduleType must be 0, 1, or 2');
    const arrayType = Number(system.arrayType);
    const dcNameplate = Number(system.systemCapacityKw) * 1000;
    const dcAcRatio = Number(system.dcAcRatio);
    const invEff = Number(system.invEff);
    const acNameplate = dcNameplate / dcAcRatio;
    const pdco = acNameplate / (invEff * 0.01);
    // SSC compares the Watt nameplate against kW-sized thresholds, so nearly
    // every system lands in the utility tier. Kept as-is to match the API.
    const pso = dcNameplate < 10 ? 0.002246 * acNameplate
      : dcNameplate < 1000 ? 0.002478 * acNameplate
        : 0.004931 * acNameplate;

    const gcr = Number(system.groundCoverageRatio ?? system.gcr ?? 0.4);
    const area = 300 / mod.stcEff / 1000;
    const width = Math.sqrt(area / 1.7);
    const length = width * 1.7;
    const nModules = Math.max(1, Math.ceil(dcNameplate / 300));
    const nModY = 2;
    const nRows = arrayType === FIXED_ROOF_MOUNT ? 1 : Math.ceil(Math.sqrt(nModules / nModY));
    const nModX = Math.max(1, Math.ceil(nModules / (nRows * nModY)));
    const soiling = Array.isArray(system.monthlyIrradianceLosses) && system.monthlyIrradianceLosses.length === 12
      ? system.monthlyIrradianceLosses.map(value => Number(value) / 100)
      : new Array(12).fill(0);

    return {
      moduleType,
      arrayType,
      lut: efficiencyTable(moduleType),
      mod,
      dcNameplate,
      acNameplate,
      pdco,
      pso,
      moduleScale: dcNameplate / (mod.Vmp * mod.Imp),
      lossFactor: 1 - Number(system.losses) * 0.01,
      tnoct: arrayType === FIXED_ROOF_MOUNT ? 49 : 45,
      effRef: mod.Imp * mod.Vmp / (1000 * mod.Area),
      selfShading: arrayType === FIXED_OPEN_RACK,
      gcr,
      rowSide: length * nModY,
      rowLength: nModX * width,
      rowSpacing: length * nModY / gcr,
      nRows,
      multipleStrings: Math.floor(nModX / 7) > 1,
      soiling,
      albedo: system.useWeatherFileAlbedo === false || system.useWeatherFileAlbedo === 0
        ? Number(system.albedo)
        : null
    };
  }

  /**
   * Simulate one orientation. Returns annual AC energy (kWh) and plane-of-array
   * insolation (kWh/m2). With `hourly: true` it also returns hourly POA and AC
   * arrays for comparison with the official hourly response, and with
   * `monthly: true` twelve monthly AC totals (kWh). `exact: true` solves the
   * single-diode model directly instead of using the lookup table.
   */
  function simulate(prepared, sys, tiltDeg, azimuthDeg, { hourly = false, monthly = false, exact = false } = {}) {
    const tilt = tiltDeg * DEG;
    const azimuth = ((azimuthDeg % 360) + 360) % 360;
    const azimuthR = azimuth * DEG;
    const sinTilt = Math.sin(tilt);
    const cosTilt = Math.cos(tilt);
    const isoSky = (1 + cosTilt) / 2;
    const isoGnd = (1 - cosTilt) / 2;
    const iams = diffuseIams(tiltDeg);
    const skyDerate = sys.selfShading ? skyDiffuseDerate(tiltDeg, sys.gcr) : 1;
    const tempScale = (sys.tnoct - 20) * (1 - sys.effRef / 0.9) / 800 * 9.5;

    // Ground-view derate terms that depend only on tilt (SSC diffuse_reduce).
    const rowRatio = 1 / sys.gcr;
    const f3Term = 1 + rowRatio - Math.sqrt(rowRatio * rowRatio - 2 * rowRatio * Math.cos((180 - tiltDeg) * DEG) + 1);
    const sinHalfTilt2 = Math.sin(tilt / 2) ** 2;

    const hourlyPoa = hourly ? new Float64Array(HOURS_PER_YEAR) : null;
    const hourlyAc = hourly ? new Float64Array(HOURS_PER_YEAR) : null;
    const hourlyDc = hourly ? new Float64Array(HOURS_PER_YEAR) : null;
    const hourlyTcell = hourly ? new Float64Array(HOURS_PER_YEAR) : null;
    const monthlyAcWh = monthly ? new Float64Array(12) : null;
    let acWh = 0;
    let poaWh = 0;

    const n = prepared.count;
    for (let k = 0; k < n; k += 1) {
      const sky = prepared.sky[k];
      const sinZ = prepared.sinZ[k];
      const cosZ = prepared.cosZ[k];
      const solarAz = prepared.solarAzimuth[k];
      const beamNormal = prepared.beam[k];
      const diffuse = prepared.diffuse[k];
      const weatherAlbedo = prepared.albedo[k];
      const albedo = sys.albedo !== null ? sys.albedo : (Number.isNaN(weatherAlbedo) ? 0.2 : weatherAlbedo);

      let cosInc = sinZ * Math.cos(solarAz * DEG - azimuthR) * sinTilt + cosZ * cosTilt;
      if (cosInc > 1) cosInc = 1;
      if (cosInc < -1) cosInc = -1;

      let ibeam = 0;
      let isky = 0;
      let ignd = 0;
      if (sky === SKY_LOW_SUN) {
        ibeam = cosInc > 0 && prepared.zenith[k] < 90 ? beamNormal * cosInc : 0;
        isky = diffuse * isoSky;
      } else if (sky === SKY_NO_DIFFUSE) {
        ibeam = cosInc > 0 ? beamNormal * cosInc : 0;
      } else {
        const zc = cosInc < 0 ? 0 : cosInc;
        const f1 = prepared.f1[k];
        ibeam = beamNormal * zc;
        isky = diffuse * (1 - f1) * isoSky + diffuse * f1 * zc / prepared.zh[k] + diffuse * prepared.f2[k] * sinTilt;
        ignd = albedo * (beamNormal * cosZ + diffuse) * isoGnd;
      }

      if (sys.selfShading) {
        const zenith = prepared.zenith[k];
        const azEff = solarAz - azimuth;
        let py = 0;
        let px = 0;
        if (zenith < 90 && tiltDeg !== 0 && Math.abs(azEff) < 90) {
          const tanAlt = Math.tan((90 - zenith) * DEG);
          py = sys.rowSide * (cosTilt + Math.cos(azEff * DEG) * sinTilt / tanAlt);
          px = sys.rowSide * sinTilt * Math.sin(azEff * DEG) / tanAlt;
        }
        let g = py === 0 ? 0 : sys.rowSpacing * px / py;
        g = Math.min(Math.max(g, 0), sys.rowLength);
        if (sys.multipleStrings) g = 0;
        let hs = py === 0 ? 0 : sys.rowSide * (1 - sys.rowSpacing / py);
        hs = Math.min(Math.max(hs, 0), sys.rowSide);
        const shadeFraction = hs * (sys.rowLength - g) / (sys.rowSide * sys.rowLength);

        let fSky = 1;
        let fGnd = 1;
        if (isky + ignd >= 0.1) {
          fSky = skyDerate;
          const gbh = prepared.dnRaw[k] * cosZ;
          const solarAltitude = 90 - zenith;
          const f1 = albedo * sinHalfTilt2;
          let y1 = rowRatio - Math.sin((180 - solarAltitude - tiltDeg) * DEG) / Math.sin(solarAltitude * DEG);
          y1 = Math.max(0.00001, y1);
          const f2 = 0.5 * albedo * (1 + y1 - Math.sqrt(y1 * y1 - 2 * y1 * Math.cos((180 - tiltDeg) * DEG) + 1));
          const f3 = 0.5 * albedo * f3Term;
          const gr1 = f1 * (gbh + diffuse);
          const rows = sys.nRows;
          const reduced = ((f1 + (rows - 1) * f2) / rows) * gbh + ((f1 + (rows - 1) * f3) / rows) * diffuse;
          if (gr1 > 0) fGnd = reduced / gr1;
        }
        ibeam *= 1 - shadeFraction;
        if (fSky >= -0.00001 && fSky <= 1.00001) isky *= fSky;
        if (fGnd >= -0.00001 && fGnd <= 1.00001) ignd *= fGnd;
      }

      const soilingFactor = 1 - sys.soiling[prepared.month[k] - 1];
      ibeam *= soilingFactor;
      isky *= soilingFactor;
      ignd *= soilingFactor;
      const poa = ibeam + isky + ignd;
      poaWh += poa;

      const aoi = Math.acos(cosInc) / DEG;
      let gEff = ibeam * beamIam(aoi) + isky * iams.sky + ignd * iams.gnd;
      if (gEff < 0) gEff = 0;
      gEff *= prepared.scf[k];

      let dc = 0;
      let tCell = prepared.tamb[k];
      if (gEff >= 1) {
        tCell = prepared.tamb[k] + gEff * tempScale / (5.7 + 3.8 * prepared.wind[k]);
        const modulePower = exact ? cecModulePower(sys.mod, gEff, tCell) : lookupModulePower(sys.lut, gEff, tCell);
        dc = modulePower * sys.moduleScale * sys.lossFactor;
      }

      let ac = 0;
      if (dc > sys.pso) {
        ac = sys.acNameplate / (sys.pdco - sys.pso) * (dc - sys.pso);
        if (ac > sys.acNameplate) ac = sys.acNameplate;
      }
      if (ac < 0) ac = 0;
      acWh += ac;
      if (monthly) monthlyAcWh[prepared.month[k] - 1] += ac;

      if (hourly) {
        const idx = prepared.index[k];
        hourlyPoa[idx] = poa;
        hourlyDc[idx] = dc;
        hourlyAc[idx] = ac;
        hourlyTcell[idx] = tCell;
      }
    }

    const result = { tilt: tiltDeg, azimuth, acKwh: acWh / 1000, poaKwhM2: poaWh / 1000 };
    if (monthly) result.monthlyAcKwh = Array.from(monthlyAcWh, value => value / 1000);
    if (hourly) {
      result.hourlyPoa = hourlyPoa;
      result.hourlyDc = hourlyDc;
      result.hourlyAc = hourlyAc;
      result.hourlyTcell = hourlyTcell;
    }
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Calibration against the official hourly response                    */
  /* ------------------------------------------------------------------ */

  function sum(values) {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) total += Number(values[i]) || 0;
    return total;
  }

  /**
   * Build a calibrated local model from an official hourly PVWatts response.
   * The timestamp convention is chosen by matching the official hourly
   * plane-of-array irradiance, and a single scale factor ties the local
   * annual AC energy to the official figure at the fetched orientation.
   */
  function calibrate(weather, system, official) {
    const sys = prepareSystem(system);
    let best = null;
    for (const timeMode of TIME_MODES) {
      const prepared = prepareWeather(weather, { timeMode });
      const run = simulate(prepared, sys, official.tilt, official.azimuth, { hourly: true });
      let squared = 0;
      if (official.hourlyPoa) {
        for (let i = 0; i < HOURS_PER_YEAR; i += 1) {
          const diff = run.hourlyPoa[i] - Number(official.hourlyPoa[i]);
          squared += diff * diff;
        }
      }
      const rmse = Math.sqrt(squared / HOURS_PER_YEAR);
      if (!best || rmse < best.poaRmse) best = { timeMode, prepared, run, poaRmse: rmse };
      if (!official.hourlyPoa) break;
    }

    const officialAcKwh = Number.isFinite(Number(official.acAnnualKwh))
      ? Number(official.acAnnualKwh)
      : sum(official.hourlyAc || []) / 1000;
    const localAcKwh = best.run.acKwh;
    const scale = localAcKwh > 0 ? officialAcKwh / localAcKwh : 1;
    const officialPoaKwh = official.hourlyPoa ? sum(official.hourlyPoa) / 1000 : null;

    return {
      prepared: best.prepared,
      system: sys,
      timeMode: best.timeMode,
      scale,
      baseline: {
        tilt: official.tilt,
        azimuth: official.azimuth,
        officialAcKwh,
        localAcKwh,
        officialPoaKwhM2: officialPoaKwh,
        localPoaKwhM2: best.run.poaKwhM2,
        poaRmse: best.poaRmse,
        acDifferencePercent: officialAcKwh > 0 ? (localAcKwh / officialAcKwh - 1) * 100 : 0
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Orientation search                                                  */
  /* ------------------------------------------------------------------ */

  function range(start, stop, step) {
    const values = [];
    for (let v = start; v <= stop + 1e-9; v += step) values.push(Math.round(v * 1000) / 1000);
    return values;
  }

  const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));

  /**
   * Search tilt 0-90 and azimuth 0-355 on a coarse grid, then refine around
   * the best cell at 1-degree resolution. `onProgress(done, total)` reports
   * progress; `signal` cancels between chunks. Energies are scaled by the
   * calibration factor.
   */
  async function optimize(model, {
    tiltStep = 5,
    azimuthStep = 5,
    refineTilt = 5,
    refineAzimuth = 10,
    onProgress = () => {},
    signal,
    chunkMs = 30
  } = {}) {
    const { prepared, system, scale } = model;
    const tilts = range(0, 90, tiltStep);
    const azimuths = range(0, 360 - azimuthStep, azimuthStep);
    const values = new Float64Array(tilts.length * azimuths.length);
    const flatValue = simulate(prepared, system, 0, 180).acKwh * scale;

    const coarseTotal = (tilts.length - 1) * azimuths.length;
    const refineTotal = (2 * refineTilt + 1) * (2 * refineAzimuth + 1);
    const total = coarseTotal + refineTotal;
    let done = 0;
    let chunkStart = Date.now();
    const checkpoint = async () => {
      if (Date.now() - chunkStart < chunkMs) return;
      onProgress(done, total);
      await nextFrame();
      if (signal?.aborted) throw new DOMException('Optimization cancelled', 'AbortError');
      chunkStart = Date.now();
    };

    let best = { tilt: 0, azimuth: 180, acKwh: flatValue };
    for (let ti = 0; ti < tilts.length; ti += 1) {
      for (let ai = 0; ai < azimuths.length; ai += 1) {
        let value = flatValue;
        if (tilts[ti] !== 0) {
          value = simulate(prepared, system, tilts[ti], azimuths[ai]).acKwh * scale;
          done += 1;
        }
        values[ti * azimuths.length + ai] = value;
        if (value > best.acKwh) best = { tilt: tilts[ti], azimuth: azimuths[ai], acKwh: value };
        await checkpoint();
      }
    }

    const coarseBest = { ...best };
    for (let dt = -refineTilt; dt <= refineTilt; dt += 1) {
      const tilt = coarseBest.tilt + dt;
      for (let da = -refineAzimuth; da <= refineAzimuth; da += 1) {
        done += 1;
        if (tilt < 0 || tilt > 90) continue;
        const azimuth = ((coarseBest.azimuth + da) % 360 + 360) % 360;
        const value = tilt === 0 ? flatValue : simulate(prepared, system, tilt, azimuth).acKwh * scale;
        if (value > best.acKwh) best = { tilt, azimuth: tilt === 0 ? 180 : azimuth, acKwh: value };
        await checkpoint();
      }
    }
    onProgress(total, total);

    return { tilts, azimuths, values, best, coarseBest };
  }

  /** Scaled annual AC energy for one orientation. */
  function evaluate(model, tilt, azimuth) {
    return simulate(model.prepared, model.system, tilt, azimuth).acKwh * model.scale;
  }

  /* ------------------------------------------------------------------ */
  /* Seasonal tilt schedules                                             */
  /* ------------------------------------------------------------------ */

  // Tilt settings per year for an adjustable rack: fixed, twice a year,
  // four times a year, and monthly.
  const SCHEDULE_SETTINGS = Object.freeze([1, 2, 4, 12]);

  /** Every increasing choice of `count` month indexes from 0-11. */
  function monthCuts(count) {
    const cuts = [];
    const chosen = [];
    const pick = start => {
      if (chosen.length === count) {
        cuts.push(chosen.slice());
        return;
      }
      for (let m = start; m <= 12 - (count - chosen.length); m += 1) {
        chosen.push(m);
        pick(m + 1);
        chosen.pop();
      }
    };
    pick(0);
    return cuts;
  }

  /** Join neighbouring blocks that settled on the same tilt, across the new year too. */
  function mergeBlocks(blocks) {
    const merged = [];
    for (const block of blocks) {
      const last = merged[merged.length - 1];
      if (last && last.tilt === block.tilt) {
        last.months += block.months;
        last.kwh += block.kwh;
      } else {
        merged.push({ ...block });
      }
    }
    if (merged.length > 1 && merged[0].tilt === merged[merged.length - 1].tilt) {
      const tail = merged.pop();
      merged[0] = { ...merged[0], startMonth: tail.startMonth, months: merged[0].months + tail.months, kwh: merged[0].kwh + tail.kwh };
    }
    return merged;
  }

  /**
   * Best schedule with at most `settings` tilt settings a year, from monthly
   * energy by tilt (`monthlyKwh[tiltIndex * 12 + month]`). Each setting holds
   * for a run of whole months, wrapping over the new year, so the rack is
   * re-tilted on the first of a month. Every split of the year is checked.
   */
  function bestSchedule(tilts, monthlyKwh, settings) {
    const n = tilts.length;
    // runs[start][length]: the best single tilt for a run of months.
    const runs = [];
    for (let start = 0; start < 12; start += 1) {
      const sums = new Float64Array(n);
      const row = [null];
      for (let length = 1; length <= 12; length += 1) {
        const month = (start + length - 1) % 12;
        let bestTi = 0;
        for (let ti = 0; ti < n; ti += 1) {
          sums[ti] += monthlyKwh[ti * 12 + month];
          if (sums[ti] > sums[bestTi]) bestTi = ti;
        }
        row.push({ ti: bestTi, kwh: sums[bestTi] });
      }
      runs.push(row);
    }

    let best = null;
    for (const cuts of settings <= 1 ? [[0]] : monthCuts(Math.min(settings, 12))) {
      let annualKwh = 0;
      const blocks = cuts.map((start, i) => {
        const months = (i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + 12) - start;
        const run = runs[start][months];
        annualKwh += run.kwh;
        return { startMonth: start + 1, months, tilt: tilts[run.ti], kwh: run.kwh };
      });
      if (!best || annualKwh > best.annualKwh + 1e-9) best = { settings, annualKwh, blocks };
    }
    best.blocks = mergeBlocks(best.blocks);
    return best;
  }

  /**
   * Monthly mean solar declination and, for an array facing the equator, the
   * tilt that points straight at the noon sun: |latitude - declination|,
   * floored at 0 when the noon sun is behind the array.
   */
  function noonSunReference(lat, azimuth) {
    const facing = Math.cos(azimuth * DEG);
    const equatorFacing = lat >= 0 ? facing < -Math.SQRT1_2 : facing > Math.SQRT1_2;
    const declination = [];
    const noonSunTilt = [];
    for (let m = 0; m < 12; m += 1) {
      let sumDeclination = 0;
      let sumTilt = 0;
      for (let d = 1; d <= DAYS_IN_MONTH[m]; d += 1) {
        const delta = solarDeclination(m + 1, d);
        sumDeclination += delta;
        sumTilt += Math.max(0, lat >= 0 ? lat - delta : delta - lat);
      }
      declination.push(sumDeclination / DAYS_IN_MONTH[m]);
      noonSunTilt.push(sumTilt / DAYS_IN_MONTH[m]);
    }
    return { declination, noonSunTilt: equatorFacing ? noonSunTilt : null };
  }

  /**
   * Monthly energy for every tilt from 0 to 90 degrees at one azimuth, and the
   * best schedule for a rack re-tilted 1, 2, 4, or 12 times a year. Energies
   * are scaled by the calibration factor. `onProgress(done, total)` reports
   * progress; `signal` cancels between chunks.
   */
  async function tiltSchedules(model, azimuthDeg, {
    settings = SCHEDULE_SETTINGS,
    onProgress = () => {},
    signal,
    chunkMs = 30
  } = {}) {
    const { prepared, system, scale } = model;
    const azimuth = ((azimuthDeg % 360) + 360) % 360;
    const tilts = range(0, 90, 1);
    const monthlyKwh = new Float64Array(tilts.length * 12);
    let chunkStart = Date.now();
    for (let ti = 0; ti < tilts.length; ti += 1) {
      const run = simulate(prepared, system, tilts[ti], azimuth, { monthly: true });
      for (let m = 0; m < 12; m += 1) monthlyKwh[ti * 12 + m] = run.monthlyAcKwh[m] * scale;
      if (Date.now() - chunkStart >= chunkMs) {
        onProgress(ti + 1, tilts.length);
        await nextFrame();
        if (signal?.aborted) throw new DOMException('Schedule search cancelled', 'AbortError');
        chunkStart = Date.now();
      }
    }
    onProgress(tilts.length, tilts.length);

    const monthlyBest = [];
    for (let m = 0; m < 12; m += 1) {
      let bestTi = 0;
      for (let ti = 1; ti < tilts.length; ti += 1) {
        if (monthlyKwh[ti * 12 + m] > monthlyKwh[bestTi * 12 + m]) bestTi = ti;
      }
      monthlyBest.push({ tilt: tilts[bestTi], kwh: monthlyKwh[bestTi * 12 + m] });
    }
    const reference = noonSunReference(prepared.lat, azimuth);
    return {
      azimuth,
      tilts,
      monthlyKwh,
      monthlyBest,
      declination: reference.declination,
      noonSunTilt: reference.noonSunTilt,
      schedules: settings.map(count => bestSchedule(tilts, monthlyKwh, count))
    };
  }

  /**
   * Pull hourly weather and station metadata out of an official PVWatts v8
   * JSON response requested with timeframe=hourly.
   */
  function weatherFromPvwattsResponse(payload) {
    const outputs = payload?.outputs || {};
    const station = payload?.station_info || {};
    const inputs = payload?.inputs || {};
    const missing = ['dn', 'df', 'tamb', 'wspd'].filter(name => !Array.isArray(outputs[name]));
    if (missing.length) {
      throw new Error(`The response has no hourly ${missing.join(', ')}. Request it with timeframe=hourly.`);
    }
    return {
      weather: {
        dn: outputs.dn,
        df: outputs.df,
        tamb: outputs.tamb,
        wspd: outputs.wspd,
        alb: Array.isArray(outputs.alb) ? outputs.alb : null,
        lat: Number(station.lat ?? inputs.lat),
        lon: Number(station.lon ?? inputs.lon),
        tz: Number(station.tz),
        elev: Number(station.elev) || 0
      },
      official: {
        tilt: Number(inputs.tilt),
        azimuth: Number(inputs.azimuth),
        acAnnualKwh: Number(outputs.ac_annual),
        hourlyPoa: Array.isArray(outputs.poa) ? outputs.poa : null,
        hourlyAc: Array.isArray(outputs.ac) ? outputs.ac : null
      },
      station
    };
  }

  const OrientationModel = {
    HOURS_PER_YEAR,
    TIME_MODES,
    MODULES,
    localModelSupport,
    prepareWeather,
    prepareSystem,
    simulate,
    calibrate,
    optimize,
    evaluate,
    SCHEDULE_SETTINGS,
    bestSchedule,
    tiltSchedules,
    solarDeclination,
    weatherFromPvwattsResponse,
    cecModulePower,
    sunPosition,
    sunriseSunset
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = OrientationModel;
  else global.OrientationModel = OrientationModel;
})(typeof window !== 'undefined' ? window : globalThis);
