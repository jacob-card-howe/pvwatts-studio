/**
 * PVWatts Studio - Datasheet Reader tab.
 *
 * Opens a PV module specification sheet in the browser, fills the table with
 * whatever `datasheet_parser.js` could locate, and renders the source page
 * beside it. Nothing here is treated as authoritative: every field is editable,
 * every filled value names the datasheet row it came from, and the calculations
 * always run on the values currently in the table rather than on the
 * extraction. The consistency checks compare independently stated numbers so a
 * mis-read or mistyped value shows up instead of quietly propagating.
 *
 * pdf.js is imported on first use so the library costs nothing until a file is
 * actually opened.
 */

const PDFJS_VERSION = '4.7.76';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build`;

/** Table layout. `key` matches the flattened value bag the parser produces. */
const DATASHEET_ROWS = [
  { group: 'Electrical characteristics at STC', note: '1000 W/m², AM 1.5, cell temperature 25 °C' },
  { key: 'pmax_stc', label: 'Maximum power, Pmax', unit: 'W', essential: true },
  { key: 'vmp_stc', label: 'Voltage at maximum power, Vmp', unit: 'V', essential: true },
  { key: 'imp_stc', label: 'Current at maximum power, Imp', unit: 'A', essential: true },
  { key: 'voc_stc', label: 'Open-circuit voltage, Voc', unit: 'V', essential: true },
  { key: 'isc_stc', label: 'Short-circuit current, Isc', unit: 'A', essential: true },
  { key: 'efficiency_stc', label: 'Module efficiency (as stated)', unit: '%' },

  { group: 'Electrical characteristics at NOCT / NMOT', note: '800 W/m², AM 1.5, 20 °C ambient, 1 m/s wind' },
  { key: 'pmax_noct', label: 'Maximum power, Pmax', unit: 'W' },
  { key: 'vmp_noct', label: 'Voltage at maximum power, Vmp', unit: 'V' },
  { key: 'imp_noct', label: 'Current at maximum power, Imp', unit: 'A' },
  { key: 'voc_noct', label: 'Open-circuit voltage, Voc', unit: 'V' },
  { key: 'isc_noct', label: 'Short-circuit current, Isc', unit: 'A' },

  { group: 'Bifacial characteristics at BSTC', optional: 'bstc' },
  { key: 'pmax_bstc', label: 'Maximum power, Pmax', unit: 'W', optional: 'bstc' },
  { key: 'vmp_bstc', label: 'Voltage at maximum power, Vmp', unit: 'V', optional: 'bstc' },
  { key: 'imp_bstc', label: 'Current at maximum power, Imp', unit: 'A', optional: 'bstc' },
  { key: 'voc_bstc', label: 'Open-circuit voltage, Voc', unit: 'V', optional: 'bstc' },
  { key: 'isc_bstc', label: 'Short-circuit current, Isc', unit: 'A', optional: 'bstc' },

  { group: 'Temperature characteristics' },
  { key: 'noctTemp', label: 'Nominal operating cell temperature (NOCT / NMOT)', unit: '°C', essential: true },
  { key: 'tcPmax', label: 'Temperature coefficient of Pmax', unit: '%/°C', essential: true },
  { key: 'tcVoc', label: 'Temperature coefficient of Voc', unit: '%/°C', essential: true },
  { key: 'tcIsc', label: 'Temperature coefficient of Isc', unit: '%/°C', essential: true },

  { group: 'Ratings' },
  { key: 'maxSystemVoltage', label: 'Maximum system voltage', unit: 'V' },
  { key: 'maxSeriesFuse', label: 'Maximum series fuse rating', unit: 'A', essential: true },
  { key: 'powerTolerance', label: 'Power tolerance', unit: '', type: 'text', essential: true },
  { key: 'bifaciality', label: 'Bifaciality factor', unit: '%', optional: 'bifaciality' },

  { group: 'Mechanical characteristics' },
  { key: 'cells', label: 'Cells per module', unit: 'cells', essential: true },
  { key: 'height_mm', label: 'Overall height (long side)', unit: 'mm', imperial: true, essential: true },
  { key: 'length_mm', label: 'Overall length (short side)', unit: 'mm', imperial: true, essential: true },
  { key: 'thickness_mm', label: 'Thickness', unit: 'mm', imperial: true, essential: true },
  { key: 'weight', label: 'Module weight', unit: 'kg', pounds: true, essential: true }
];

const datasheetState = {
  fileName: '',
  pdf: null,
  rawPages: null,
  pageCount: 0,
  extraction: null,
  values: {},
  edited: new Set(),
  columnIndex: 0,
  pageNumber: 1,
  zoom: 1,
  renderTask: null,
  renderSequence: 0,
  loadSequence: 0,
  pdfjs: null
};

let pdfjsPromise = null;

async function loadPdfjs() {
  if (datasheetState.pdfjs) return datasheetState.pdfjs;
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* webpackIgnore: true */ `${PDFJS_BASE}/pdf.min.mjs`).then(module => {
      module.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      datasheetState.pdfjs = module;
      return module;
    }).catch(error => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

function dsElement(id) {
  return document.getElementById(id);
}

function setDatasheetStatus(message, tone = 'info') {
  const status = dsElement('ds-status');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.tone = tone;
  status.hidden = !message;
}

function formatNumber(value, places = 2) {
  if (!Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const fixed = number.toFixed(places);
  return String(Number(fixed));
}

function isFilled(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return Number.isFinite(Number(value));
}

// --------------------------------------------------------------------------
// Value table
// --------------------------------------------------------------------------

function renderDatasheetTable() {
  const body = dsElement('ds-table-body');
  if (!body) return;
  const openGroups = new Set([...body.querySelectorAll('details.ds-spec-group[open]')].map(group => group.dataset.group));
  const firstRender = !body.children.length;
  body.textContent = '';

  const fields = (datasheetState.extraction && datasheetState.extraction.fields) || {};
  const present = {
    bstc: ['pmax_bstc', 'vmp_bstc', 'imp_bstc', 'voc_bstc', 'isc_bstc'].some(key => isFilled(datasheetState.values[key])),
    bifaciality: isFilled(datasheetState.values.bifaciality)
  };
  const names = ['Electrical at STC', 'Electrical at NOCT / NMOT', 'Bifacial at BSTC', 'Temperature', 'Ratings', 'Dimensions & weight'];
  let groupIndex = -1;
  let tableBody;
  let group;
  let groupName;

  for (const row of DATASHEET_ROWS) {
    if (row.group) groupIndex += 1;
    if (row.optional && !present[row.optional]) continue;
    if (row.group) {
      groupName = row.group;
      group = document.createElement('details');
      group.className = 'ds-spec-group';
      group.dataset.group = String(groupIndex);
      group.open = firstRender ? groupIndex === 0 : openGroups.has(String(groupIndex));
      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = names[groupIndex];
      summary.appendChild(title);
      const count = document.createElement('span');
      count.className = 'ds-group-count';
      summary.appendChild(count);
      group.appendChild(summary);
      if (row.note) {
        const note = document.createElement('p');
        note.className = 'ds-group-note';
        note.textContent = row.note;
        group.appendChild(note);
      }
      const table = document.createElement('table');
      table.className = 'ds-table';
      const caption = document.createElement('caption');
      caption.className = 'sr-only';
      caption.textContent = `${row.group}: editable specification values, units, and source rows.`;
      table.appendChild(caption);
      tableBody = document.createElement('tbody');
      table.appendChild(tableBody);
      group.appendChild(table);
      body.appendChild(group);
      continue;
    }

    const value = datasheetState.values[row.key];
    const tr = document.createElement('tr');
    tr.classList.toggle('ds-row-missing', Boolean(datasheetState.fileName && row.essential && !isFilled(value)));
    const labelCell = document.createElement('th');
    labelCell.scope = 'row';
    const label = document.createElement('label');
    label.htmlFor = `ds-value-${row.key}`;
    label.textContent = row.label;
    labelCell.appendChild(label);
    const source = document.createElement('div');
    source.id = `ds-source-${row.key}`;
    labelCell.appendChild(source);
    tr.appendChild(labelCell);

    const valueCell = document.createElement('td');
    const control = document.createElement('div');
    control.className = 'ds-value-control';
    const input = document.createElement('input');
    input.type = row.type === 'text' ? 'text' : 'number';
    if (input.type === 'number') input.step = 'any';
    input.className = 'ds-input';
    input.id = `ds-value-${row.key}`;
    input.dataset.key = row.key;
    input.value = isFilled(value) ? String(value) : '';
    input.setAttribute('aria-label', `${row.label}${row.unit ? ` in ${row.unit}` : ''} — ${groupName}`);
    input.setAttribute('aria-describedby', source.id);
    if (datasheetState.edited.has(row.key)) input.dataset.edited = 'true';
    control.appendChild(input);
    if (row.unit) {
      const unit = document.createElement('span');
      unit.className = 'ds-unit';
      unit.textContent = row.unit;
      control.appendChild(unit);
    }
    valueCell.appendChild(control);
    const alternate = document.createElement('span');
    alternate.className = 'ds-alt';
    valueCell.appendChild(alternate);
    tr.appendChild(valueCell);
    tableBody.appendChild(tr);

    const updateAnnotations = () => {
      const currentValue = datasheetState.values[row.key];
      const sourceText = sourceFor(fields, row.key);
      source.textContent = '';
      source.className = 'ds-source';
      if (sourceText) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Datasheet row';
        const text = document.createElement('p');
        text.textContent = sourceText;
        details.append(summary, text);
        source.appendChild(details);
      } else if (isFilled(currentValue)) {
        source.textContent = 'Entered by you';
        source.classList.add('ds-source-manual');
      } else {
        source.textContent = datasheetState.fileName ? 'Not found — read it from the page' : (row.essential ? 'Required value' : 'Optional value');
      }
      const hint = isFilled(currentValue) ? alternateUnit(row, currentValue) : null;
      alternate.textContent = hint || '';
      alternate.hidden = !hint;
    };
    updateAnnotations();
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (raw === '') delete datasheetState.values[row.key];
      else datasheetState.values[row.key] = row.type === 'text' ? raw : Number(raw);
      datasheetState.edited.add(row.key);
      input.dataset.edited = 'true';
      tr.classList.toggle('ds-row-missing', Boolean(datasheetState.fileName && row.essential && raw === ''));
      updateAnnotations();
      renderDerived();
    });
  }
}

function updateDatasheetSummary(metrics) {
  const values = datasheetState.values;
  const put = (id, value, places) => {
    const element = dsElement(id);
    if (element) element.textContent = isFilled(value) ? formatNumber(value, places) : '—';
  };
  put('ds-kpi-power', values.pmax_stc, 1);
  put('ds-kpi-area', metrics.area, 3);
  put('ds-kpi-efficiency', metrics.efficiency, 2);
  put('ds-kpi-fill-factor', metrics.fillFactorStc, 3);

  const required = DATASHEET_ROWS.filter(row => row.essential);
  const filled = required.filter(row => isFilled(values[row.key])).length;
  dsElement('ds-completion').textContent = `${filled} of ${required.length} required values filled`;
  dsElement('ds-next-missing').hidden = filled === required.length;
  for (const group of document.querySelectorAll('.ds-spec-group')) {
    const inputs = [...group.querySelectorAll('.ds-input')];
    const count = inputs.filter(input => isFilled(values[input.dataset.key])).length;
    group.querySelector('.ds-group-count').textContent = `${count}/${inputs.length}`;
    group.querySelector('.ds-group-count').setAttribute('aria-label', `${count} of ${inputs.length} values filled`);
  }
  const power = isFilled(values.pmax_stc) ? `${formatNumber(values.pmax_stc, 1)} W at STC` : 'Rated power not entered';
  const efficiency = metrics.efficiency === null ? 'efficiency needs power and dimensions' : `${formatNumber(metrics.efficiency, 2)}% efficiency`;
  dsElement('ds-mobile-summary').textContent = `${power} · ${efficiency}`;
  const canExport = Object.values(values).some(isFilled);
  dsElement('ds-export-csv').disabled = !canExport;
  dsElement('ds-export-json').disabled = !canExport;
}

function focusNextMissingValue() {
  const missing = DATASHEET_ROWS.filter(row => row.essential && !isFilled(datasheetState.values[row.key]));
  if (!missing.length) return;
  const input = dsElement(`ds-value-${missing[0].key}`);
  if (!input) return;
  input.closest('.ds-spec-group').open = true;
  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: 'center', behavior: 'instant' });
}

/** The datasheet row a value came from, or null once the user has edited it. */
function sourceFor(fields, key) {
  if (datasheetState.edited.has(key)) return null;
  if (['height_mm', 'length_mm', 'thickness_mm'].includes(key)) {
    return fields.dimensions ? fields.dimensions.rowText : null;
  }
  return fields[key] ? fields[key].rowText : null;
}

function alternateUnit(row, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (row.imperial) return `${formatNumber(number / DatasheetParser.MM_PER_INCH, 2)} in`;
  if (row.pounds) return `${formatNumber(number / DatasheetParser.KG_PER_LB, 1)} lbs`;
  return null;
}

// --------------------------------------------------------------------------
// Calculations
// --------------------------------------------------------------------------

function renderDerived() {
  const body = dsElement('ds-derived-body');
  const list = dsElement('ds-checks-list');
  if (!body || !list) return;

  const metrics = DatasheetParser.computeMetrics(datasheetState.values);
  const pmax = Number(datasheetState.values.pmax_stc);
  const noctPmax = Number(datasheetState.values.pmax_noct);

  const rows = [
    {
      label: 'Module area',
      value: metrics.area === null ? null : `${formatNumber(metrics.area, 4)} m²`,
      formula: 'height x length'
    },
    {
      label: 'Module efficiency',
      value: metrics.efficiency === null ? null : `${formatNumber(metrics.efficiency, 2)} %`,
      formula: 'Pmax / (area x 1000 W/m²) x 100'
    },
    {
      label: 'Fill factor at STC',
      value: metrics.fillFactorStc === null ? null : formatNumber(metrics.fillFactorStc, 4),
      formula: '(Vmp x Imp) / (Voc x Isc)'
    },
    {
      label: 'Fill factor at NOCT',
      value: metrics.fillFactorNoct === null ? null : formatNumber(metrics.fillFactorNoct, 4),
      formula: '(Vmp x Imp) / (Voc x Isc) at NOCT'
    },
    {
      label: 'Minimum power of a random module',
      value: metrics.tolerance === null ? null : `${formatNumber(metrics.tolerance.min, 2)} W`,
      formula: toleranceFormula(metrics.tolerance, pmax, 'low')
    },
    {
      label: 'Maximum power of a random module',
      value: metrics.tolerance === null ? null : `${formatNumber(metrics.tolerance.max, 2)} W`,
      formula: toleranceFormula(metrics.tolerance, pmax, 'high')
    },
    {
      label: 'Power difference, NOCT vs STC',
      value: metrics.noctVsStcPercent === null ? null : `${formatNumber(metrics.noctVsStcPercent, 2)} %`,
      formula: Number.isFinite(pmax) && Number.isFinite(noctPmax)
        ? `(${formatNumber(pmax, 2)} - ${formatNumber(noctPmax, 2)}) / ${formatNumber(pmax, 2)} x 100`
        : '(high - low) / high x 100'
    }
  ];

  body.textContent = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = row.label;
    tr.appendChild(label);

    const value = document.createElement('td');
    value.className = 'ds-derived-value';
    if (row.value === null) {
      value.textContent = 'Needs more values';
      value.classList.add('ds-derived-pending');
    } else {
      value.textContent = row.value;
    }
    tr.appendChild(value);

    const formula = document.createElement('td');
    formula.className = 'ds-formula';
    formula.textContent = row.formula;
    tr.appendChild(formula);

    body.appendChild(tr);
  }

  updateDatasheetSummary(metrics);
  renderChecks(list, metrics);
}

function toleranceFormula(tolerance, pmax, side) {
  if (!tolerance || !Number.isFinite(pmax)) return 'Pmax plus the stated power tolerance';
  const offset = side === 'low' ? tolerance.low : tolerance.high;
  const sign = offset >= 0 ? '+' : '-';
  const magnitude = Math.abs(offset);
  return tolerance.basis === 'percent'
    ? `${formatNumber(pmax, 2)} W ${sign} ${formatNumber(magnitude, 3)}%`
    : `${formatNumber(pmax, 2)} W ${sign} ${formatNumber(magnitude, 3)} W`;
}

function renderChecks(list, metrics) {
  list.textContent = '';
  const entries = [];

  for (const check of metrics.checks) {
    entries.push({
      ok: check.ok,
      text: `${check.label}: ${formatNumber(check.expected, 3)} vs ${formatNumber(check.actual, 3)} ` +
        `(${formatNumber(check.relative * 100, 2)}% apart). ${check.note}`
    });
  }

  const fillFactors = [
    ['STC', metrics.fillFactorStc],
    ['NOCT', metrics.fillFactorNoct]
  ];
  for (const [label, fillFactor] of fillFactors) {
    if (fillFactor === null) continue;
    const plausible = fillFactor > 0.5 && fillFactor < 1;
    entries.push({
      ok: plausible,
      text: plausible
        ? `Fill factor at ${label} is ${formatNumber(fillFactor, 4)}, inside the 0.5–1.0 range a real module occupies.`
        : `Fill factor at ${label} is ${formatNumber(fillFactor, 4)}, which is physically impossible. One of Vmp, Imp, Voc or Isc is wrong.`
    });
  }

  const missing = DATASHEET_ROWS
    .filter(row => row.key && row.essential && !isFilled(datasheetState.values[row.key]))
    .map(row => row.label);
  if (missing.length) {
    entries.push({
      ok: false,
      text: `${missing.length} required values are still blank. Use “Next blank” in Module values to find them before relying on the results.`
    });
  }

  if (!entries.length) {
    const item = document.createElement('li');
    item.className = 'ds-check ds-check-pending';
    item.textContent = 'Fill in the STC block to enable the consistency checks.';
    list.appendChild(item);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('li');
    item.className = `ds-check ${entry.ok ? 'ds-check-ok' : 'ds-check-warn'}`;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('ds-check-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', entry.ok ? 'M5 12l4 4L19 6' : 'M12 8v5m0 3v1M12 3 2 21h20Z');
    icon.appendChild(path);
    item.appendChild(icon);
    const text = document.createElement('span');
    text.textContent = entry.text;
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = entry.ok ? 'Check passed: ' : 'Check needs attention: ';
    item.appendChild(label);
    item.appendChild(text);
    list.appendChild(item);
  }
}

// --------------------------------------------------------------------------
// PDF loading and page rendering
// --------------------------------------------------------------------------

async function renderDatasheetPage(pageNumber) {
  const canvas = dsElement('ds-canvas');
  if (!canvas || !datasheetState.pdf || !datasheetState.pageCount) return;

  // Navigation, zoom and resize all render into the same canvas without being
  // awaited, so a slower earlier call must never paint over a newer one: the
  // page on screen has to be the page the label names.
  const sequence = ++datasheetState.renderSequence;
  const current = () => sequence === datasheetState.renderSequence;

  datasheetState.pageNumber = Math.min(Math.max(1, pageNumber), datasheetState.pageCount);
  const label = dsElement('ds-page-label');
  if (label) label.textContent = `Page ${datasheetState.pageNumber} of ${datasheetState.pageCount}`;
  const previous = dsElement('ds-prev-page');
  const next = dsElement('ds-next-page');
  if (previous) previous.disabled = datasheetState.pageNumber <= 1;
  if (next) next.disabled = datasheetState.pageNumber >= datasheetState.pageCount;

  if (datasheetState.renderTask) {
    datasheetState.renderTask.cancel();
    datasheetState.renderTask = null;
  }

  const page = await datasheetState.pdf.getPage(datasheetState.pageNumber);
  if (!current()) return;
  const available = canvas.parentElement ? canvas.parentElement.clientWidth : 720;
  const base = page.getViewport({ scale: 1 });
  // Render at 2x the displayed size so spec-table small print stays sharp at
  // every zoom step instead of blurring as the canvas is scaled up in CSS.
  const fit = (available || 720) / base.width;
  const viewport = page.getViewport({ scale: fit * datasheetState.zoom * 2 });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${datasheetState.zoom * 100}%`;
  canvas.style.height = 'auto';

  const context = canvas.getContext('2d');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const task = page.render({ canvasContext: context, viewport });
  datasheetState.renderTask = task;
  try {
    await task.promise;
  } catch (error) {
    if (error && error.name === 'RenderingCancelledException') return;
    if (current()) throw error;
  } finally {
    if (datasheetState.renderTask === task) datasheetState.renderTask = null;
  }
}

function applyExtraction() {
  const extraction = datasheetState.extraction;
  datasheetState.values = DatasheetParser.toValues(extraction.fields);
  datasheetState.edited = new Set();

  const warnings = dsElement('ds-warnings');
  if (warnings) {
    warnings.textContent = '';
    const messages = extraction.warnings.slice();
    for (const message of messages) {
      const item = document.createElement('p');
      item.className = 'ds-warning';
      item.textContent = message;
      warnings.appendChild(item);
    }
    warnings.hidden = messages.length === 0;
  }

  const columnRow = dsElement('ds-column-row');
  const select = dsElement('ds-column');
  if (columnRow && select) {
    const count = extraction.columnCount || 1;
    columnRow.hidden = count < 2;
    if (count >= 2) {
      select.textContent = '';
      for (let index = 0; index < count; index += 1) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `Column ${index + 1}${index === 0 ? ' (leftmost)' : ''}`;
        select.appendChild(option);
      }
      select.value = String(datasheetState.columnIndex);
    }
  }

  renderDatasheetTable();
  renderDerived();
}

function setDatasheetWorkspace(active, hasPdf = false) {
  dsElement('ds-workspace').hidden = !active;
  dsElement('ds-empty').hidden = active;
  dsElement('ds-derived').hidden = !active;
  dsElement('ds-checks').hidden = !active;
  dsElement('ds-viewer').hidden = !hasPdf;
  dsElement('ds-clear').disabled = !active;
  dsElement('ds-manual').hidden = active;
  dsElement('ds-dropzone').classList.toggle('is-compact', active);
  dsElement('ds-upload-label').textContent = hasPdf ? 'Replace datasheet PDF' : 'Choose a datasheet PDF';
  dsElement('ds-filename').textContent = datasheetState.fileName;
  document.querySelector('.ds-back-to-inputs').hidden = !active;
  dsElement('ds-values-help').textContent = hasPdf
    ? 'Confirm each value against the PDF. Expand a source row to see where it came from.'
    : 'Enter the specifications you have. Open a group to add more values; calculations follow every edit.';
}

function setDatasheetLoading(loading) {
  document.querySelector('.ds-intake').setAttribute('aria-busy', String(loading));
  dsElement('ds-file').disabled = loading;
  dsElement('ds-manual').disabled = loading;
  dsElement('ds-upload-label').textContent = loading ? 'Opening PDF…' : (datasheetState.pdf ? 'Replace datasheet PDF' : 'Choose a datasheet PDF');
  dsElement('ds-clear').disabled = !loading && !datasheetState.extraction;
}

function resetDatasheetPdf() {
  datasheetState.renderSequence += 1;
  if (datasheetState.renderTask) datasheetState.renderTask.cancel();
  datasheetState.renderTask = null;
  if (datasheetState.pdf) datasheetState.pdf.destroy();
  datasheetState.pdf = null;
  datasheetState.pageCount = 0;
  datasheetState.pageNumber = 1;
  datasheetState.zoom = 1;
  updateDatasheetZoom();
}

function startManualEntry() {
  clearDatasheet();
  datasheetState.extraction = { fields: {}, pages: [], sourcePage: null, columnCount: 1, warnings: [] };
  setDatasheetWorkspace(true);
  // Manual entry never inherits a previously opened PDF.
  dsElement('ds-viewer').hidden = true;
  applyExtraction();
  setDatasheetStatus('Manual entry. Add the values you have; use the source sheet to confirm your inputs.');
  dsElement('ds-value-pmax_stc').focus({ preventScroll: true });
}

async function openDatasheet(file) {
  if (!file) return;
  if (!window.DatasheetParser) {
    setDatasheetStatus('The datasheet reader failed to load. Reload the page and try again.', 'error');
    return;
  }
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    setDatasheetStatus('That file is not a PDF. Choose a manufacturer’s PDF or enter values manually.', 'error');
    return;
  }
  const sequence = ++datasheetState.loadSequence;
  const current = () => sequence === datasheetState.loadSequence;
  let pdf;
  setDatasheetLoading(true);
  setDatasheetStatus(`Opening ${file.name}…`);
  try {
    const pdfjs = await loadPdfjs();
    if (!current()) return;
    const data = new Uint8Array(await file.arrayBuffer());
    if (!current()) return;
    pdf = await pdfjs.getDocument({ data }).promise;
    if (!current()) { pdf.destroy(); return; }

    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      if (!current()) { pdf.destroy(); return; }
      pages.push({ page: number, items: content.items });
    }
    const extraction = DatasheetParser.extractDatasheet(pages, { columnIndex: 0 });
    resetDatasheetPdf();
    datasheetState.pdf = pdf;
    datasheetState.rawPages = pages;
    datasheetState.pageCount = pdf.numPages;
    datasheetState.fileName = file.name;
    datasheetState.columnIndex = 0;
    datasheetState.extraction = extraction;
    dsElement('ds-manufacturer').value = '';
    dsElement('ds-model').value = file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
    setDatasheetWorkspace(true, true);
    dsElement('ds-viewer').open = true;
    applyExtraction();
    await renderDatasheetPage(extraction.sourcePage || Math.min(2, pdf.numPages));
    if (!current()) return;

    const found = Object.keys(extraction.fields).length;
    setDatasheetStatus(found
      ? `${found} specifications located on page ${extraction.sourcePage}. Confirm them against the source before relying on the results.`
      : 'No specifications were recognised. Read the source page and enter its values manually.', found ? 'info' : 'warn');
  } catch (error) {
    if (pdf && pdf !== datasheetState.pdf) pdf.destroy();
    if (!current()) return;
    const message = error && error.name === 'PasswordException'
      ? 'This PDF is password protected. Choose an unlocked copy or enter values manually.'
      : `Could not read this PDF: ${error && error.message ? error.message : 'unknown error'}. Try another PDF or enter values manually.`;
    setDatasheetStatus(message, 'error');
  } finally {
    if (current()) {
      setDatasheetLoading(false);
      dsElement('ds-file').value = '';
    }
  }
}

function updateDatasheetZoom() {
  dsElement('ds-zoom-label').textContent = `${Math.round(datasheetState.zoom * 100)}%`;
  dsElement('ds-zoom-out').disabled = datasheetState.zoom <= 1;
  dsElement('ds-zoom-in').disabled = datasheetState.zoom >= 4;
  dsElement('ds-zoom-reset').disabled = datasheetState.zoom === 1;
}

function redrawDatasheetPage(pageNumber = datasheetState.pageNumber) {
  if (dsElement('ds-viewer').hidden || !dsElement('ds-viewer').open) return;
  renderDatasheetPage(pageNumber).catch(() => {
    if (datasheetState.pdf) setDatasheetStatus('The source page could not be rendered. Try another page, Fit width, or reopen the PDF.', 'error');
  });
}

// --------------------------------------------------------------------------
// Export
// --------------------------------------------------------------------------

function exportPayload() {
  const metrics = DatasheetParser.computeMetrics(datasheetState.values);
  const fields = (datasheetState.extraction && datasheetState.extraction.fields) || {};
  const specifications = DATASHEET_ROWS
    .filter(row => row.key)
    .map(row => ({
      specification: row.label,
      value: isFilled(datasheetState.values[row.key]) ? datasheetState.values[row.key] : null,
      unit: row.unit,
      source: datasheetState.edited.has(row.key)
        ? 'entered by user'
        : (sourceFor(fields, row.key) || 'not found')
    }));

  return {
    generated: new Date().toISOString(),
    file: datasheetState.fileName,
    sourcePage: datasheetState.extraction ? datasheetState.extraction.sourcePage : null,
    manufacturer: (dsElement('ds-manufacturer') || {}).value || '',
    model: (dsElement('ds-model') || {}).value || '',
    specifications,
    calculations: {
      area_m2: metrics.area,
      efficiency_percent: metrics.efficiency,
      efficiency_stated_percent: metrics.efficiencyStated,
      fill_factor_stc: metrics.fillFactorStc,
      fill_factor_noct: metrics.fillFactorNoct,
      power_min_w: metrics.tolerance ? metrics.tolerance.min : null,
      power_max_w: metrics.tolerance ? metrics.tolerance.max : null,
      noct_vs_stc_percent: metrics.noctVsStcPercent
    },
    consistencyChecks: metrics.checks.map(check => ({
      check: check.label,
      stated: check.expected,
      computed: check.actual,
      percentApart: check.relative * 100,
      passed: check.ok
    }))
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadDatasheetFile(name, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function datasheetBaseName() {
  const model = ((dsElement('ds-model') || {}).value || datasheetState.fileName || 'module')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return model || 'module';
}

function exportDatasheetCsv() {
  const payload = exportPayload();
  const lines = [
    ['PVWatts Studio - module datasheet'],
    ['File', payload.file],
    ['Source page', payload.sourcePage],
    ['Manufacturer', payload.manufacturer],
    ['Model', payload.model],
    ['Generated', payload.generated],
    [],
    ['Specification', 'Value', 'Unit', 'Source'],
    ...payload.specifications.map(row => [row.specification, row.value, row.unit, row.source]),
    [],
    ['Calculation', 'Result'],
    ['Module area (m2)', payload.calculations.area_m2],
    ['Module efficiency (%)', payload.calculations.efficiency_percent],
    ['Module efficiency as stated (%)', payload.calculations.efficiency_stated_percent],
    ['Fill factor at STC', payload.calculations.fill_factor_stc],
    ['Fill factor at NOCT', payload.calculations.fill_factor_noct],
    ['Minimum power (W)', payload.calculations.power_min_w],
    ['Maximum power (W)', payload.calculations.power_max_w],
    ['Power difference NOCT vs STC (%)', payload.calculations.noct_vs_stc_percent],
    [],
    ['Consistency check', 'Stated', 'Computed', 'Percent apart', 'Passed'],
    ...payload.consistencyChecks.map(check => [
      check.check, check.stated, check.computed, check.percentApart, check.passed ? 'yes' : 'no'
    ])
  ];
  const csv = lines.map(line => line.map(csvCell).join(',')).join('\n');
  downloadDatasheetFile(`${datasheetBaseName()}_datasheet.csv`, csv, 'text/csv;charset=utf-8');
}

function exportDatasheetJson() {
  downloadDatasheetFile(
    `${datasheetBaseName()}_datasheet.json`,
    JSON.stringify(exportPayload(), null, 2),
    'application/json'
  );
}

function clearDatasheet() {
  datasheetState.loadSequence += 1;
  resetDatasheetPdf();
  datasheetState.rawPages = null;
  datasheetState.extraction = null;
  datasheetState.values = {};
  datasheetState.edited = new Set();
  datasheetState.columnIndex = 0;
  datasheetState.fileName = '';
  for (const id of ['ds-manufacturer', 'ds-model', 'ds-file']) dsElement(id).value = '';
  dsElement('ds-table-body').textContent = '';
  dsElement('ds-warnings').hidden = true;
  setDatasheetWorkspace(false);
  setDatasheetLoading(false);
  renderDerived();
  setDatasheetStatus('');
}

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------

function initDatasheetTab() {
  const file = dsElement('ds-file');
  const dropzone = dsElement('ds-dropzone');
  if (!file || !dropzone) return;

  file.addEventListener('change', () => {
    if (file.files && file.files[0]) openDatasheet(file.files[0]);
  });

  for (const name of ['dragenter', 'dragover']) {
    dropzone.addEventListener(name, event => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  }
  for (const name of ['dragleave', 'drop']) {
    dropzone.addEventListener(name, event => {
      event.preventDefault();
      dropzone.classList.remove('is-dragging');
    });
  }
  dropzone.addEventListener('drop', event => {
    const dropped = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!dropped) return;
    if (dropped.type && dropped.type !== 'application/pdf' && !/\.pdf$/i.test(dropped.name)) {
      setDatasheetStatus('That file is not a PDF. Datasheets download as PDFs from the manufacturer.', 'error');
      return;
    }
    openDatasheet(dropped);
  });

  const previous = dsElement('ds-prev-page');
  const next = dsElement('ds-next-page');
  if (previous) previous.addEventListener('click', () => redrawDatasheetPage(datasheetState.pageNumber - 1));
  if (next) next.addEventListener('click', () => redrawDatasheetPage(datasheetState.pageNumber + 1));

  const zoomBy = factor => {
    datasheetState.zoom = Math.min(4, Math.max(1, Math.round(datasheetState.zoom * factor * 4) / 4));
    updateDatasheetZoom();
    redrawDatasheetPage();
  };
  const zoomIn = dsElement('ds-zoom-in');
  const zoomOut = dsElement('ds-zoom-out');
  if (zoomIn) zoomIn.addEventListener('click', () => zoomBy(1.5));
  if (zoomOut) zoomOut.addEventListener('click', () => zoomBy(1 / 1.5));

  dsElement('ds-zoom-reset').addEventListener('click', () => {
    datasheetState.zoom = 1;
    updateDatasheetZoom();
    redrawDatasheetPage();
  });
  dsElement('ds-next-missing').addEventListener('click', focusNextMissingValue);

  const column = dsElement('ds-column');
  if (column) {
    column.addEventListener('change', () => {
      const index = Number(column.value) || 0;
      datasheetState.columnIndex = index;
      if (!datasheetState.rawPages) return;
      // Re-extract from the original text so switching power class replaces
      // every value at once, rather than mixing two modules in one table.
      datasheetState.extraction = DatasheetParser.extractDatasheet(
        datasheetState.rawPages, { columnIndex: index }
      );
      applyExtraction();
    });
  }

  const manual = dsElement('ds-manual');
  if (manual) manual.addEventListener('click', startManualEntry);

  const csv = dsElement('ds-export-csv');
  const json = dsElement('ds-export-json');
  const clear = dsElement('ds-clear');
  if (csv) csv.addEventListener('click', exportDatasheetCsv);
  if (json) json.addEventListener('click', exportDatasheetJson);
  if (clear) clear.addEventListener('click', () => {
    clearDatasheet();
    file.focus();
  });

  // Width changes include tab activation and disclosure opening, not just
  // window resize. Render only when the viewport is visible and has changed.
  let resizeTimer;
  let lastWidth = 0;
  const observer = new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width <= 0 || width === lastWidth) return;
    lastWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => redrawDatasheetPage(), 120);
  });
  observer.observe(document.querySelector('.ds-canvas-wrap'));
  dsElement('ds-viewer').addEventListener('toggle', () => redrawDatasheetPage());
  updateDatasheetZoom();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDatasheetTab);
} else {
  initDatasheetTab();
}
