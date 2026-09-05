/**
 * PVWatts Studio - Main Frontend Application Logic
 */

// Default coordinates used until the user selects another location.
const DEFAULT_LOCATION = {
  name: 'Renton, WA',
  lat: 47.491,
  lon: -122.216
};

let currentLocation = { ...DEFAULT_LOCATION };
let currentResult = null;
let simulationTimer = null;
let simulationController = null;
let simulationSequence = 0;

// Chart instances
let chartMonthlyAc = null;
let chartMonthlySolrad = null;
let chartSweep = null;

// Official UMass Lowell palette used by canvas-rendered Chart.js elements.
const UML_COLORS = Object.freeze({
  blue: '#1257D1',
  black: '#000000',
  darkBlue: '#00396E',
  lightBlue: '#5ADBFF',
  gray: '#878A8F',
  brightBlue: '#00B5F1',
  green: '#3BD5AE',
  aqua: '#62DAFC',
  yellow: '#FFD140',
  orange: '#FB471F',
  fern: '#027669',
  river: '#4295A9',
  gold: '#D0AF22',
  maroon: '#9E3124',
  textPrimary: '#F7FBFF',
  textSecondary: '#B8C7D5',
  gridLine: 'rgba(90, 219, 255, 0.16)',
  tooltipBackground: '#001C36',
  tooltipBorder: 'rgba(90, 219, 255, 0.34)'
});

// Seven sweep series use the most distinguishable UML accents on the dark canvas.
const PARAMETRIC_COLORS = Object.freeze([
  UML_COLORS.green,
  UML_COLORS.aqua,
  UML_COLORS.yellow,
  UML_COLORS.orange,
  UML_COLORS.fern,
  UML_COLORS.river,
  UML_COLORS.gold
]);

function formatDecimal(value, maximumFractionDigits = 3, minimumFractionDigits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
}

function initCopyButtons() {
  document.querySelectorAll('.copy-output-btn').forEach(button => {
    button.dataset.defaultTitle = button.title;
    button.dataset.defaultLabel = button.getAttribute('aria-label') || 'Copy calculated output';
    button.addEventListener('click', copyCalculatedOutput);
  });
}

async function copyCalculatedOutput(event) {
  const button = event.currentTarget;
  const target = document.getElementById(button.dataset.copyTarget);
  const value = target?.textContent.trim();
  if (!value || value === '—') {
    showToast('No calculated value is available to copy yet.', 'error');
    return;
  }

  const text = value;
  try {
    await writeClipboardText(text);
    button.classList.add('copied');
    button.title = 'Copied to clipboard';
    button.setAttribute('aria-label', `Copied ${text} to clipboard`);
    clearTimeout(button.copyFeedbackTimer);
    button.copyFeedbackTimer = setTimeout(() => {
      button.classList.remove('copied');
      button.title = button.dataset.defaultTitle;
      button.setAttribute('aria-label', button.dataset.defaultLabel);
    }, 1600);
    showToast(`Copied ${text}`);
  } catch (error) {
    console.error('Could not copy calculated output:', error);
    showToast('Could not copy the calculated value. Check browser permissions.', 'error');
  }
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_error) {
      // Fall through to the older textarea-based clipboard API.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard copy command was rejected');
}

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initControls();
  initLocationSearch();
  initCharts();
  initCopyButtons();
  updateLocationLabels();
  await updateSimulation();
});

// Tab Navigation
function initTabs() {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
}

async function readApiResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }
  if (!response.ok) {
    const error = new Error(payload.error || `Server returned HTTP ${response.status}`);
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function getApiRequestHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = document.getElementById('input-api-key')?.value.trim();
  if (apiKey) headers['X-NLR-API-Key'] = apiKey;
  return headers;
}

function initLocationSearch() {
  const input = document.getElementById('input-location');
  const button = document.getElementById('btn-search-location');
  const results = document.getElementById('location-results');

  button.addEventListener('click', searchLocation);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchLocation();
    } else if (event.key === 'Escape') {
      results.hidden = true;
    }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.location-picker')) results.hidden = true;
  });
}

async function searchLocation() {
  const input = document.getElementById('input-location');
  const button = document.getElementById('btn-search-location');
  const status = document.getElementById('location-search-status');
  const resultsBox = document.getElementById('location-results');
  const query = input.value.trim();
  if (query.length < 2) {
    status.textContent = 'Enter at least two characters or a latitude, longitude pair.';
    return;
  }

  button.disabled = true;
  status.textContent = 'Searching…';
  resultsBox.hidden = true;
  try {
    const response = await fetch(`/api/locations?q=${encodeURIComponent(query)}`);
    const payload = await readApiResponse(response);
    renderLocationResults(payload.results || []);
    status.textContent = payload.results?.length
      ? 'Select the intended location below.'
      : 'No locations found. Try a more specific address or coordinates.';
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function renderLocationResults(locations) {
  const resultsBox = document.getElementById('location-results');
  resultsBox.replaceChildren();
  locations.forEach(location => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'location-result';
    button.setAttribute('role', 'option');

    const name = document.createElement('span');
    name.textContent = location.name;
    const coordinates = document.createElement('span');
    coordinates.className = 'location-result-coordinates';
    coordinates.textContent = `${Number(location.lat).toFixed(5)}, ${Number(location.lon).toFixed(5)}`;
    button.append(name, coordinates);
    button.addEventListener('click', () => selectLocation(location));
    resultsBox.appendChild(button);
  });
  resultsBox.hidden = locations.length === 0;
}

function selectLocation(location) {
  currentLocation = {
    name: location.name,
    lat: Number(location.lat),
    lon: Number(location.lon)
  };
  document.getElementById('input-location').value = location.name;
  document.getElementById('location-results').hidden = true;
  document.getElementById('location-search-status').textContent = 'Location selected.';
  updateLocationLabels();
  scheduleSimulation(true);
}

function updateLocationLabels(result = currentResult) {
  const selected = document.getElementById('selected-location');
  if (selected) {
    selected.textContent = `${currentLocation.name} (${currentLocation.lat.toFixed(5)}, ${currentLocation.lon.toFixed(5)})`;
  }

  const label = document.getElementById('location-badge-label');
  if (!label) return;
  const station = result?.stationInfo;
  const source = station?.weather_data_source || 'current NSRDB data';
  label.textContent = `${currentLocation.name} · ${source}`;
}

// Controls & Sliders Wiring
function initControls() {
  const syncInputs = (sliderId, numId, badgeId, formatter, callback) => {
    const slider = document.getElementById(sliderId);
    const num = document.getElementById(numId);
    const badge = document.getElementById(badgeId);

    const onVal = (val, source) => {
      const numericValue = Number(val);
      // Number inputs can be temporarily empty while a decimal is being typed.
      // Leave that in-progress value alone instead of replacing it or simulating
      // with NaN; the next valid input event will synchronize both controls.
      if (String(val).trim() === '' || !Number.isFinite(numericValue)) return;
      if (source !== slider) slider.value = val;
      if (source !== num) num.value = val;
      if (badge) badge.textContent = formatter(numericValue);
      if (callback) callback(numericValue);
      scheduleSimulation();
    };

    slider.addEventListener('input', (event) => onVal(event.target.value, slider));
    num.addEventListener('input', (event) => onVal(event.target.value, num));
  };

  syncInputs('slider-capacity', 'num-capacity', 'badge-capacity', v => `${formatDecimal(v)} kW`);
  syncInputs('slider-losses', 'num-losses', 'badge-losses', v => `${formatDecimal(v)} %`);

  syncInputs('slider-tilt', 'num-tilt', 'badge-tilt', v => `${formatDecimal(v)} °`, v => {
    updateTiltVisual(v);
  });

  syncInputs('slider-azimuth', 'num-azimuth', 'badge-azimuth', v => {
    const deg = Number(v);
    let card = '';
    if (deg >= 337.5 || deg < 22.5) card = 'N';
    else if (deg < 67.5) card = 'NE';
    else if (deg < 112.5) card = 'E';
    else if (deg < 157.5) card = 'SE';
    else if (deg < 202.5) card = 'S';
    else if (deg < 247.5) card = 'SW';
    else if (deg < 292.5) card = 'W';
    else card = 'NW';
    return `${formatDecimal(deg)} ° (${card})`;
  }, v => {
    updateCompassVisual(v);
  });

  const apiKeyInput = document.getElementById('input-api-key');
  apiKeyInput.addEventListener('change', () => scheduleSimulation(true));
  apiKeyInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      scheduleSimulation(true);
    }
  });

  document.getElementById('select-module-type').addEventListener('change', () => scheduleSimulation(true));
  document.getElementById('select-array-type').addEventListener('change', () => scheduleSimulation(true));

  const albedoMode = document.getElementById('select-albedo-mode');
  const customAlbedoField = document.getElementById('custom-albedo-field');
  const customAlbedoInput = document.getElementById('input-albedo');
  const bifacialSelect = document.getElementById('select-bifacial');
  const bifacialityInput = document.getElementById('input-bifaciality');
  const updateAdvancedAvailability = () => {
    const customAlbedo = albedoMode.value === 'custom';
    customAlbedoField.hidden = !customAlbedo;
    customAlbedoInput.disabled = !customAlbedo;
    bifacialityInput.disabled = bifacialSelect.value !== 'yes';
  };

  albedoMode.addEventListener('change', () => {
    updateAdvancedAvailability();
    scheduleSimulation(true);
  });
  bifacialSelect.addEventListener('change', () => {
    updateAdvancedAvailability();
    scheduleSimulation(true);
  });
  [
    'input-dc-ac-ratio',
    'input-inv-eff',
    'input-gcr',
    'input-albedo',
    'input-bifaciality'
  ].forEach(id => document.getElementById(id).addEventListener('input', () => scheduleSimulation()));
  document.querySelectorAll('.monthly-loss-input').forEach(input => {
    input.addEventListener('input', () => scheduleSimulation());
  });
  updateAdvancedAvailability();

  document.getElementById('btn-reset-defaults').addEventListener('click', () => {
    document.getElementById('slider-capacity').value = 4.0;
    document.getElementById('num-capacity').value = 4.0;
    document.getElementById('badge-capacity').textContent = '4.0 kW';

    document.getElementById('select-module-type').value = '0';
    document.getElementById('select-array-type').value = '0';

    document.getElementById('slider-losses').value = 14.08;
    document.getElementById('num-losses').value = 14.08;
    document.getElementById('badge-losses').textContent = '14.08 %';

    document.getElementById('slider-tilt').value = 20;
    document.getElementById('num-tilt').value = 20;
    document.getElementById('badge-tilt').textContent = '20 °';
    updateTiltVisual(20);

    document.getElementById('slider-azimuth').value = 180;
    document.getElementById('num-azimuth').value = 180;
    document.getElementById('badge-azimuth').textContent = '180 ° (S)';
    updateCompassVisual(180);

    document.getElementById('input-dc-ac-ratio').value = 1.2;
    document.getElementById('input-inv-eff').value = 96.0;
    document.getElementById('input-gcr').value = 0.4;
    document.getElementById('select-albedo-mode').value = 'weather';
    document.getElementById('custom-albedo-field').hidden = true;
    document.getElementById('input-albedo').value = 0.2;
    document.getElementById('input-albedo').disabled = true;
    document.getElementById('select-bifacial').value = 'no';
    document.getElementById('input-bifaciality').value = 0.7;
    document.getElementById('input-bifaciality').disabled = true;
    document.querySelectorAll('.monthly-loss-input').forEach(input => { input.value = 0; });

    scheduleSimulation(true);
    showToast('Reset parameters to standard defaults');
  });

  document.getElementById('btn-run-sweep').addEventListener('click', runParametricSweep);

  document.getElementById('btn-export-json').addEventListener('click', exportJson);
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
}

// Visual updates for Compass Dial and Roof Pitch
function updateCompassVisual(azDeg) {
  const needle = document.getElementById('compass-needle');
  const label = document.getElementById('compass-deg-label');
  if (needle) needle.style.transform = `rotate(${azDeg}deg)`;
  if (label) label.textContent = `${formatDecimal(azDeg)}° Azimuth`;
}

function updateTiltVisual(tiltDeg) {
  const line = document.getElementById('roof-line');
  const label = document.getElementById('tilt-deg-label');
  if (line) line.style.transform = `rotate(-${tiltDeg}deg)`;
  if (label) label.textContent = `${formatDecimal(tiltDeg)}° Tilt`;
}

function readNumber(id, fallback) {
  const rawValue = document.getElementById(id).value.trim();
  if (rawValue === '') return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

// Read current UI parameters. Explicit finite checks preserve valid zeroes for
// losses, tilt, azimuth, and the open-rack array type.
function getParams() {
  const useWeatherFileAlbedo = document.getElementById('select-albedo-mode').value === 'weather';
  const bifacial = document.getElementById('select-bifacial').value === 'yes';
  const monthlyIrradianceLosses = Array.from(
    document.querySelectorAll('.monthly-loss-input'),
    input => {
      const value = Number(input.value);
      return Number.isFinite(value) ? value : 0;
    }
  );
  const params = {
    systemCapacityKw: readNumber('num-capacity', 4.0),
    moduleType: readNumber('select-module-type', 0),
    arrayType: readNumber('select-array-type', 0),
    losses: readNumber('num-losses', 14.08),
    tilt: readNumber('num-tilt', 20.0),
    azimuth: readNumber('num-azimuth', 180.0),
    dcAcRatio: readNumber('input-dc-ac-ratio', 1.2),
    invEff: readNumber('input-inv-eff', 96.0),
    groundCoverageRatio: readNumber('input-gcr', 0.4),
    useWeatherFileAlbedo,
    bifaciality: bifacial ? readNumber('input-bifaciality', 0.7) : 0,
    monthlyIrradianceLosses,
    lat: currentLocation.lat,
    lon: currentLocation.lon
  };
  if (!useWeatherFileAlbedo) params.albedo = readNumber('input-albedo', 0.2);
  return params;
}

function scheduleSimulation(immediate = false) {
  clearTimeout(simulationTimer);
  if (simulationController) simulationController.abort();
  simulationSequence += 1;
  currentResult = null;
  simulationTimer = setTimeout(updateSimulation, immediate ? 0 : 450);
}

function setSimulationStatus(message, type = '') {
  const status = document.getElementById('simulation-status');
  status.textContent = message;
  status.className = `simulation-status${type ? ` ${type}` : ''}`;
}

// Calculate through the official PVWatts v8 API. Requests are debounced and
// stale requests are aborted so dragging a slider cannot overwrite newer data.
async function updateSimulation() {
  clearTimeout(simulationTimer);
  if (simulationController) simulationController.abort();
  simulationController = new AbortController();
  const sequence = ++simulationSequence;
  const params = getParams();
  setSimulationStatus('Calculating with official PVWatts v8 and current NSRDB data…');

  try {
    const response = await fetch('/api/simulate', {
      method: 'POST',
      headers: getApiRequestHeaders(),
      body: JSON.stringify(params),
      signal: simulationController.signal
    });
    const result = await readApiResponse(response);
    if (sequence !== simulationSequence) return;
    currentResult = result;
    renderSimulation(result);
    updateLocationLabels(result);

    const station = result.stationInfo || {};
    const grid = Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lon))
      ? ` · NSRDB grid ${Number(station.lat).toFixed(2)}, ${Number(station.lon).toFixed(2)}`
      : '';
    setSimulationStatus(`${result.model} · ${result.version}${grid}`, 'success');
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== simulationSequence) return;
    console.error('PVWatts simulation failed:', error);
    setSimulationStatus(error.message, 'error');
    showToast(error.message, 'error');
  }
}

function renderSimulation(res) {
  document.getElementById('kpi-ac-annual').textContent = Math.round(res.annualAcKwh).toLocaleString();
  document.getElementById('kpi-solrad-annual').textContent = res.annualSolrad.toFixed(2);
  document.getElementById('kpi-capacity-factor').textContent = res.capacityFactor.toFixed(1);
  document.getElementById('kpi-yield').textContent = Math.round(res.kwhPerKw).toLocaleString();

  if (chartMonthlyAc) {
    chartMonthlyAc.data.datasets[0].data = res.monthlyAc;
    chartMonthlyAc.update('none');
  }
  renderMonthlySolarRadiationChart(res);

  const tbody = document.getElementById('tbody-monthly');
  if (tbody) {
    const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let rowsHtml = '';
    let totalPoaKwh = 0;
    let totalDc = 0;

    for (let month = 0; month < 12; month++) {
      const solrad = res.monthlySolrad[month];
      const poaM2 = res.monthlyPoa?.[month] ?? (solrad * monthDays[month]);
      totalPoaKwh += poaM2;
      totalDc += res.monthlyDc[month];
      rowsHtml += `
        <tr>
          <td>${res.monthNames[month]}</td>
          <td>${solrad.toFixed(2)}</td>
          <td>${poaM2.toFixed(1)}</td>
          <td>${res.monthlyDc[month].toFixed(1)}</td>
          <td style="color:var(--accent-solar); font-weight:700;">${res.monthlyAc[month].toFixed(1)}</td>
        </tr>
      `;
    }
    tbody.innerHTML = rowsHtml;

    const tfoot = document.getElementById('tfoot-annual');
    if (tfoot) {
      tfoot.innerHTML = `
        <td>Annual Total / Avg</td>
        <td>${res.annualSolrad.toFixed(2)}</td>
        <td>${totalPoaKwh.toFixed(1)}</td>
        <td>${totalDc.toFixed(1)}</td>
        <td style="color:var(--accent-solar); font-weight:800;">${Math.round(res.annualAcKwh).toLocaleString()}</td>
      `;
    }
  }
}

function renderMonthlySolarRadiationChart(res) {
  const canvas = document.getElementById('chart-monthly-solrad');
  const values = Array.isArray(res.monthlySolrad) ? res.monthlySolrad.map(Number) : [];
  if (!canvas || values.length !== 12 || values.some(value => !Number.isFinite(value))) {
    console.error('PVWatts returned invalid monthly solar radiation data:', res.monthlySolrad);
    return;
  }

  // Build this chart from the completed API response instead of initializing it
  // with an empty dataset. This avoids Chart.js retaining its empty 0–1 scale.
  if (chartMonthlySolrad) chartMonthlySolrad.destroy();
  chartMonthlySolrad = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: Array.isArray(res.monthNames) && res.monthNames.length === 12
        ? res.monthNames
        : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      datasets: [{
        label: 'Solar Rad (kWh/m²/day)',
        data: values,
        borderColor: UML_COLORS.brightBlue,
        backgroundColor: 'rgba(0, 181, 241, 0.15)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: UML_COLORS.brightBlue,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: UML_COLORS.tooltipBackground,
          titleColor: UML_COLORS.textPrimary,
          bodyColor: UML_COLORS.brightBlue,
          borderColor: UML_COLORS.tooltipBorder,
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: UML_COLORS.textSecondary }
        },
        y: {
          beginAtZero: true,
          grid: { color: UML_COLORS.gridLine },
          ticks: { color: UML_COLORS.textSecondary },
          title: { display: true, text: 'kWh/m²/day', color: UML_COLORS.textSecondary }
        }
      }
    }
  });
}

// Initialize charts that do not need response-specific construction.
function initCharts() {
  const ctxAc = document.getElementById('chart-monthly-ac')?.getContext('2d');
  if (ctxAc) {
    chartMonthlyAc = new Chart(ctxAc, {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        datasets: [{
          label: 'AC Energy (kWh)',
          data: [],
          backgroundColor: 'rgba(255, 209, 64, 0.72)',
          borderColor: UML_COLORS.yellow,
          borderWidth: 1.5,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: UML_COLORS.tooltipBackground,
            titleColor: UML_COLORS.textPrimary,
            bodyColor: UML_COLORS.yellow,
            borderColor: UML_COLORS.tooltipBorder,
            borderWidth: 1
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: UML_COLORS.textSecondary }
          },
          y: {
            grid: { color: UML_COLORS.gridLine },
            ticks: { color: UML_COLORS.textSecondary },
            title: { display: true, text: 'kWh', color: UML_COLORS.textSecondary }
          }
        }
      }
    });
  }
}

async function simulateBatch(requests, shared) {
  const response = await fetch('/api/simulate-batch', {
    method: 'POST',
    headers: getApiRequestHeaders(),
    body: JSON.stringify({ requests, shared })
  });
  const payload = await readApiResponse(response);
  return payload.results;
}

// 2D Parametric Sweep
async function runParametricSweep() {
  const button = document.getElementById('btn-run-sweep');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Running 77 official simulations…';

  const tilts = [0, 10, 20, 30, 35, 40, 50, 60, 70, 80, 90];
  const azs = [90, 120, 150, 180, 210, 240, 270];
  const currentParams = getParams();
  const requests = azs.flatMap(azimuth => tilts.map(tilt => ({
    systemCapacityKw: 6,
    losses: 11,
    tilt,
    azimuth
  })));
  const shared = {
    lat: currentLocation.lat,
    lon: currentLocation.lon,
    moduleType: currentParams.moduleType,
    arrayType: currentParams.arrayType,
    dcAcRatio: currentParams.dcAcRatio,
    invEff: currentParams.invEff,
    groundCoverageRatio: currentParams.groundCoverageRatio,
    useWeatherFileAlbedo: currentParams.useWeatherFileAlbedo,
    bifaciality: currentParams.bifaciality,
    monthlyIrradianceLosses: currentParams.monthlyIrradianceLosses
  };
  if (!currentParams.useWeatherFileAlbedo) shared.albedo = currentParams.albedo;

  let sweepResults;
  try {
    sweepResults = await simulateBatch(requests, shared);
  } catch (error) {
    showToast(`Sweep failed: ${error.message}`, 'error');
    return;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }

  let resultIndex = 0;
  const colorList = PARAMETRIC_COLORS;
  const datasets = azs.map((azimuth, index) => ({
    label: `Azimuth ${azimuth}°`,
    data: tilts.map(() => Math.round(sweepResults[resultIndex++].annualAcKwh)),
    borderColor: colorList[index % colorList.length],
    backgroundColor: colorList[index % colorList.length],
    borderWidth: 2,
    tension: 0.3
  }));
  showToast('Computed 77 simulations with official PVWatts v8.');

  const ctx = document.getElementById('chart-sweep')?.getContext('2d');
  if (ctx) {
    if (chartSweep) chartSweep.destroy();
    chartSweep = new Chart(ctx, {
      type: 'line',
      data: {
        labels: tilts.map(t => `${t}° Tilt`),
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { color: UML_COLORS.textSecondary } }
        },
        scales: {
          x: { grid: { color: UML_COLORS.gridLine }, ticks: { color: UML_COLORS.textSecondary } },
          y: { grid: { color: UML_COLORS.gridLine }, ticks: { color: UML_COLORS.textSecondary }, title: { display: true, text: 'Annual AC (kWh)', color: UML_COLORS.textSecondary } }
        }
      }
    });
  }
}

// Export JSON
function exportJson() {
  if (!currentResult) {
    showToast('Wait for a successful PVWatts calculation before exporting.', 'error');
    return;
  }
  const params = getParams();
  const data = {
    location: currentLocation,
    station: currentResult.stationInfo,
    model: currentResult.model,
    parameters: params,
    results: currentResult,
    timestamp: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pvwatts_results_${params.systemCapacityKw}kW.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Export CSV
function exportCsv() {
  if (!currentResult) {
    showToast('Wait for a successful PVWatts calculation before exporting.', 'error');
    return;
  }
  const params = getParams();
  const res = currentResult;
  let csv = 'Month,Solar Radiation (kWh/m2/day),AC Energy (kWh),DC Energy (kWh)\n';
  for (let m = 0; m < 12; m++) {
    csv += `${res.monthNames[m]},${res.monthlySolrad[m]},${res.monthlyAc[m]},${res.monthlyDc[m]}\n`;
  }
  csv += `Annual,${res.annualSolrad},${res.annualAcKwh},${res.kwhPerKw}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pvwatts_monthly_${params.systemCapacityKw}kW.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Toast Helper
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
