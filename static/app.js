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
let sweepController = null;
let sweepInProgress = false;
let optimizerController = null;
let optimizerInProgress = false;
let optimizerResult = null;
let optimizerMessage = '';
let scheduleController = null;
let selectedScheduleIndex = 1;

const pvwattsClient = new PVWatts.PVWattsClient();

const SWEEP_CHUNK_SIZE = 7;

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Chart instances
let chartMonthlyAc = null;
let chartMonthlySolrad = null;
let chartSweep = null;
let chartSeasonal = null;

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
    button.dataset.defaultLabel = button.getAttribute('aria-label') || 'Copy calculated output';
    button.dataset.defaultTitle = button.dataset.defaultLabel;
    button.addEventListener('click', copyCalculatedOutput);
  });
}

function setResultActionsEnabled(enabled) {
  document.querySelectorAll('.copy-output-btn').forEach(button => {
    button.disabled = !enabled;
    button.title = enabled ? button.dataset.defaultTitle : 'Available after calculation';
  });
  ['btn-export-json', 'btn-export-csv'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = !enabled;
  });
}

function clearDisplayedResults() {
  ['kpi-ac-annual', 'kpi-solrad-annual', 'kpi-capacity-factor', 'kpi-yield', 'mobile-kpi-ac'].forEach(id => {
    const output = document.getElementById(id);
    if (output) output.textContent = '—';
  });
  document.getElementById('tbody-monthly')?.replaceChildren();
  document.getElementById('tfoot-annual')?.replaceChildren();
  if (chartMonthlyAc) {
    chartMonthlyAc.data.datasets[0].data = [];
    chartMonthlyAc.update('none');
  }
  if (chartMonthlySolrad) {
    chartMonthlySolrad.destroy();
    chartMonthlySolrad = null;
  }
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
  await navigator.clipboard.writeText(text);
}

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initControls();
  initLocationSearch();
  initCharts();
  initCopyButtons();
  setResultActionsEnabled(false);
  updateLocationLabels();
  updateSweepAssumptions();
  await updateSimulation();
});

// Tab Navigation
// The selected tab is kept in the ?tab= query parameter so a refresh (or a
// shared link) reopens it. A query parameter survives the in-page #anchor
// links, which would overwrite a hash.
const TAB_QUERY_PARAM = 'tab';

function tabSlug(tab) {
  return tab.id.replace(/^tab-/, '');
}

function readTabFromUrl() {
  return new URLSearchParams(window.location.search).get(TAB_QUERY_PARAM);
}

function writeTabToUrl(tab, isDefault) {
  const url = new URL(window.location.href);
  if (isDefault) url.searchParams.delete(TAB_QUERY_PARAM);
  else url.searchParams.set(TAB_QUERY_PARAM, tabSlug(tab));
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
}

function initTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));

  const activateTab = (tab, moveFocus = false) => {
    const changed = tab.getAttribute('aria-selected') !== 'true';
    tabs.forEach(candidate => {
      const selected = candidate === tab;
      candidate.classList.toggle('active', selected);
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(candidate.getAttribute('aria-controls'));
      if (panel) {
        panel.hidden = !selected;
        panel.classList.toggle('active', selected);
      }
    });
    writeTabToUrl(tab, tab === tabs[0]);
    if (tab.id === 'tab-parametric') updateSweepAssumptions();
    // Panels with their own loader (Solar News) follow activation without
    // being coupled to this function.
    window.dispatchEvent(new CustomEvent('pvwatts:tabchange', { detail: { tab: tab.id } }));
    // Panels share one document scroll, so a new panel would otherwise open
    // at the previous panel's offset with its top hidden under the sticky
    // header. Start each newly selected panel from the top.
    if (changed) window.scrollTo({ top: 0, behavior: 'instant' });
    if (moveFocus) tab.focus({ preventScroll: true });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      let nextIndex;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      activateTab(tabs[nextIndex], true);
    });
  });

  const requestedTab = tabs.find(tab => tabSlug(tab) === readTabFromUrl());
  if (requestedTab && requestedTab.getAttribute('aria-selected') !== 'true') activateTab(requestedTab);
}

// The key is read at call time, never stored, and travels only in the
// api_key query parameter that PVWatts itself requires.
function getApiKey() {
  return document.getElementById('input-api-key')?.value.trim() || '';
}

// Climate dataset selected in Advanced model settings; TMY3 is the default.
function getSelectedDataset() {
  return document.getElementById('select-dataset')?.value || PVWatts.DEFAULT_DATASET;
}

function datasetLabel(dataset) {
  return PVWatts.DATASETS[dataset]?.label || PVWatts.DATASETS[PVWatts.DEFAULT_DATASET].label;
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
      input.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.location-picker')) {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
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
  button.setAttribute('aria-busy', 'true');
  status.textContent = 'Searching…';
  resultsBox.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  try {
    const results = await PVWatts.searchLocations(query);
    renderLocationResults(results);
    status.textContent = results.length
      ? 'Select the intended location below.'
      : 'No locations found. Try a more specific address or coordinates.';
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function renderLocationResults(locations) {
  const resultsBox = document.getElementById('location-results');
  resultsBox.replaceChildren();
  locations.forEach(location => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'location-result';

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
  document.getElementById('input-location').setAttribute('aria-expanded', String(locations.length > 0));
}

function selectLocation(location) {
  currentLocation = {
    name: location.name,
    lat: Number(location.lat),
    lon: Number(location.lon)
  };
  document.getElementById('input-location').value = location.name;
  document.getElementById('location-results').hidden = true;
  document.getElementById('input-location').setAttribute('aria-expanded', 'false');
  document.getElementById('location-search-status').textContent = 'Location selected. Recalculating the estimate.';
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
  const source = station?.weather_data_source || `${datasetLabel(result?.dataset || getSelectedDataset())} weather data`;
  label.textContent = `${currentLocation.name} · ${source}`;
  updateCompassMagnetic();
  updateSweepAssumptions();
}

function updateSweepAssumptions() {
  const size = document.getElementById('sweep-assumption-size');
  if (!size) return;
  const params = getParams();
  const moduleSelect = document.getElementById('select-module-type');
  const arraySelect = document.getElementById('select-array-type');
  document.getElementById('sweep-assumption-location').textContent = currentLocation.name;
  size.textContent = `${formatDecimal(params.systemCapacityKw)} kW DC`;
  document.getElementById('sweep-assumption-losses').textContent = `${formatDecimal(params.losses)}%`;
  document.getElementById('sweep-assumption-hardware').textContent = `${moduleSelect.selectedOptions[0].text} · ${arraySelect.selectedOptions[0].text}`;
  document.getElementById('sweep-assumption-details').textContent =
    `DC/AC ${formatDecimal(params.dcAcRatio)} · inverter ${formatDecimal(params.invEff)}% · GCR ${formatDecimal(params.groundCoverageRatio)} · ${datasetLabel(params.dataset)} weather. Only tilt and azimuth vary.`;
  document.getElementById('sweep-assumption-orientation').textContent =
    `${formatDecimal(params.tilt)}° tilt · ${formatDecimal(params.azimuth)}° azimuth`;
  updateOptimizerAvailability(params);
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
  document.getElementById('select-dataset').addEventListener('change', () => scheduleSimulation(true));

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
    // form.reset() would also clear the API key and revert the location text
    // behind the map picker, so preserve those two before resetting.
    const location = document.getElementById('input-location').value;
    const apiKey = document.getElementById('input-api-key').value;
    document.getElementById('system-parameters').reset();
    document.getElementById('input-location').value = location;
    document.getElementById('input-api-key').value = apiKey;

    document.getElementById('badge-capacity').textContent = '4.0 kW';
    document.getElementById('badge-losses').textContent = '14.08 %';
    document.getElementById('badge-tilt').textContent = '20 °';
    document.getElementById('badge-azimuth').textContent = '180 ° (S)';
    updateAdvancedAvailability();
    updateTiltVisual(20);
    updateCompassVisual(180);

    scheduleSimulation(true);
    showToast('Reset parameters to standard defaults');
  });

  const sweepAcknowledgement = document.getElementById('sweep-quota-ack');
  const sweepButton = document.getElementById('btn-run-sweep');
  sweepAcknowledgement.addEventListener('change', () => {
    sweepButton.disabled = !sweepAcknowledgement.checked || sweepInProgress;
    document.getElementById('sweep-guard-help').textContent = sweepAcknowledgement.checked
      ? 'Ready. You can cancel between request batches.'
      : 'Acknowledge the request count to enable the sweep.';
  });
  sweepButton.addEventListener('click', runParametricSweep);
  document.getElementById('btn-cancel-sweep').addEventListener('click', cancelParametricSweep);

  document.getElementById('btn-run-optimizer').addEventListener('click', runOrientationOptimizer);
  document.getElementById('btn-cancel-optimizer').addEventListener('click', cancelOrientationOptimizer);
  document.getElementById('btn-apply-optimum').addEventListener('click', applyOptimalOrientation);
  document.getElementById('btn-confirm-schedule').addEventListener('click', confirmTiltSchedule);
  document.getElementById('btn-cancel-schedule').addEventListener('click', cancelTiltScheduleCheck);
  initOrientationHeatmap();

  document.getElementById('btn-export-json').addEventListener('click', exportJson);
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
}

// Visual updates for Compass Dial and Roof Pitch
function updateCompassVisual(azDeg) {
  const needle = document.getElementById('compass-needle');
  const label = document.getElementById('compass-deg-label');
  if (needle) needle.style.transform = `rotate(${azDeg}deg)`;
  if (label) label.textContent = `${formatDecimal(azDeg)}° Azimuth`;
  updateCompassMagnetic(azDeg);
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
    dataset: getSelectedDataset(),
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

function validateSimulationInputs() {
  const fields = Array.from(document.querySelectorAll('.sidebar input[type="number"], .sidebar select'));
  fields.forEach(field => field.removeAttribute('aria-invalid'));
  const invalid = fields.find(field => !field.disabled && !field.checkValidity());
  if (!invalid) return true;

  invalid.setAttribute('aria-invalid', 'true');
  const label = document.querySelector(`label[for="${invalid.id}"]`);
  const name = label?.textContent.trim() || 'highlighted input';
  setSimulationStatus(`Check ${name}: ${invalid.validationMessage}`, 'error');
  return false;
}

function scheduleSimulation(immediate = false) {
  clearTimeout(simulationTimer);
  if (simulationController) simulationController.abort();
  simulationSequence += 1;
  currentResult = null;
  setResultActionsEnabled(false);
  const resultsArea = document.querySelector('.results-area');
  if (resultsArea) {
    resultsArea.classList.add('is-updating');
    resultsArea.setAttribute('aria-busy', 'true');
  }
  updateSweepAssumptions();
  setSimulationStatus('Inputs changed. Recalculating automatically…');
  simulationTimer = setTimeout(updateSimulation, immediate ? 0 : 450);
}

function setSimulationStatus(message, type = '', emphasis = '') {
  const status = document.getElementById('simulation-status');
  status.replaceChildren(message);
  if (emphasis) {
    const strong = document.createElement('strong');
    strong.textContent = emphasis;
    status.appendChild(strong);
  }
  status.className = `simulation-status${type ? ` ${type}` : ''}`;
  const mobileStatus = document.getElementById('mobile-estimate-status');
  if (mobileStatus) mobileStatus.textContent = `${message}${emphasis}`;
}

// Calculate through the official PVWatts v8 API. Requests are debounced and
// stale requests are aborted so dragging a slider cannot overwrite newer data.
async function updateSimulation() {
  clearTimeout(simulationTimer);
  if (!validateSimulationInputs()) {
    currentResult = null;
    setResultActionsEnabled(false);
    clearDisplayedResults();
    const invalidResultsArea = document.querySelector('.results-area');
    if (invalidResultsArea) {
      invalidResultsArea.classList.remove('is-updating');
      invalidResultsArea.setAttribute('aria-busy', 'false');
    }
    return;
  }
  if (simulationController) simulationController.abort();
  simulationController = new AbortController();
  const sequence = ++simulationSequence;
  const params = getParams();
  const resultsArea = document.querySelector('.results-area');
  if (resultsArea) resultsArea.setAttribute('aria-busy', 'true');
  setSimulationStatus(`Calculating with official PVWatts v8 and ${datasetLabel(params.dataset)} data…`);

  try {
    const result = await pvwattsClient.simulate(params, {
      apiKey: getApiKey(),
      signal: simulationController.signal
    });
    if (sequence !== simulationSequence) return;
    currentResult = result;
    renderSimulation(result);
    resultsArea?.classList.remove('is-updating');
    setResultActionsEnabled(true);
    updateLocationLabels(result);

    // The active weather dataset and station are emphasized so the data behind
    // the estimate is visible at a glance, not buried in the status line.
    const station = result.stationInfo || {};
    const grid = Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lon))
      ? `${datasetLabel(result.dataset)} grid ${Number(station.lat).toFixed(2)}, ${Number(station.lon).toFixed(2)}`
      : `${datasetLabel(result.dataset)} weather data`;
    setSimulationStatus(`${result.model} · ${result.version} · `, 'success', grid);
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== simulationSequence) return;
    console.error('PVWatts simulation failed:', error);
    const message = error.message;
    currentResult = null;
    setResultActionsEnabled(false);
    clearDisplayedResults();
    resultsArea?.classList.remove('is-updating');
    setSimulationStatus(message, 'error');
    showToast(message, 'error');
  } finally {
    if (sequence === simulationSequence && resultsArea) resultsArea.setAttribute('aria-busy', 'false');
  }
}

function renderSimulation(res) {
  const annualAc = Math.round(res.annualAcKwh).toLocaleString();
  document.getElementById('kpi-ac-annual').textContent = annualAc;
  document.getElementById('mobile-kpi-ac').textContent = annualAc;
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
    let rowsHtml = '';
    let totalPoaKwh = 0;
    let totalDc = 0;

    for (let month = 0; month < 12; month++) {
      const solrad = res.monthlySolrad[month];
      const poaM2 = res.monthlyPoa?.[month] ?? (solrad * MONTH_DAYS[month]);
      totalPoaKwh += poaM2;
      totalDc += res.monthlyDc[month];
      rowsHtml += `
        <tr>
          <th scope="row">${res.monthNames[month]}</th>
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
        <th scope="row">Annual total / average</th>
        <td>${res.annualSolrad.toFixed(2)}</td>
        <td>${totalPoaKwh.toFixed(1)}</td>
        <td>${totalDc.toFixed(1)}</td>
        <td style="color:var(--accent-solar); font-weight:800;">${Math.round(res.annualAcKwh).toLocaleString()}</td>
      `;
    }
  }
}

function showChartFallback(canvasId) {
  const canvas = document.getElementById(canvasId);
  const fallback = document.getElementById(`${canvasId}-fallback`);
  if (canvas) canvas.hidden = true;
  if (fallback) fallback.hidden = false;
}

function renderMonthlySolarRadiationChart(res) {
  const canvas = document.getElementById('chart-monthly-solrad');
  if (typeof Chart === 'undefined') {
    showChartFallback('chart-monthly-solrad');
    return;
  }
  if (canvas) canvas.hidden = false;
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
  if (typeof Chart === 'undefined') {
    showChartFallback('chart-monthly-ac');
    showChartFallback('chart-monthly-solrad');
    return;
  }
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

// Requests run one at a time so a cancelled sweep stops promptly and the
// shared PVWatts rate limit is not hit with a burst of parallel calls.
async function simulateBatch(requests, shared, signal) {
  const apiKey = getApiKey();
  const results = [];
  for (const request of requests) {
    if (signal.aborted) throw new DOMException('Sweep cancelled', 'AbortError');
    results.push(await pvwattsClient.simulate({ ...shared, ...request }, { apiKey, signal }));
  }
  return results;
}

function setSweepLoading(visible, status, detail, completed = 0) {
  const container = document.getElementById('sweep-chart-container');
  const loading = document.getElementById('sweep-loading');
  const statusElement = document.getElementById('sweep-status');
  const detailElement = document.getElementById('sweep-status-detail');
  const progress = document.getElementById('sweep-progress');
  const progressLabel = document.getElementById('sweep-progress-label');

  if (!container || !loading || !statusElement || !detailElement || !progress || !progressLabel) return;
  container.setAttribute('aria-busy', String(visible));
  loading.hidden = !visible;
  if (!visible) return;

  statusElement.textContent = status;
  detailElement.textContent = detail;
  if (Number.isFinite(completed)) {
    progress.value = completed;
    progress.textContent = `${completed} of ${progress.max}`;
    progressLabel.textContent = `${completed} / ${progress.max}`;
  } else {
    progress.removeAttribute('value');
    progress.textContent = 'Simulations in progress';
    progressLabel.textContent = 'In progress';
  }
}

function setSimulatorControlsForSweep(disabled) {
  document.querySelectorAll('.sidebar input, .sidebar select, .sidebar button').forEach(control => {
    if (disabled) {
      control.dataset.sweepWasDisabled = String(control.disabled);
      control.disabled = true;
    } else {
      control.disabled = control.dataset.sweepWasDisabled === 'true';
      delete control.dataset.sweepWasDisabled;
    }
  });
}

function cancelParametricSweep() {
  if (!sweepInProgress || !sweepController) return;
  const completed = Number(document.getElementById('sweep-progress').value) || 0;
  setSweepLoading(true, 'Cancelling comparison…', `Stopping after ${completed} completed simulations. No new batches will be sent.`, completed);
  sweepController.abort();
}

function renderSweepTable(tilts, azimuths, results) {
  const head = document.getElementById('sweep-table-head');
  const body = document.getElementById('sweep-table-body');
  const headerRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.scope = 'col';
  corner.textContent = 'Azimuth / tilt';
  headerRow.appendChild(corner);
  tilts.forEach(tilt => {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.textContent = `${tilt}°`;
    headerRow.appendChild(heading);
  });
  head.replaceChildren(headerRow);

  const rows = azimuths.map((azimuth, azimuthIndex) => {
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = `${azimuth}°`;
    row.appendChild(heading);
    tilts.forEach((_tilt, tiltIndex) => {
      const cell = document.createElement('td');
      const result = results[(azimuthIndex * tilts.length) + tiltIndex];
      cell.textContent = Math.round(result.annualAcKwh).toLocaleString();
      row.appendChild(cell);
    });
    return row;
  });
  body.replaceChildren(...rows);
  document.getElementById('sweep-data-panel').hidden = false;
}

function renderSweepChart(tilts, azimuths, sweepResults) {
  const canvas = document.getElementById('chart-sweep');
  const empty = document.getElementById('sweep-empty');
  renderSweepTable(tilts, azimuths, sweepResults);

  const values = sweepResults.map(result => Number(result.annualAcKwh));
  const bestIndex = values.indexOf(Math.max(...values));
  const bestAzimuth = azimuths[Math.floor(bestIndex / tilts.length)];
  const bestTilt = tilts[bestIndex % tilts.length];
  canvas.setAttribute('aria-label', `Line chart comparing annual AC energy by tilt and azimuth. Highest modeled result is ${formatDecimal(values[bestIndex], 0)} kilowatt-hours at ${bestTilt} degrees tilt and ${bestAzimuth} degrees azimuth.`);

  if (typeof Chart === 'undefined') {
    empty.hidden = false;
    empty.textContent = 'Chart rendering is unavailable. The complete comparison is available in the data table below.';
    canvas.hidden = true;
    return;
  }

  const datasets = azimuths.map((azimuth, azimuthIndex) => ({
    label: `Azimuth ${azimuth}°`,
    data: tilts.map((_tilt, tiltIndex) => Math.round(sweepResults[(azimuthIndex * tilts.length) + tiltIndex].annualAcKwh)),
    borderColor: PARAMETRIC_COLORS[azimuthIndex % PARAMETRIC_COLORS.length],
    backgroundColor: PARAMETRIC_COLORS[azimuthIndex % PARAMETRIC_COLORS.length],
    borderWidth: 2,
    pointRadius: 2.5,
    pointHoverRadius: 5,
    tension: 0.25
  }));

  if (chartSweep) chartSweep.destroy();
  canvas.hidden = false;
  empty.hidden = true;
  chartSweep = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: tilts.map(tilt => `${tilt}° tilt`), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: UML_COLORS.textSecondary, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          backgroundColor: UML_COLORS.tooltipBackground,
          titleColor: UML_COLORS.textPrimary,
          bodyColor: UML_COLORS.textPrimary,
          borderColor: UML_COLORS.tooltipBorder,
          borderWidth: 1
        }
      },
      scales: {
        x: { grid: { color: UML_COLORS.gridLine }, ticks: { color: UML_COLORS.textSecondary } },
        y: {
          grid: { color: UML_COLORS.gridLine },
          ticks: { color: UML_COLORS.textSecondary },
          title: { display: true, text: 'Annual AC energy (kWh)', color: UML_COLORS.textSecondary }
        }
      }
    }
  });
}

// Requests are sent in bounded batches. Cancelling aborts the active fetch and
// prevents every unsent batch from consuming additional API quota.
async function runParametricSweep() {
  const button = document.getElementById('btn-run-sweep');
  const cancelButton = document.getElementById('btn-cancel-sweep');
  const acknowledgement = document.getElementById('sweep-quota-ack');
  const empty = document.getElementById('sweep-empty');
  const tilts = [0, 10, 20, 30, 35, 40, 50, 60, 70, 80, 90];
  const azimuths = [90, 120, 150, 180, 210, 240, 270];
  const totalSimulations = tilts.length * azimuths.length;
  let completed = 0;

  if (!acknowledgement.checked || sweepInProgress || optimizerInProgress) return;
  if (!validateSimulationInputs()) {
    showToast('Correct the highlighted simulator input before running the comparison.', 'error');
    return;
  }

  sweepInProgress = true;
  sweepController = new AbortController();
  updateOptimizerAvailability();
  button.disabled = true;
  button.textContent = 'Running comparison…';
  button.setAttribute('aria-busy', 'true');
  cancelButton.hidden = false;
  empty.hidden = true;
  document.getElementById('chart-sweep').hidden = true;
  document.getElementById('sweep-data-panel').hidden = true;
  if (chartSweep) {
    chartSweep.destroy();
    chartSweep = null;
  }

  const currentParams = getParams();
  setSimulatorControlsForSweep(true);
  const shared = {
    systemCapacityKw: currentParams.systemCapacityKw,
    losses: currentParams.losses,
    dataset: currentParams.dataset,
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

  const requests = azimuths.flatMap(azimuth => tilts.map(tilt => ({ tilt, azimuth })));
  const sweepResults = [];

  try {
    for (let offset = 0; offset < requests.length; offset += SWEEP_CHUNK_SIZE) {
      const batch = requests.slice(offset, offset + SWEEP_CHUNK_SIZE);
      setSweepLoading(
        true,
        `Running official simulations ${completed + 1}–${Math.min(completed + batch.length, totalSimulations)}…`,
        `${completed} complete · ${totalSimulations - completed} remaining for ${currentLocation.name}`,
        completed
      );
      const batchResults = await simulateBatch(batch, shared, sweepController.signal);
      sweepResults.push(...batchResults);
      completed = sweepResults.length;
      setSweepLoading(true, `${completed} of ${totalSimulations} simulations complete`, 'You can cancel before the next batch is sent.', completed);
    }

    setSweepLoading(true, 'Building comparison…', 'All simulations are complete. Rendering the chart and accessible table.', totalSimulations);
    await new Promise(resolve => requestAnimationFrame(resolve));
    renderSweepChart(tilts, azimuths, sweepResults);
    document.getElementById('sweep-guard-help').textContent = 'Comparison complete. Acknowledge the quota again to rerun it.';
    showToast(`Comparison complete: ${totalSimulations} official PVWatts simulations.`);
  } catch (error) {
    empty.hidden = false;
    if (error.name === 'AbortError') {
      document.getElementById('sweep-guard-help').textContent = 'Comparison cancelled. Acknowledge the quota again when you are ready to restart.';
      empty.textContent = `Comparison cancelled after ${completed} completed simulations. No further batches were sent.`;
      showToast(`Comparison cancelled after ${completed} of ${totalSimulations} simulations.`);
    } else {
      document.getElementById('sweep-guard-help').textContent = 'The comparison stopped. Check the message above, then acknowledge the quota to retry.';
      const message = error.message;
      empty.textContent = `Comparison stopped after ${completed} completed simulations. ${message}`;
      showToast(`Comparison stopped: ${message}`, 'error');
    }
  } finally {
    setSimulatorControlsForSweep(false);
    sweepInProgress = false;
    sweepController = null;
    setSweepLoading(false, '', '');
    button.textContent = 'Run 77 simulations';
    button.removeAttribute('aria-busy');
    acknowledgement.checked = false;
    button.disabled = true;
    cancelButton.hidden = true;
    updateOptimizerAvailability();
  }
}

// ---------------------------------------------------------------------------
// Optimal orientation search
//
// One hourly PVWatts request returns the weather PVWatts used. The browser
// reruns the fixed-array model (orientation_model.js) for every orientation,
// scaled to match the official result at the current orientation, and one
// more official request confirms the best orientation it finds.
// ---------------------------------------------------------------------------

// Sequential bins in Solar Charge: brighter means closer to the optimum.
const ORIENTATION_BINS = Object.freeze([
  { min: 0.99, color: '#FFD140', label: '≥ 99%' },
  { min: 0.97, color: '#C9A42E', label: '97–99%' },
  { min: 0.95, color: '#957A26', label: '95–97%' },
  { min: 0.90, color: '#66541D', label: '90–95%' },
  { min: 0.80, color: '#3F3717', label: '80–90%' },
  { min: -Infinity, color: '#1C2433', label: '< 80%' }
]);

const TIME_MODE_LABELS = Object.freeze({
  interpolate: 'Hourly averages, sun at mid-hour with sunrise/sunset interpolation',
  instant30: 'Timestamped records, sun at half past each hour',
  instant0: 'Timestamped records, sun at the top of each hour'
});

function compassPoint(azimuth) {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];
}

function orientationLabel(tilt, azimuth) {
  return `${formatDecimal(tilt, 0)}° / ${formatDecimal(azimuth, 0)}°`;
}

// Everything that defines the search except the orientation itself.
function optimizerSignature(params) {
  const { tilt, azimuth, ...rest } = params;
  return JSON.stringify({ ...rest, location: currentLocation.name });
}

function updateOptimizerAvailability(params = getParams()) {
  const button = document.getElementById('btn-run-optimizer');
  const help = document.getElementById('optimizer-help');
  if (!button || !help) return;
  const support = OrientationModel.localModelSupport(params);
  button.disabled = !support.supported || optimizerInProgress || sweepInProgress;
  if (!optimizerInProgress) {
    help.textContent = support.supported
      ? optimizerMessage || 'Uses 2 PVWatts requests. The orientation search itself runs in your browser.'
      : support.reason;
    help.classList.toggle('is-warning', !support.supported);
  }
  const isStale = Boolean(optimizerResult) && optimizerResult.signature !== optimizerSignature(params);
  const stale = document.getElementById('optimizer-stale');
  if (stale) stale.hidden = !isStale;
  const seasonalStale = document.getElementById('seasonal-stale');
  if (seasonalStale) seasonalStale.hidden = !isStale;
  const confirm = document.getElementById('btn-confirm-schedule');
  if (confirm) confirm.disabled = optimizerInProgress || sweepInProgress;
}

function setOptimizerLoading(visible, status = '', detail = '', percent = 0) {
  const container = document.getElementById('optimizer-chart-container');
  const loading = document.getElementById('optimizer-loading');
  container.setAttribute('aria-busy', String(visible));
  loading.hidden = !visible;
  if (!visible) return;
  document.getElementById('optimizer-status').textContent = status;
  document.getElementById('optimizer-status-detail').textContent = detail;
  const progress = document.getElementById('optimizer-progress');
  const rounded = Math.max(0, Math.min(100, Math.round(percent)));
  progress.value = rounded;
  progress.textContent = `${rounded}%`;
  document.getElementById('optimizer-progress-label').textContent = `${rounded}%`;
}

function cancelOrientationOptimizer() {
  if (!optimizerInProgress || !optimizerController) return;
  setOptimizerLoading(true, 'Cancelling search…', 'No further PVWatts requests will be sent.', Number(document.getElementById('optimizer-progress').value) || 0);
  optimizerController.abort();
}

function weatherFromHourlyResult(hourlyResult, params) {
  const station = hourlyResult.stationInfo || {};
  const lat = Number.isFinite(Number(station.lat)) ? Number(station.lat) : params.lat;
  const lon = Number.isFinite(Number(station.lon)) ? Number(station.lon) : params.lon;
  const tz = Number.isFinite(Number(station.tz)) ? Number(station.tz) : Math.round(lon / 15);
  return {
    ...hourlyResult.hourly,
    lat,
    lon,
    tz,
    elev: Number(station.elev) || 0
  };
}

async function runOrientationOptimizer() {
  if (optimizerInProgress || sweepInProgress) return;
  if (!validateSimulationInputs()) {
    showToast('Correct the highlighted simulator input before running the search.', 'error');
    return;
  }
  const params = getParams();
  const support = OrientationModel.localModelSupport(params);
  if (!support.supported) {
    showToast(support.reason, 'error');
    return;
  }

  const button = document.getElementById('btn-run-optimizer');
  const cancelButton = document.getElementById('btn-cancel-optimizer');
  const empty = document.getElementById('optimizer-empty');
  const help = document.getElementById('optimizer-help');
  optimizerInProgress = true;
  optimizerController = new AbortController();
  const { signal } = optimizerController;
  const apiKey = getApiKey();
  const baseTilt = params.tilt;
  const baseAzimuth = ((params.azimuth % 360) + 360) % 360;
  const officialMonthly = new Map();
  let requestsSent = 0;

  button.disabled = true;
  button.textContent = 'Searching…';
  button.setAttribute('aria-busy', 'true');
  cancelButton.hidden = false;
  empty.hidden = true;
  help.textContent = 'You can cancel at any time. Cancelling stops any request that has not been sent.';
  document.getElementById('btn-run-sweep').disabled = true;
  setSimulatorControlsForSweep(true);

  try {
    setOptimizerLoading(true, 'Requesting hourly weather…', `1 official PVWatts request for ${currentLocation.name} at ${orientationLabel(baseTilt, baseAzimuth)}.`, 2);
    requestsSent += 1;
    const hourlyResult = await pvwattsClient.simulateHourly(params, { apiKey, signal });
    recordOfficialMonthly(officialMonthly, baseTilt, baseAzimuth, hourlyResult.monthlyAc);

    setOptimizerLoading(true, 'Checking the local model…', 'Comparing the in-browser model with the official hourly result.', 8);
    await new Promise(resolve => setTimeout(resolve, 0));
    const model = OrientationModel.calibrate(weatherFromHourlyResult(hourlyResult, params), params, {
      tilt: baseTilt,
      azimuth: baseAzimuth,
      acAnnualKwh: hourlyResult.annualAcKwh,
      hourlyPoa: hourlyResult.hourly.poa,
      hourlyAc: hourlyResult.hourly.ac
    });
    if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError');

    const search = await OrientationModel.optimize(model, {
      signal,
      onProgress: (done, total) => setOptimizerLoading(
        true,
        'Searching orientations in your browser…',
        `${done.toLocaleString()} of ${total.toLocaleString()} orientations evaluated. No API requests.`,
        10 + 80 * (done / total)
      )
    });

    const best = search.best;
    const seasonal = await OrientationModel.tiltSchedules(model, best.azimuth, {
      signal,
      onProgress: (done, total) => setOptimizerLoading(
        true,
        'Building seasonal tilt schedules…',
        `${done} of ${total} tilts simulated month by month at ${formatDecimal(best.azimuth, 0)}°. No API requests.`,
        90 + 3 * (done / total)
      )
    });

    let confirmedAcKwh = hourlyResult.annualAcKwh;
    const sameAsCurrent = best.tilt === baseTilt && (best.azimuth === baseAzimuth || best.tilt === 0);
    if (!sameAsCurrent) {
      setOptimizerLoading(true, 'Confirming with PVWatts…', `1 official request at ${orientationLabel(best.tilt, best.azimuth)}.`, 94);
      requestsSent += 1;
      const confirmation = await pvwattsClient.simulate({ ...params, tilt: best.tilt, azimuth: best.azimuth }, { apiKey, signal });
      confirmedAcKwh = confirmation.annualAcKwh;
      recordOfficialMonthly(officialMonthly, best.tilt, best.azimuth, confirmation.monthlyAc);
    }

    optimizerResult = {
      signature: optimizerSignature(params),
      params,
      model,
      search,
      best,
      base: { tilt: baseTilt, azimuth: baseAzimuth, officialAcKwh: hourlyResult.annualAcKwh },
      confirmedAcKwh,
      requestsSent,
      seasonal,
      officialMonthly,
      magnetic: siteDeclination(params),
      locationName: currentLocation.name,
      station: hourlyResult.stationInfo || {},
      dataset: params.dataset
    };
    renderOptimizerResult(optimizerResult);
    optimizerMessage = `Search complete with ${requestsSent} PVWatts ${requestsSent === 1 ? 'request' : 'requests'}.`;
    showToast(`Optimal orientation: ${orientationLabel(best.tilt, best.azimuth)} (tilt / azimuth).`);
  } catch (error) {
    if (error.name === 'AbortError') {
      optimizerMessage = 'Search cancelled. No further requests were sent.';
      showToast('Orientation search cancelled.');
    } else {
      console.error('Orientation search failed:', error);
      optimizerMessage = `The search stopped: ${error.message}`;
      showToast(`Orientation search stopped: ${error.message}`, 'error');
    }
    empty.hidden = Boolean(optimizerResult);
  } finally {
    setSimulatorControlsForSweep(false);
    optimizerInProgress = false;
    optimizerController = null;
    setOptimizerLoading(false);
    button.textContent = 'Find optimal orientation';
    button.removeAttribute('aria-busy');
    cancelButton.hidden = true;
    const acknowledgement = document.getElementById('sweep-quota-ack');
    document.getElementById('btn-run-sweep').disabled = !acknowledgement.checked;
    updateOptimizerAvailability();
  }
}

// Describe the near-optimal plateau from the coarse grid: the tilt range and
// the azimuth range (measured around the best azimuth) within 1% of the best.
function nearOptimalRanges(search, threshold = 0.99) {
  const { tilts, azimuths, values, best } = search;
  let tiltMin = Infinity;
  let tiltMax = -Infinity;
  let offsetMin = Infinity;
  let offsetMax = -Infinity;
  tilts.forEach((tilt, ti) => {
    azimuths.forEach((azimuth, ai) => {
      if (values[ti * azimuths.length + ai] < best.acKwh * threshold) return;
      tiltMin = Math.min(tiltMin, tilt);
      tiltMax = Math.max(tiltMax, tilt);
      if (tilt === 0) return;
      const offset = ((azimuth - best.azimuth + 540) % 360) - 180;
      offsetMin = Math.min(offsetMin, offset);
      offsetMax = Math.max(offsetMax, offset);
    });
  });
  const wrap = value => ((Math.round(best.azimuth + value) % 360) + 360) % 360;
  return {
    tiltMin,
    tiltMax,
    azimuthFrom: Number.isFinite(offsetMin) ? wrap(offsetMin) : null,
    azimuthTo: Number.isFinite(offsetMax) ? wrap(offsetMax) : null,
    allAzimuths: Number.isFinite(offsetMin) && offsetMax - offsetMin >= 355
  };
}

function renderOptimizerResult(result) {
  const { best, base, confirmedAcKwh, model, search } = result;
  const gain = confirmedAcKwh - base.officialAcKwh;
  const gainPercent = base.officialAcKwh > 0 ? (gain / base.officialAcKwh) * 100 : 0;
  const check = model.baseline.acDifferencePercent;

  document.getElementById('optimizer-results').hidden = false;
  document.getElementById('optimizer-kpi-orientation').textContent = orientationLabel(best.tilt, best.azimuth);
  document.getElementById('optimizer-kpi-orientation-note').textContent =
    best.tilt === 0 ? 'Flat. Azimuth has no effect at 0° tilt.' : `Tilt / azimuth, facing ${compassPoint(best.azimuth)}, searched to 1°.`;
  document.getElementById('optimizer-kpi-energy').textContent = Math.round(confirmedAcKwh).toLocaleString();
  document.getElementById('optimizer-kpi-energy-note').textContent = result.requestsSent > 1
    ? `Confirmed by official PVWatts v8. Local estimate was ${Math.round(best.acKwh).toLocaleString()} kWh.`
    : 'Your current orientation is already the optimum, so no second request was needed.';
  document.getElementById('optimizer-kpi-gain').textContent =
    `${gain >= 0 ? '+' : '−'}${Math.round(Math.abs(gain)).toLocaleString()}`;
  document.getElementById('optimizer-kpi-gain-note').textContent =
    `${gainPercent >= 0 ? '+' : '−'}${formatDecimal(Math.abs(gainPercent), 1, 1)}% versus ${orientationLabel(base.tilt, base.azimuth)} (official results).`;
  document.getElementById('optimizer-kpi-check').textContent = `${check >= 0 ? '+' : '−'}${formatDecimal(Math.abs(check), 2, 2)}`;
  document.getElementById('optimizer-kpi-check-note').textContent = Math.abs(check) <= 1
    ? 'Local model versus official PVWatts at your orientation, before scaling.'
    : 'Larger than usual. Values are scaled to match, and the optimum is still confirmed officially.';

  const ranges = nearOptimalRanges(search);
  const tiltText = ranges.tiltMin === ranges.tiltMax ? `${ranges.tiltMin}°` : `${ranges.tiltMin}–${ranges.tiltMax}°`;
  let azimuthText = '';
  if (ranges.allAzimuths) azimuthText = 'any azimuth';
  else if (ranges.azimuthFrom !== null) azimuthText = `azimuths ${ranges.azimuthFrom}–${ranges.azimuthTo}°`;
  document.getElementById('optimizer-plateau').textContent = azimuthText
    ? `Within 1% of the optimum: tilts ${tiltText} and ${azimuthText}. Small compromises in roof pitch or direction cost little energy.`
    : `Within 1% of the optimum: tilts ${tiltText}.`;

  renderOptimizerCompass(result);
  renderOptimizerMethod(result);
  renderOrientationTable(search);
  renderSeasonalSchedules(result);
  document.getElementById('optimizer-empty').hidden = true;
  document.getElementById('optimizer-figure').hidden = false;
  drawOrientationHeatmap();
  updateOptimizerAvailability();
}

function renderOptimizerMethod(result) {
  const { model, best, confirmedAcKwh, station, search } = result;
  const b = model.baseline;
  const stationName = [station.city, station.state].filter(Boolean).join(', ')
    || `${formatDecimal(model.prepared.lat, 3)}, ${formatDecimal(model.prepared.lon, 3)}`;
  const confirmDifference = best.acKwh > 0 ? (confirmedAcKwh / best.acKwh - 1) * 100 : 0;
  const coarseCount = (search.tilts.length - 1) * search.azimuths.length;
  const rows = [
    ['Weather', `${datasetLabel(result.dataset)} · ${stationName} · UTC${model.prepared.tz >= 0 ? '+' : ''}${model.prepared.tz}`],
    ['Timestamp convention', TIME_MODE_LABELS[model.timeMode] || model.timeMode],
    ['At your orientation', `Official ${Math.round(b.officialAcKwh).toLocaleString()} kWh · local ${Math.round(b.localAcKwh).toLocaleString()} kWh (${b.acDifferencePercent >= 0 ? '+' : '−'}${formatDecimal(Math.abs(b.acDifferencePercent), 2, 2)}%)`],
    ['Hourly plane-of-array fit', `RMSE ${formatDecimal(b.poaRmse, 1, 1)} W/m² across 8,760 hours`],
    ['Scaling applied', `× ${formatDecimal(model.scale, 4, 4)}`],
    ['At the optimum', result.requestsSent > 1
      ? `Local ${Math.round(best.acKwh).toLocaleString()} kWh · official ${Math.round(confirmedAcKwh).toLocaleString()} kWh (${confirmDifference >= 0 ? '+' : '−'}${formatDecimal(Math.abs(confirmDifference), 2, 2)}%)`
      : 'Same as your current orientation'],
    ['Orientations evaluated', `${coarseCount.toLocaleString()} on a 5° grid, then a 1° refinement around the best cell`],
    ['Seasonal schedules', `Monthly energy for 91 tilts at ${formatDecimal(result.seasonal.azimuth, 0)}°, every split of the year into whole months`],
    ['Magnetic declination', result.magnetic
      ? `${MagneticDeclination.formatDeclination(result.magnetic.declination)} at the site (${result.magnetic.model}) · ${formatDecimal(best.azimuth, 0)}° true reads ${compassBearingText(best.azimuth, result.magnetic)} on a compass`
      : 'Unavailable'],
    ['PVWatts requests', String(result.requestsSent)]
  ];
  const list = document.getElementById('optimizer-method-list');
  list.replaceChildren(...rows.map(([term, detail]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = detail;
    row.append(dt, dd);
    return row;
  }));
  document.getElementById('optimizer-method-panel').hidden = false;
}

function renderOrientationTable(search) {
  const { tilts, azimuths, values } = search;
  const tableTilts = tilts.filter(tilt => tilt % 10 === 0);
  const tableAzimuths = azimuths.filter(azimuth => azimuth % 30 === 0);
  const head = document.getElementById('optimizer-table-head');
  const headerRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.scope = 'col';
  corner.textContent = 'Tilt / azimuth';
  headerRow.appendChild(corner);
  tableAzimuths.forEach(azimuth => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = `${azimuth}° ${compassPoint(azimuth)}`;
    headerRow.appendChild(th);
  });
  head.replaceChildren(headerRow);

  const body = document.getElementById('optimizer-table-body');
  body.replaceChildren(...tableTilts.map(tilt => {
    const row = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = `${tilt}°`;
    row.appendChild(th);
    const ti = tilts.indexOf(tilt);
    tableAzimuths.forEach(azimuth => {
      const td = document.createElement('td');
      td.textContent = Math.round(values[ti * azimuths.length + azimuths.indexOf(azimuth)]).toLocaleString();
      row.appendChild(td);
    });
    return row;
  }));
  document.getElementById('optimizer-data-panel').hidden = false;
}

function applyOptimalOrientation() {
  if (!optimizerResult) return;
  const { tilt, azimuth } = optimizerResult.best;
  [['num-tilt', tilt], ['num-azimuth', azimuth]].forEach(([id, value]) => {
    const input = document.getElementById(id);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  showToast(`Simulator set to ${orientationLabel(tilt, azimuth)}. Recalculating the official estimate.`);
}

// --- Compass bearings --------------------------------------------------------
//
// PVWatts azimuths are true bearings. A compass needle points to magnetic
// north, which differs by the local magnetic declination (WMM2025, evaluated
// in the browser by magnetic_declination.js).

function siteDeclination(location = currentLocation) {
  if (typeof MagneticDeclination === 'undefined') return null;
  const lat = Number(location.lat);
  const lon = Number(location.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return MagneticDeclination.declination(lat, lon);
}

function compassBearingText(trueAzimuth, site) {
  return `${formatDecimal(MagneticDeclination.magneticBearing(trueAzimuth, site.declination), 1, 1)}°`;
}

function declinationSource(site) {
  const when = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `${site.model}, ${when}${site.inRange ? '' : '; outside the model’s 2025–2030 window, so treat it as approximate'}`;
}

function updateCompassMagnetic(azimuth = readNumber('num-azimuth', 180)) {
  const label = document.getElementById('compass-magnetic-label');
  if (!label) return;
  const site = siteDeclination();
  label.textContent = site ? `${compassBearingText(azimuth, site)} magnetic` : '— magnetic';
  label.title = site
    ? `On a magnetic compass. Declination at ${currentLocation.name}: ${MagneticDeclination.formatDeclination(site.declination)} (${declinationSource(site)}). PVWatts azimuths are true bearings.`
    : 'Magnetic declination is unavailable.';
}

function renderOptimizerCompass(result) {
  const output = document.getElementById('optimizer-compass');
  const { best, magnetic } = result;
  output.hidden = !magnetic || best.tilt === 0;
  if (output.hidden) return;
  output.textContent = `On a magnetic compass, face ${compassBearingText(best.azimuth, magnetic)} to point the array at ${formatDecimal(best.azimuth, 0)}° true. `
    + `Magnetic declination at ${result.locationName} is ${MagneticDeclination.formatDeclination(magnetic.declination)} (${declinationSource(magnetic)}). PVWatts azimuths are true bearings.`;
}

function compassExport(params) {
  const site = siteDeclination(params);
  if (!site) return null;
  return {
    model: site.model,
    decimalYear: site.year,
    magneticDeclinationDeg: site.declination,
    trueAzimuthDeg: params.azimuth,
    magneticBearingDeg: MagneticDeclination.magneticBearing(params.azimuth, site.declination)
  };
}

// --- Seasonal tilt schedules --------------------------------------------------
//
// The search's calibrated model is rerun month by month for every tilt at the
// optimal azimuth, and orientation_model.js picks the best schedule for 1, 2,
// 4, and 12 tilt settings a year. An optional check replaces the local monthly
// energies with official PVWatts results, one request per tilt.

const SCHEDULE_NAMES = Object.freeze({ 1: 'Fixed', 2: 'Twice a year', 4: 'Four times a year', 12: 'Monthly' });
const MONTH_SHORT = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
const MONTH_LONG = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

function officialKey(tilt, azimuth) {
  return `${Number(tilt)}/${((Number(azimuth) % 360) + 360) % 360}`;
}

function recordOfficialMonthly(map, tilt, azimuth, monthlyAc) {
  if (Array.isArray(monthlyAc) && monthlyAc.length === 12 && monthlyAc.every(Number.isFinite)) {
    map.set(officialKey(tilt, azimuth), monthlyAc);
  }
}

function scheduleMonthTilts(schedule) {
  const tilts = new Array(12);
  schedule.blocks.forEach(block => {
    for (let i = 0; i < block.months; i += 1) tilts[(block.startMonth - 1 + i) % 12] = block.tilt;
  });
  return tilts;
}

// Tilts the official check still needs: the schedule's own plus the fixed
// tilt, so the official gain compares like with like.
function missingScheduleTilts(result, schedule) {
  const { azimuth, schedules } = result.seasonal;
  const tilts = new Set([...schedule.blocks.map(block => block.tilt), schedules[0].blocks[0].tilt]);
  return [...tilts].filter(tilt => !result.officialMonthly.has(officialKey(tilt, azimuth)));
}

function officialScheduleKwh(result, schedule) {
  let total = 0;
  const monthTilts = scheduleMonthTilts(schedule);
  for (let month = 0; month < 12; month += 1) {
    const monthly = result.officialMonthly.get(officialKey(monthTilts[month], result.seasonal.azimuth));
    if (!monthly) return null;
    total += monthly[month];
  }
  return total;
}

function signedPercent(value, digits = 1) {
  return `${value >= 0 ? '+' : '−'}${formatDecimal(Math.abs(value), digits, digits)}%`;
}

function blockPeriod(block) {
  if (block.months === 12) return 'All year';
  const first = block.startMonth - 1;
  const last = (first + block.months - 1) % 12;
  if (block.months === 1) return MONTH_LONG[first];
  return `1 ${MONTH_SHORT[first]} – ${MONTH_DAYS[last]} ${MONTH_SHORT[last]}`;
}

function scheduleTiltSummary(schedule) {
  const tilts = schedule.blocks.map(block => block.tilt);
  if (tilts.length <= 4) return tilts.map(tilt => `${tilt}°`).join(' · ');
  return `${Math.min(...tilts)}–${Math.max(...tilts)}°`;
}

function renderSeasonalSchedules(result) {
  const { schedules } = result.seasonal;
  const fixed = schedules[0];
  const officialFixed = officialScheduleKwh(result, fixed);
  selectedScheduleIndex = Math.min(Math.max(0, selectedScheduleIndex), schedules.length - 1);

  const list = document.getElementById('seasonal-plan-list');
  list.replaceChildren(...schedules.map((schedule, index) => {
    const label = document.createElement('label');
    label.className = 'seasonal-plan';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'seasonal-plan';
    input.value = String(index);
    input.className = 'sr-only';
    input.checked = index === selectedScheduleIndex;
    input.addEventListener('change', () => {
      selectedScheduleIndex = index;
      renderSeasonalSelection(optimizerResult);
    });

    const name = document.createElement('span');
    name.className = 'seasonal-plan-name';
    name.textContent = SCHEDULE_NAMES[schedule.settings] || `${schedule.settings} settings`;
    const energy = document.createElement('span');
    energy.className = 'seasonal-plan-energy';
    energy.textContent = `${Math.round(schedule.annualKwh).toLocaleString()} kWh`;
    const gain = document.createElement('span');
    gain.className = 'seasonal-plan-gain';
    if (index === 0) {
      gain.classList.add('is-baseline');
      gain.textContent = 'Baseline';
    } else {
      gain.textContent = `${signedPercent((schedule.annualKwh / fixed.annualKwh - 1) * 100)} vs fixed`;
    }
    const tilts = document.createElement('span');
    tilts.className = 'seasonal-plan-tilts';
    tilts.textContent = scheduleTiltSummary(schedule);
    label.append(input, name, energy, gain, tilts);

    const official = officialScheduleKwh(result, schedule);
    if (official !== null) {
      const check = document.createElement('span');
      check.className = 'seasonal-plan-official';
      check.textContent = index === 0 || officialFixed === null
        ? `Official ${Math.round(official).toLocaleString()} kWh`
        : `Official ${signedPercent((official / officialFixed - 1) * 100)}`;
      label.appendChild(check);
    }
    return label;
  }));

  document.getElementById('seasonal-empty').hidden = true;
  document.getElementById('seasonal-results').hidden = false;
  renderSeasonalSelection(result);
}

function renderSeasonalSelection(result) {
  if (!result?.seasonal) return;
  const { seasonal } = result;
  const schedule = seasonal.schedules[selectedScheduleIndex];
  const fixed = seasonal.schedules[0];
  const name = SCHEDULE_NAMES[schedule.settings] || `${schedule.settings} settings`;
  const distinct = schedule.blocks.length;

  document.getElementById('seasonal-schedule-heading').textContent =
    `${name} · ${distinct} ${distinct === 1 ? 'setting' : 'settings'}`;
  const list = document.getElementById('seasonal-schedule-list');
  list.classList.toggle('is-compact', distinct > 4);
  list.replaceChildren(...[...schedule.blocks]
    .sort((a, b) => a.startMonth - b.startMonth)
    .map(block => {
      const item = document.createElement('li');
      const period = document.createElement('span');
      period.className = 'seasonal-period';
      period.textContent = blockPeriod(block);
      const tilt = document.createElement('strong');
      tilt.textContent = `${block.tilt}°`;
      const energy = document.createElement('span');
      energy.className = 'seasonal-block-energy';
      energy.textContent = `${Math.round(block.kwh).toLocaleString()} kWh`;
      item.append(period, tilt, energy);
      return item;
    }));

  const notes = [];
  if (distinct < schedule.settings && schedule.settings > 1) {
    notes.push(`Only ${distinct} different ${distinct === 1 ? 'setting pays' : 'settings pay'} off, so neighbouring periods share a tilt.`);
  }
  const bearing = result.magnetic ? ` (${compassBearingText(seasonal.azimuth, result.magnetic)} on a magnetic compass)` : '';
  notes.push(`Azimuth stays at ${formatDecimal(seasonal.azimuth, 0)}° true${bearing}; tilt changes on the first of the month.`);
  if (Number(result.params.arrayType) === 0) {
    notes.push(`Row spacing stays at GCR ${formatDecimal(result.params.groundCoverageRatio)}, so steeper winter tilts include their extra row-to-row shading.`);
  }
  if (schedule !== fixed) {
    notes.push(`Estimated gain over a fixed ${fixed.blocks[0].tilt}° tilt: ${Math.round(schedule.annualKwh - fixed.annualKwh).toLocaleString()} kWh a year.`);
  }
  document.getElementById('seasonal-note').textContent = notes.join(' ');

  updateScheduleConfirm(result, schedule);
  renderSeasonalTable(result, schedule);
  drawSeasonalChart(result, schedule, name);
}

function updateScheduleConfirm(result, schedule) {
  const button = document.getElementById('btn-confirm-schedule');
  const help = document.getElementById('seasonal-confirm-help');
  if (scheduleController) return;
  const missing = missingScheduleTilts(result, schedule);
  const official = officialScheduleKwh(result, schedule);
  const officialFixed = officialScheduleKwh(result, result.seasonal.schedules[0]);
  button.hidden = missing.length === 0;
  button.disabled = optimizerInProgress || sweepInProgress;
  button.textContent = `Confirm with PVWatts · ${missing.length} ${missing.length === 1 ? 'request' : 'requests'}`;
  if (missing.length === 0 && official !== null) {
    const gain = officialFixed && schedule !== result.seasonal.schedules[0]
      ? `, ${signedPercent((official / officialFixed - 1) * 100)} over fixed`
      : '';
    help.textContent = `Official PVWatts v8: ${Math.round(official).toLocaleString()} kWh a year${gain}, from official monthly results at each tilt.`;
  } else {
    help.textContent = 'Values are calibrated local estimates. The check sends one PVWatts request per tilt not yet run officially and adds up the official monthly energy.';
  }
}

function renderSeasonalTable(result, schedule) {
  const { seasonal } = result;
  const monthTilts = scheduleMonthTilts(schedule);
  const energyAt = (tilt, month) => seasonal.monthlyKwh[seasonal.tilts.indexOf(tilt) * 12 + month];
  const cell = (tag, text) => {
    const element = document.createElement(tag);
    element.textContent = text;
    if (tag === 'th') element.scope = 'row';
    return element;
  };
  const rows = MONTH_LONG.map((month, index) => {
    const row = document.createElement('tr');
    const declination = seasonal.declination[index];
    row.append(
      cell('th', month),
      cell('td', `${declination >= 0 ? '+' : '−'}${formatDecimal(Math.abs(declination), 1, 1)}°`),
      cell('td', seasonal.noonSunTilt ? `${formatDecimal(seasonal.noonSunTilt[index], 1, 1)}°` : '—'),
      cell('td', `${seasonal.monthlyBest[index].tilt}°`),
      cell('td', Math.round(seasonal.monthlyBest[index].kwh).toLocaleString()),
      cell('td', `${monthTilts[index]}°`),
      cell('td', Math.round(energyAt(monthTilts[index], index)).toLocaleString())
    );
    return row;
  });
  const total = document.createElement('tr');
  total.append(
    cell('th', 'Year'),
    cell('td', ''),
    cell('td', ''),
    cell('td', ''),
    cell('td', Math.round(seasonal.monthlyBest.reduce((sum, month) => sum + month.kwh, 0)).toLocaleString()),
    cell('td', ''),
    cell('td', Math.round(schedule.annualKwh).toLocaleString())
  );
  document.getElementById('seasonal-table-body').replaceChildren(...rows, total);
}

function drawSeasonalChart(result, schedule, name) {
  const canvas = document.getElementById('chart-seasonal');
  if (!canvas) return;
  if (typeof Chart === 'undefined') {
    showChartFallback('chart-seasonal');
    return;
  }
  const { seasonal } = result;
  const datasets = [
    {
      label: `${name} schedule`,
      data: scheduleMonthTilts(schedule),
      stepped: 'middle',
      borderColor: UML_COLORS.green,
      backgroundColor: UML_COLORS.green,
      borderWidth: 3,
      pointRadius: 0,
      pointHoverRadius: 4
    },
    {
      label: 'Best tilt each month',
      data: seasonal.monthlyBest.map(month => month.tilt),
      showLine: false,
      borderColor: UML_COLORS.yellow,
      backgroundColor: UML_COLORS.yellow,
      pointRadius: 4,
      pointHoverRadius: 6
    }
  ];
  if (seasonal.noonSunTilt) {
    datasets.push({
      label: 'Noon-sun tilt, |latitude − declination|',
      data: seasonal.noonSunTilt.map(tilt => Math.round(tilt * 10) / 10),
      borderColor: UML_COLORS.lightBlue,
      backgroundColor: UML_COLORS.lightBlue,
      borderDash: [5, 4],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.3
    });
  }
  canvas.setAttribute('aria-label',
    `Line chart of tilt by month. The ${name.toLowerCase()} schedule uses ${scheduleTiltSummary(schedule)}; the best tilt each month ranges from ${Math.min(...seasonal.monthlyBest.map(month => month.tilt))} to ${Math.max(...seasonal.monthlyBest.map(month => month.tilt))} degrees.`);

  if (chartSeasonal) {
    chartSeasonal.data.datasets = datasets;
    chartSeasonal.update('none');
    return;
  }
  chartSeasonal = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: MONTH_SHORT, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: UML_COLORS.textSecondary, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          backgroundColor: UML_COLORS.tooltipBackground,
          titleColor: UML_COLORS.textPrimary,
          bodyColor: UML_COLORS.textPrimary,
          borderColor: UML_COLORS.tooltipBorder,
          borderWidth: 1,
          callbacks: { label: context => `${context.dataset.label}: ${formatDecimal(context.parsed.y, 1)}°` }
        }
      },
      scales: {
        x: { grid: { color: UML_COLORS.gridLine }, ticks: { color: UML_COLORS.textSecondary } },
        y: {
          min: 0,
          max: 90,
          grid: { color: UML_COLORS.gridLine },
          ticks: { color: UML_COLORS.textSecondary, stepSize: 15, callback: value => `${value}°` },
          title: { display: true, text: 'Tilt', color: UML_COLORS.textSecondary }
        }
      }
    }
  });
}

// Official check for the selected schedule: one request per missing tilt at
// the schedule's azimuth, holding every other input of the original search.
async function confirmTiltSchedule() {
  const result = optimizerResult;
  if (!result?.seasonal || optimizerInProgress || sweepInProgress || scheduleController) return;
  const schedule = result.seasonal.schedules[selectedScheduleIndex];
  const { azimuth } = result.seasonal;
  const missing = missingScheduleTilts(result, schedule);
  if (!missing.length) return;

  const button = document.getElementById('btn-confirm-schedule');
  const cancelButton = document.getElementById('btn-cancel-schedule');
  const help = document.getElementById('seasonal-confirm-help');
  // Shares the search's busy flag so the search and the grid wait for it.
  optimizerInProgress = true;
  scheduleController = new AbortController();
  const { signal } = scheduleController;
  const apiKey = getApiKey();
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  cancelButton.hidden = false;
  document.getElementById('btn-run-sweep').disabled = true;
  updateOptimizerAvailability();

  let sent = 0;
  try {
    for (const tilt of missing) {
      help.textContent = `Request ${sent + 1} of ${missing.length}: ${tilt}° tilt at ${formatDecimal(azimuth, 0)}°.`;
      const official = await pvwattsClient.simulate({ ...result.params, tilt, azimuth }, { apiKey, signal });
      sent += 1;
      recordOfficialMonthly(result.officialMonthly, tilt, azimuth, official.monthlyAc);
    }
    showToast(`Schedule checked with ${sent} PVWatts ${sent === 1 ? 'request' : 'requests'}.`);
  } catch (error) {
    if (error.name === 'AbortError') {
      showToast('Schedule check cancelled. No further requests were sent.');
    } else {
      console.error('Schedule check failed:', error);
      showToast(`Schedule check stopped: ${error.message}`, 'error');
    }
  } finally {
    optimizerInProgress = false;
    scheduleController = null;
    button.removeAttribute('aria-busy');
    cancelButton.hidden = true;
    document.getElementById('btn-run-sweep').disabled = !document.getElementById('sweep-quota-ack').checked;
    if (optimizerResult === result) renderSeasonalSchedules(result);
    updateOptimizerAvailability();
  }
}

function cancelTiltScheduleCheck() {
  scheduleController?.abort();
}

// --- Heatmap ---------------------------------------------------------------

const HEATMAP_MARGIN = Object.freeze({ top: 12, right: 12, bottom: 30, left: 40 });

function orientationBin(ratio) {
  return ORIENTATION_BINS.find(bin => ratio >= bin.min);
}

function initOrientationHeatmap() {
  const legend = document.getElementById('optimizer-legend');
  legend.replaceChildren(...ORIENTATION_BINS.map(bin => {
    const item = document.createElement('span');
    item.className = 'orientation-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'orientation-legend-swatch';
    swatch.style.background = bin.color;
    const label = document.createElement('span');
    label.textContent = bin.label;
    item.append(swatch, label);
    return item;
  }));

  const plot = document.getElementById('orientation-plot');
  const canvas = document.getElementById('chart-orientation');
  const tooltip = document.getElementById('orientation-tooltip');
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => drawOrientationHeatmap()).observe(plot);
  }
  canvas.addEventListener('mousemove', event => {
    const cell = orientationCellAt(event);
    if (!cell) {
      tooltip.hidden = true;
      return;
    }
    const { search } = optimizerResult;
    const value = search.values[cell.ti * search.azimuths.length + cell.ai];
    const tilt = search.tilts[cell.ti];
    const azimuth = search.azimuths[cell.ai];
    tooltip.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = tilt === 0 ? 'Tilt 0° (flat)' : `Tilt ${tilt}° · azimuth ${azimuth}° ${compassPoint(azimuth)}`;
    const detail = document.createElement('span');
    detail.textContent = `${Math.round(value).toLocaleString()} kWh · ${formatDecimal(value / search.best.acKwh * 100, 1, 1)}% of optimum`;
    tooltip.append(title, detail);
    tooltip.hidden = false;
    const rect = plot.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const flip = x > rect.width - 220;
    tooltip.style.left = `${flip ? x - tooltip.offsetWidth - 12 : x + 12}px`;
    tooltip.style.top = `${Math.max(0, y - tooltip.offsetHeight - 8)}px`;
  });
  canvas.addEventListener('mouseleave', () => { tooltip.hidden = true; });
}

function heatmapGeometry(canvas, search) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const plotWidth = width - HEATMAP_MARGIN.left - HEATMAP_MARGIN.right;
  const plotHeight = height - HEATMAP_MARGIN.top - HEATMAP_MARGIN.bottom;
  return {
    width,
    height,
    plotWidth,
    plotHeight,
    cellWidth: plotWidth / search.azimuths.length,
    cellHeight: plotHeight / search.tilts.length,
    azimuthStep: search.azimuths[1] - search.azimuths[0],
    tiltStep: search.tilts[1] - search.tilts[0]
  };
}

function orientationCellAt(event) {
  if (!optimizerResult) return null;
  const canvas = event.currentTarget;
  const geometry = heatmapGeometry(canvas, optimizerResult.search);
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left - HEATMAP_MARGIN.left;
  const y = event.clientY - rect.top - HEATMAP_MARGIN.top;
  if (x < 0 || y < 0 || x >= geometry.plotWidth || y >= geometry.plotHeight) return null;
  const ai = Math.floor(x / geometry.cellWidth);
  const ti = optimizerResult.search.tilts.length - 1 - Math.floor(y / geometry.cellHeight);
  return { ai, ti };
}

function drawOrientationHeatmap() {
  const canvas = document.getElementById('chart-orientation');
  if (!optimizerResult || !canvas || canvas.closest('[hidden]')) return;
  const { search, best, base } = optimizerResult;
  const ratio = window.devicePixelRatio || 1;
  const geometry = heatmapGeometry(canvas, search);
  if (geometry.plotWidth <= 0 || geometry.plotHeight <= 0) return;
  canvas.width = Math.round(geometry.width * ratio);
  canvas.height = Math.round(geometry.height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, geometry.width, geometry.height);

  const { left, top } = HEATMAP_MARGIN;
  const gap = geometry.cellWidth > 6 ? 1 : 0;
  search.tilts.forEach((tilt, ti) => {
    const y = top + geometry.plotHeight - (ti + 1) * geometry.cellHeight;
    search.azimuths.forEach((azimuth, ai) => {
      const value = search.values[ti * search.azimuths.length + ai];
      context.fillStyle = orientationBin(value / best.acKwh).color;
      context.fillRect(left + ai * geometry.cellWidth, y, geometry.cellWidth - gap, geometry.cellHeight - gap);
    });
  });

  // Axes: compass azimuths along the bottom, tilt up the side.
  context.fillStyle = UML_COLORS.textSecondary;
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  const xFor = azimuth => left + (azimuth / geometry.azimuthStep + 0.5) * geometry.cellWidth;
  const yFor = tilt => top + geometry.plotHeight - (tilt / geometry.tiltStep + 0.5) * geometry.cellHeight;
  [[0, '0° N'], [90, '90° E'], [180, '180° S'], [270, '270° W']].forEach(([azimuth, label]) => {
    context.fillText(label, xFor(azimuth), top + geometry.plotHeight + 8);
  });
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  [0, 30, 60, 90].forEach(tilt => context.fillText(`${tilt}°`, left - 8, yFor(tilt)));

  const drawMarker = (azimuth, tilt, color, label, dashed) => {
    const x = xFor(azimuth);
    const y = yFor(tilt);
    context.save();
    context.lineWidth = 2;
    context.strokeStyle = '#001C36';
    context.beginPath();
    context.arc(x, y, 8, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = color;
    if (dashed) context.setLineDash([3, 2]);
    context.beginPath();
    context.arc(x, y, 7, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    context.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    context.textBaseline = 'middle';
    const rightSide = x < left + geometry.plotWidth - 90;
    context.textAlign = rightSide ? 'left' : 'right';
    const textX = rightSide ? x + 12 : x - 12;
    context.lineWidth = 3;
    context.strokeStyle = '#001C36';
    context.strokeText(label, textX, y);
    context.fillStyle = color;
    context.fillText(label, textX, y);
  };
  const sameCell = Math.abs(base.tilt - best.tilt) < geometry.tiltStep && Math.abs(base.azimuth - best.azimuth) < geometry.azimuthStep;
  if (!sameCell) drawMarker(base.azimuth, base.tilt, UML_COLORS.lightBlue, 'Current', true);
  drawMarker(best.azimuth, best.tilt, UML_COLORS.textPrimary, 'Optimum', false);

  canvas.setAttribute('aria-label',
    `Heatmap of estimated annual AC energy by tilt and azimuth. The optimum is ${best.tilt} degrees tilt at ${best.azimuth} degrees azimuth; your current orientation is ${base.tilt} degrees tilt at ${base.azimuth} degrees azimuth.`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Export JSON
function exportJson() {
  if (!currentResult) return;
  const params = getParams();
  const data = {
    location: currentLocation,
    station: currentResult.stationInfo,
    model: currentResult.model,
    parameters: params,
    results: currentResult,
    compass: compassExport(params),
    timestamp: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `pvwatts_results_${params.systemCapacityKw}kW.json`);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function createMonthlyCsv(res) {
  const monthlyPoa = MONTH_DAYS.map((days, month) => res.monthlyPoa?.[month] ?? (res.monthlySolrad[month] * days));
  const rows = [[
    'Month',
    'Solar radiation (kWh/m²/day)',
    'Plane of array (kWh/m²)',
    'DC energy (kWh)',
    'AC energy (kWh)'
  ]];

  for (let month = 0; month < 12; month++) {
    rows.push([
      res.monthNames[month],
      res.monthlySolrad[month],
      monthlyPoa[month],
      res.monthlyDc[month],
      res.monthlyAc[month]
    ]);
  }
  rows.push([
    'Annual total / average',
    res.annualSolrad,
    monthlyPoa.reduce((sum, value) => sum + Number(value), 0),
    res.monthlyDc.reduce((sum, value) => sum + Number(value), 0),
    res.annualAcKwh
  ]);
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\n')}\n`;
}

// Export CSV
function exportCsv() {
  if (!currentResult) return;
  const params = getParams();
  const blob = new Blob([createMonthlyCsv(currentResult)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `pvwatts_monthly_${params.systemCapacityKw}kW.csv`);
}

// Toast Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => toast.remove(), type === 'error' ? 6000 : 4000);
}
