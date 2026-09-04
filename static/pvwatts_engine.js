/**
 * PVWatts v5 / v8 Calculation Engine in Pure JavaScript.
 * Implements NREL PVWatts algorithm with Perez 1990 transposition,
 * King / Marion IAM reflection modifier, Fuentes dynamic thermal cell temperature,
 * temperature derating, and PVWatts inverter efficiency & clipping model.
 */

const PEREZ_COEFFS = [
  [-0.008, 0.588, -0.062, -0.060, 0.072, -0.022],
  [ 0.130, 0.683, -0.151, -0.019, 0.066, -0.029],
  [ 0.330, 0.487, -0.221,  0.055, -0.060, -0.026],
  [ 0.568, 0.224, -0.295,  0.109, -0.019, -0.014],
  [ 0.873, 0.073, -0.362,  0.226, -0.044, -0.001],
  [ 1.132, -0.073, -0.412,  0.288, -0.056, -0.006],
  [ 1.060, -0.058, -0.359,  0.264, -0.076,  0.007],
  [ 0.678, -0.098, -0.181,  0.156, -0.060,  0.012]
];

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COS_85_DEG = Math.cos(85.0 * Math.PI / 180.0);

class PVWattsEngineJS {
  constructor(weatherData) {
    this.data = weatherData;
    this.n = weatherData.dni.length; // 8760

    // Convert arrays to Float64Array for maximum JIT speed
    this.zen_rad = new Float64Array(weatherData.zen_rad);
    this.az_rad = new Float64Array(weatherData.az_rad);
    this.sun_up = new Uint8Array(weatherData.sun_up);
    this.dni = new Float64Array(weatherData.dni);
    this.dhi = new Float64Array(weatherData.dhi);
    this.ghi = new Float64Array(weatherData.ghi);
    this.temp_air = new Float64Array(weatherData.temp_air);
    this.wind_speed = new Float64Array(weatherData.wind_speed);
    this.ebin = new Uint8Array(weatherData.ebin);
    this.delta = new Float64Array(weatherData.delta);
    this.months = new Uint8Array(weatherData.months);

    // Preallocate working arrays to eliminate GC overhead during interactive slider drags
    this.poa = new Float64Array(this.n);
    this.tpoa = new Float64Array(this.n);
    this.t_cell = new Float64Array(this.n);
    this.dc = new Float64Array(this.n);
    this.pac = new Float64Array(this.n);
  }

  simulate(params = {}) {
    const systemCapacityKw = params.systemCapacityKw ?? 4.0;
    const moduleType = params.moduleType ?? 0; // 0=Standard, 1=Premium, 2=Thin Film
    const arrayType = params.arrayType ?? 1;   // 0=Fixed Open Rack, 1=Fixed Roof Mount, 2=1-Axis, 4=2-Axis
    const losses = params.losses ?? 14.0;      // System losses %
    const tilt = params.tilt ?? 20.0;          // Array tilt deg
    const azimuth = params.azimuth ?? 180.0;   // Array azimuth deg
    const dcAcRatio = params.dcAcRatio ?? 1.2;
    const invEff = params.invEff ?? 0.96;

    const tiltRad = tilt * Math.PI / 180.0;
    const azRad = azimuth * Math.PI / 180.0;

    const cosTilt = Math.cos(tiltRad);
    const sinTilt = Math.sin(tiltRad);
    const useArGlass = (moduleType === 1);

    // Gamma (temp coefficient)
    let gamma = -0.0047;
    if (moduleType === 1) gamma = -0.0035;
    else if (moduleType === 2) gamma = -0.0020;

    const dcNameplate = systemCapacityKw * 1000.0;
    const acNameplate = dcNameplate / dcAcRatio;
    const lossFactor = 1.0 - (losses / 100.0);

    // Inverter parameters
    const etanom = invEff;
    const etaref = 0.9637;
    const A = -0.0162;
    const B = -0.0059;
    const C = 0.9858;
    const pdc0 = acNameplate / etanom;

    const n = this.n;
    const zen = this.zen_rad;
    const az = this.az_rad;
    const sunUp = this.sun_up;
    const dni = this.dni;
    const dhi = this.dhi;
    const ghi = this.ghi;
    const ebin = this.ebin;
    const delta = this.delta;

    const poa = this.poa;
    const tpoa = this.tpoa;

    // 1. Calculate POA Irradiance and Transmitted POA
    for (let i = 0; i < n; i++) {
      if (sunUp[i] === 0) {
        poa[i] = 0.0;
        tpoa[i] = 0.0;
        continue;
      }

      const z = zen[i];
      const cosZen = Math.cos(z);
      const sinZen = Math.sin(z);
      const cosAoi = cosZen * cosTilt + sinZen * sinTilt * Math.cos(az[i] - azRad);
      const cosAoiClamped = cosAoi > 0.0 ? cosAoi : 0.0;

      // Perez transposition
      const a = cosAoiClamped;
      const bPerez = cosZen > COS_85_DEG ? cosZen : COS_85_DEG;
      const coeff = PEREZ_COEFFS[ebin[i]];

      let F1 = coeff[0] + coeff[1] * delta[i] + coeff[2] * z;
      if (F1 < 0.0) F1 = 0.0;
      const F2 = coeff[3] + coeff[4] * delta[i] + coeff[5] * z;

      let skyDiff = dhi[i] * ((1.0 - F1) * (1.0 + cosTilt) * 0.5 + F1 * (a / bPerez) + F2 * sinTilt);
      if (skyDiff < 0.0) skyDiff = 0.0;

      const gndDiff = ghi[i] * 0.2 * (1.0 - cosTilt) * 0.5;
      const beamPoa = dni[i] * cosAoiClamped;
      const totalPoa = beamPoa + skyDiff + gndDiff;
      poa[i] = totalPoa > 0.0 ? totalPoa : 0.0;

      // IAM reflection
      let aoiDeg = Math.acos(cosAoi < -1.0 ? -1.0 : (cosAoi > 1.0 ? 1.0 : cosAoi)) * (180.0 / Math.PI);
      if (aoiDeg > 50.0 && aoiDeg < 90.0) {
        let x;
        if (!useArGlass) {
          x = 1.0 - 2.438e-3 * aoiDeg + 3.103e-4 * (aoiDeg * aoiDeg) - 1.246e-5 * (aoiDeg ** 3) + 2.112e-7 * (aoiDeg ** 4) - 1.359e-9 * (aoiDeg ** 5);
        } else {
          x = 1.0002 - 0.000213 * aoiDeg + 3.63416e-5 * (aoiDeg * aoiDeg) - 2.175e-6 * (aoiDeg ** 3) + 5.2796e-8 * (aoiDeg ** 4) - 4.4351e-10 * (aoiDeg ** 5);
        }
        const beamRefl = (1.0 - x) * dni[i] * cosAoiClamped;
        const netPoa = totalPoa - beamRefl;
        tpoa[i] = netPoa > 0.0 ? netPoa : 0.0;
      } else {
        tpoa[i] = poa[i];
      }
    }

    // 2. Dynamic Thermal Cell Temperature (Fuentes model)
    const inoctC = (arrayType === 1) ? 49.0 : 45.0;
    this.computeCellTemp(inoctC);

    // 3. DC Power and Inverter AC Power
    const tCell = this.t_cell;
    const dc = this.dc;
    const pac = this.pac;

    let totalAcWattHours = 0.0;
    let totalPoaWattHours = 0.0;

    const monthlyAc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const monthlyPoa = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const monthlyDc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    const months = this.months;

    for (let i = 0; i < n; i++) {
      if (sunUp[i] === 0 || poa[i] <= 0.0) {
        dc[i] = 0.0;
        pac[i] = 0.0;
        continue;
      }

      const pDc = dcNameplate * (1.0 + gamma * (tCell[i] - 25.0)) * (tpoa[i] / 1000.0) * lossFactor;
      dc[i] = pDc > 0.0 ? pDc : 0.0;

      const plr = dc[i] / pdc0;
      let pAc = 0.0;
      if (plr > 0.0) {
        const eta = (A * plr + B / plr + C) * (etanom / etaref);
        pAc = dc[i] * eta;
        if (pAc > acNameplate) pAc = acNameplate;
        if (pAc < 0.0) pAc = 0.0;
      }
      pac[i] = pAc;

      const m = months[i];
      monthlyAc[m] += pAc;
      monthlyPoa[m] += poa[i];
      monthlyDc[m] += dc[i];

      totalAcWattHours += pAc;
      totalPoaWattHours += poa[i];
    }

    const annualAcKwh = totalAcWattHours / 1000.0;
    const annualSolrad = (totalPoaWattHours / 1000.0) / 365.0;
    const capacityFactor = (annualAcKwh / (systemCapacityKw * 8760.0)) * 100.0;
    const kwhPerKw = annualAcKwh / Math.max(0.001, systemCapacityKw);

    const monthlyAcKwh = monthlyAc.map(v => Math.round((v / 1000.0) * 10) / 10);
    const monthlyDcKwh = monthlyDc.map(v => Math.round((v / 1000.0) * 10) / 10);
    const monthlySolrad = monthlyPoa.map((v, idx) => Math.round(((v / 1000.0) / MONTH_DAYS[idx]) * 100) / 100);

    return {
      annualAcKwh: Math.round(annualAcKwh * 100) / 100,
      annualSolrad: Math.round(annualSolrad * 100) / 100,
      capacityFactor: Math.round(capacityFactor * 10) / 10,
      kwhPerKw: Math.round(kwhPerKw * 10) / 10,
      monthlyAc: monthlyAcKwh,
      monthlySolrad: monthlySolrad,
      monthlyDc: monthlyDcKwh,
      monthNames: MONTH_NAMES,
      systemCapacityKw,
      tilt,
      azimuth,
      losses,
      moduleType,
      arrayType
    };
  }

  computeCellTemp(inoctC) {
    const n = this.n;
    const poa = this.poa;
    const tempAir = this.temp_air;
    const windSpeed = this.wind_speed;
    const tCell = this.t_cell;

    const boltz = 0.00000005669;
    const capo = 11000.0;
    const absorb = 0.83;
    const emmis = 0.84;
    const xlen = 0.5;
    const inoct = inoctC + 273.15;
    const height = 5.0;
    const dtime = 1.0;

    const windmd = 1.0;
    const tave = (inoct + 293.15) / 2.0;
    const denair = 0.003484 * 101325.0 / tave;
    const visair = 0.24237e-6 * (tave ** 0.76) / denair;
    const conair = 2.1695e-4 * (tave ** 0.84);
    const reynld = windmd * xlen / visair;
    const hforce = 0.8600 / Math.sqrt(reynld) * denair * windmd * 1007.0 / (0.71 ** 0.67);
    const grashf = 9.8 / tave * (inoct - 293.15) * (xlen ** 3.0) / (visair * visair) * 0.5;
    const hfree = 0.21 * ((grashf * 0.71) ** 0.32) * conair / xlen;
    const hconvInit = (hfree ** 3.0 + hforce ** 3.0) ** (1.0 / 3.0);

    const hgrnd = emmis * boltz * (inoct * inoct + 293.15 * 293.15) * (inoct + 293.15);
    const backrt = (absorb * 800.0 - emmis * boltz * (inoct ** 4.0 - 282.21 ** 4.0) - hconvInit * (inoct - 293.15)) / ((hgrnd + hconvInit) * (inoct - 293.15));
    let tgrnd = (inoct ** 4.0 - backrt * (inoct ** 4.0 - 293.15 ** 4.0)) ** 0.25;
    if (tgrnd > inoct) tgrnd = inoct;
    if (tgrnd < 293.15) tgrnd = 293.15;

    const tgrat = (tgrnd - 293.15) / (inoct - 293.15);
    const convrt = (absorb * 800.0 - emmis * boltz * (2.0 * (inoct ** 4.0) - 282.21 ** 4.0 - tgrnd ** 4.0)) / (hconvInit * (inoct - 293.15));
    const cap = inoct > 321.15 ? capo * (1.0 + (inoct - 321.15) / 12.0) : capo;

    let tmodo = 293.15;
    let suno = 0.0;

    for (let i = 0; i < n; i++) {
      const p = poa[i];
      const ta = tempAir[i];
      const ws = windSpeed[i];

      if (p > 0.0) {
        const tamb = ta + 273.15;
        const suun = p * absorb;
        const tsky = 0.68 * (0.0552 * (tamb ** 1.5)) + 0.32 * tamb;
        const wmd = ws * ((height / 9.144) ** 0.2) + 0.0001;
        let tmod = tmodo;

        for (let iter = 0; iter < 10; iter++) {
          const taveIter = (tmod + tamb) / 2.0;
          const denairIter = 0.003484 * 101325.0 / taveIter;
          const visairIter = 0.24237e-6 * (taveIter ** 0.76) / denairIter;
          const conairIter = 2.1695e-4 * (taveIter ** 0.84);
          const reynldIter = wmd * xlen / visairIter;

          let hforceIter;
          if (reynldIter > 1.2e5) {
            hforceIter = 0.0282 / (reynldIter ** 0.2) * denairIter * wmd * 1007.0 / (0.71 ** 0.4);
          } else {
            hforceIter = 0.8600 / Math.sqrt(reynldIter) * denairIter * wmd * 1007.0 / (0.71 ** 0.67);
          }
          const grashfIter = 9.8 / taveIter * Math.abs(tmod - tamb) * (xlen ** 3.0) / (visairIter * visairIter) * 0.5;
          const hfreeIter = 0.21 * ((grashfIter * 0.71) ** 0.32) * conairIter / xlen;
          const hconv = convrt * ((hfreeIter ** 3.0 + hforceIter ** 3.0) ** (1.0 / 3.0));

          const hskyIter = emmis * boltz * (tmod * tmod + tsky * tsky) * (tmod + tsky);
          const tgrndIter = tamb + tgrat * (tmod - tamb);
          const hgrndIter = emmis * boltz * (tmod * tmod + tgrndIter * tgrndIter) * (tmod + tgrndIter);
          const eigen = -(hconv + hskyIter + hgrndIter) / cap * dtime * 3600.0;
          const ex = eigen > -10.0 ? Math.exp(eigen) : 0.0;

          tmod = tmodo * ex + ((1.0 - ex) * (hconv * tamb + hskyIter * tsky + hgrndIter * tgrndIter + suno + (suun - suno) / eigen) + suun - suno) / (hconv + hskyIter + hgrndIter);
        }

        tmodo = tmod;
        suno = suun;
        tCell[i] = tmod - 273.15;
      } else {
        tmodo = ta + 273.15;
        suno = 0.0;
        tCell[i] = ta;
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PVWattsEngineJS };
}
