/**
 * PVWatts Studio - magnetic declination from the World Magnetic Model.
 *
 * PVWatts azimuths are true bearings (180 degrees is true south), but an
 * installer's compass points to magnetic north. The angle between the two is
 * the magnetic declination, positive when magnetic north lies east of true
 * north. This module evaluates the World Magnetic Model (WMM2025) in the
 * browser so the app can turn a true azimuth into a compass bearing without
 * another network request.
 *
 * The model is the degree-12 spherical-harmonic main field with its linear
 * secular variation, evaluated at a WGS 84 geodetic position, as described in
 * "The US/UK World Magnetic Model for 2025-2030: Technical Report" (NOAA NCEI
 * and the British Geological Survey). WMM2025 is valid from 2025.0 to 2030.0;
 * dates outside that window are still computed but flagged.
 *
 * The coefficients are the official WMM.COF for epoch 2025.0 (WMM-2025,
 * released 11/13/2024), a U.S. Government work in the public domain.
 */

(function (global) {
  'use strict';

  const DEG = Math.PI / 180;
  const MODEL = Object.freeze({ name: 'WMM-2025', epoch: 2025.0, validFrom: 2025.0, validTo: 2030.0 });
  const MAX_DEGREE = 12;
  const REFERENCE_RADIUS_KM = 6371.2;
  const WGS84_A_KM = 6378.137;
  const WGS84_F = 1 / 298.257223563;
  const WGS84_E2 = WGS84_F * (2 - WGS84_F);

  // WMM.COF rows: [n, m, g, h, dg/dt, dh/dt] in nT and nT/year.
  const COEFFICIENTS = [
    [ 1,  0,  -29351.8,      0.0,  12.0,   0.0],
    [ 1,  1,   -1410.8,   4545.4,   9.7, -21.5],
    [ 2,  0,   -2556.6,      0.0, -11.6,   0.0],
    [ 2,  1,    2951.1,  -3133.6,  -5.2, -27.7],
    [ 2,  2,    1649.3,   -815.1,  -8.0, -12.1],
    [ 3,  0,    1361.0,      0.0,  -1.3,   0.0],
    [ 3,  1,   -2404.1,    -56.6,  -4.2,   4.0],
    [ 3,  2,    1243.8,    237.5,   0.4,  -0.3],
    [ 3,  3,     453.6,   -549.5, -15.6,  -4.1],
    [ 4,  0,     895.0,      0.0,  -1.6,   0.0],
    [ 4,  1,     799.5,    278.6,  -2.4,  -1.1],
    [ 4,  2,      55.7,   -133.9,  -6.0,   4.1],
    [ 4,  3,    -281.1,    212.0,   5.6,   1.6],
    [ 4,  4,      12.1,   -375.6,  -7.0,  -4.4],
    [ 5,  0,    -233.2,      0.0,   0.6,   0.0],
    [ 5,  1,     368.9,     45.4,   1.4,  -0.5],
    [ 5,  2,     187.2,    220.2,   0.0,   2.2],
    [ 5,  3,    -138.7,   -122.9,   0.6,   0.4],
    [ 5,  4,    -142.0,     43.0,   2.2,   1.7],
    [ 5,  5,      20.9,    106.1,   0.9,   1.9],
    [ 6,  0,      64.4,      0.0,  -0.2,   0.0],
    [ 6,  1,      63.8,    -18.4,  -0.4,   0.3],
    [ 6,  2,      76.9,     16.8,   0.9,  -1.6],
    [ 6,  3,    -115.7,     48.8,   1.2,  -0.4],
    [ 6,  4,     -40.9,    -59.8,  -0.9,   0.9],
    [ 6,  5,      14.9,     10.9,   0.3,   0.7],
    [ 6,  6,     -60.7,     72.7,   0.9,   0.9],
    [ 7,  0,      79.5,      0.0,   0.0,   0.0],
    [ 7,  1,     -77.0,    -48.9,  -0.1,   0.6],
    [ 7,  2,      -8.8,    -14.4,  -0.1,   0.5],
    [ 7,  3,      59.3,     -1.0,   0.5,  -0.8],
    [ 7,  4,      15.8,     23.4,  -0.1,   0.0],
    [ 7,  5,       2.5,     -7.4,  -0.8,  -1.0],
    [ 7,  6,     -11.1,    -25.1,  -0.8,   0.6],
    [ 7,  7,      14.2,     -2.3,   0.8,  -0.2],
    [ 8,  0,      23.2,      0.0,  -0.1,   0.0],
    [ 8,  1,      10.8,      7.1,   0.2,  -0.2],
    [ 8,  2,     -17.5,    -12.6,   0.0,   0.5],
    [ 8,  3,       2.0,     11.4,   0.5,  -0.4],
    [ 8,  4,     -21.7,     -9.7,  -0.1,   0.4],
    [ 8,  5,      16.9,     12.7,   0.3,  -0.5],
    [ 8,  6,      15.0,      0.7,   0.2,  -0.6],
    [ 8,  7,     -16.8,     -5.2,   0.0,   0.3],
    [ 8,  8,       0.9,      3.9,   0.2,   0.2],
    [ 9,  0,       4.6,      0.0,   0.0,   0.0],
    [ 9,  1,       7.8,    -24.8,  -0.1,  -0.3],
    [ 9,  2,       3.0,     12.2,   0.1,   0.3],
    [ 9,  3,      -0.2,      8.3,   0.3,  -0.3],
    [ 9,  4,      -2.5,     -3.3,  -0.3,   0.3],
    [ 9,  5,     -13.1,     -5.2,   0.0,   0.2],
    [ 9,  6,       2.4,      7.2,   0.3,  -0.1],
    [ 9,  7,       8.6,     -0.6,  -0.1,  -0.2],
    [ 9,  8,      -8.7,      0.8,   0.1,   0.4],
    [ 9,  9,     -12.9,     10.0,  -0.1,   0.1],
    [10,  0,      -1.3,      0.0,   0.1,   0.0],
    [10,  1,      -6.4,      3.3,   0.0,   0.0],
    [10,  2,       0.2,      0.0,   0.1,   0.0],
    [10,  3,       2.0,      2.4,   0.1,  -0.2],
    [10,  4,      -1.0,      5.3,   0.0,   0.1],
    [10,  5,      -0.6,     -9.1,  -0.3,  -0.1],
    [10,  6,      -0.9,      0.4,   0.0,   0.1],
    [10,  7,       1.5,     -4.2,  -0.1,   0.0],
    [10,  8,       0.9,     -3.8,  -0.1,  -0.1],
    [10,  9,      -2.7,      0.9,   0.0,   0.2],
    [10, 10,      -3.9,     -9.1,   0.0,   0.0],
    [11,  0,       2.9,      0.0,   0.0,   0.0],
    [11,  1,      -1.5,      0.0,   0.0,   0.0],
    [11,  2,      -2.5,      2.9,   0.0,   0.1],
    [11,  3,       2.4,     -0.6,   0.0,   0.0],
    [11,  4,      -0.6,      0.2,   0.0,   0.1],
    [11,  5,      -0.1,      0.5,  -0.1,   0.0],
    [11,  6,      -0.6,     -0.3,   0.0,   0.0],
    [11,  7,      -0.1,     -1.2,   0.0,   0.1],
    [11,  8,       1.1,     -1.7,  -0.1,   0.0],
    [11,  9,      -1.0,     -2.9,  -0.1,   0.0],
    [11, 10,      -0.2,     -1.8,  -0.1,   0.0],
    [11, 11,       2.6,     -2.3,  -0.1,   0.0],
    [12,  0,      -2.0,      0.0,   0.0,   0.0],
    [12,  1,      -0.2,     -1.3,   0.0,   0.0],
    [12,  2,       0.3,      0.7,   0.0,   0.0],
    [12,  3,       1.2,      1.0,   0.0,  -0.1],
    [12,  4,      -1.3,     -1.4,   0.0,   0.1],
    [12,  5,       0.6,      0.0,   0.0,   0.0],
    [12,  6,       0.6,      0.6,   0.1,   0.0],
    [12,  7,       0.5,     -0.1,   0.0,   0.0],
    [12,  8,      -0.1,      0.8,   0.0,   0.0],
    [12,  9,      -0.4,      0.1,   0.0,   0.0],
    [12, 10,      -0.2,     -1.0,  -0.1,   0.0],
    [12, 11,      -1.3,      0.1,   0.0,   0.0],
    [12, 12,      -0.7,      0.2,  -0.1,  -0.1]
  ];

  // Gauss coefficients indexed [n][m], plus their secular variation.
  const G = [];
  const H = [];
  const GDOT = [];
  const HDOT = [];
  for (let n = 0; n <= MAX_DEGREE; n += 1) {
    G.push(new Float64Array(n + 1));
    H.push(new Float64Array(n + 1));
    GDOT.push(new Float64Array(n + 1));
    HDOT.push(new Float64Array(n + 1));
  }
  COEFFICIENTS.forEach(([n, m, g, h, gDot, hDot]) => {
    G[n][m] = g;
    H[n][m] = h;
    GDOT[n][m] = gDot;
    HDOT[n][m] = hDot;
  });

  // Schmidt semi-normalization factors for the Gauss-normalized recursion.
  const SCHMIDT = [];
  for (let n = 0; n <= MAX_DEGREE; n += 1) {
    const row = new Float64Array(n + 1);
    row[0] = n === 0 ? 1 : SCHMIDT[n - 1][0] * (2 * n - 1) / n;
    for (let m = 1; m <= n; m += 1) {
      row[m] = row[m - 1] * Math.sqrt((n - m + 1) * (m === 1 ? 2 : 1) / (n + m));
    }
    SCHMIDT.push(row);
  }

  /** Decimal year for a JavaScript Date (UTC). */
  function decimalYear(date = new Date()) {
    const year = date.getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    return year + (date.getTime() - start) / (end - start);
  }

  /**
   * Magnetic field components (nT) in the local geodetic frame: X north,
   * Y east, Z down. Latitude and longitude are WGS 84 geodetic degrees and
   * altitude is kilometres above the ellipsoid.
   */
  function fieldComponents(latDeg, lonDeg, { altitudeKm = 0, year = decimalYear() } = {}) {
    // Keep off the exact poles, where the east component is undefined.
    const lat = Math.max(-89.999999, Math.min(89.999999, Number(latDeg))) * DEG;
    const lon = Number(lonDeg) * DEG;
    const dt = year - MODEL.epoch;

    // Geodetic to geocentric spherical coordinates.
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const primeVertical = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const p = (primeVertical + altitudeKm) * cosLat;
    const z = (primeVertical * (1 - WGS84_E2) + altitudeKm) * sinLat;
    const r = Math.hypot(p, z);
    const geocentricLat = Math.asin(z / r);
    const cosTheta = Math.sin(geocentricLat);
    const sinTheta = Math.cos(geocentricLat);

    // Gauss-normalized associated Legendre functions and their theta derivatives.
    const P = [];
    const dP = [];
    for (let n = 0; n <= MAX_DEGREE; n += 1) {
      P.push(new Float64Array(n + 1));
      dP.push(new Float64Array(n + 1));
    }
    P[0][0] = 1;
    for (let n = 1; n <= MAX_DEGREE; n += 1) {
      for (let m = 0; m <= n; m += 1) {
        if (n === m) {
          P[n][m] = sinTheta * P[n - 1][m - 1];
          dP[n][m] = sinTheta * dP[n - 1][m - 1] + cosTheta * P[n - 1][m - 1];
        } else if (n === 1) {
          P[n][m] = cosTheta * P[n - 1][m];
          dP[n][m] = cosTheta * dP[n - 1][m] - sinTheta * P[n - 1][m];
        } else {
          const k = m > n - 2 ? 0 : ((n - 1) ** 2 - m * m) / ((2 * n - 1) * (2 * n - 3));
          const previous = m > n - 2 ? 0 : P[n - 2][m];
          const previousDerivative = m > n - 2 ? 0 : dP[n - 2][m];
          P[n][m] = cosTheta * P[n - 1][m] - k * previous;
          dP[n][m] = cosTheta * dP[n - 1][m] - sinTheta * P[n - 1][m] - k * previousDerivative;
        }
      }
    }

    let north = 0;
    let east = 0;
    let down = 0;
    let ratio = (REFERENCE_RADIUS_KM / r) ** 2;
    for (let n = 1; n <= MAX_DEGREE; n += 1) {
      ratio *= REFERENCE_RADIUS_KM / r;
      for (let m = 0; m <= n; m += 1) {
        const g = (G[n][m] + dt * GDOT[n][m]) * SCHMIDT[n][m];
        const h = (H[n][m] + dt * HDOT[n][m]) * SCHMIDT[n][m];
        const cosM = Math.cos(m * lon);
        const sinM = Math.sin(m * lon);
        const radial = g * cosM + h * sinM;
        north += ratio * radial * dP[n][m];
        east += ratio * m * (g * sinM - h * cosM) * P[n][m];
        down -= ratio * (n + 1) * radial * P[n][m];
      }
    }
    east /= sinTheta;

    // Rotate from the geocentric to the geodetic frame.
    const psi = geocentricLat - lat;
    return {
      x: north * Math.cos(psi) - down * Math.sin(psi),
      y: east,
      z: north * Math.sin(psi) + down * Math.cos(psi)
    };
  }

  /**
   * Magnetic declination (degrees, east positive) at a location and date.
   * `inRange` is false outside the model's five-year validity window.
   */
  function declination(latDeg, lonDeg, { date = new Date(), year, altitudeKm = 0 } = {}) {
    const when = Number.isFinite(year) ? year : decimalYear(date);
    const { x, y } = fieldComponents(latDeg, lonDeg, { altitudeKm, year: when });
    return {
      declination: Math.atan2(y, x) / DEG,
      year: when,
      model: MODEL.name,
      inRange: when >= MODEL.validFrom && when <= MODEL.validTo
    };
  }

  /**
   * Compass (magnetic) bearing for a true bearing. With 14 degrees west
   * declination (-14), true south (180) reads 194 on the compass.
   */
  function magneticBearing(trueBearing, declinationDeg) {
    return (((trueBearing - declinationDeg) % 360) + 360) % 360;
  }

  /** "8.6° W" style label for a declination in degrees, east positive. */
  function formatDeclination(declinationDeg, digits = 1) {
    const rounded = Number(Math.abs(declinationDeg).toFixed(digits));
    if (rounded === 0) return '0°';
    return `${rounded.toFixed(digits)}° ${declinationDeg > 0 ? 'E' : 'W'}`;
  }

  const MagneticDeclination = {
    MODEL,
    decimalYear,
    fieldComponents,
    declination,
    magneticBearing,
    formatDeclination
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MagneticDeclination;
  else global.MagneticDeclination = MagneticDeclination;
})(typeof window !== 'undefined' ? window : globalThis);
