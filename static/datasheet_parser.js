/**
 * PVWatts Studio - PV module datasheet extraction and derived metrics.
 *
 * Pure functions over positioned PDF text items (the shape pdf.js
 * `getTextContent()` returns), so the identical code runs in the browser and
 * under `node --test` against fixtures captured from real manufacturer sheets.
 *
 * Extraction is best-effort and is never presented as authoritative: every
 * value carries the datasheet row it came from, every candidate the row
 * offered, and a plausibility range that rejects nonsense. The browser layer
 * shows the PDF page beside the editable table so the user confirms or
 * corrects each number before any calculation is trusted.
 */

const MM_PER_INCH = 25.4;
const KG_PER_LB = 0.45359237;

/** Cells that label a unit column or a subscript rather than carrying a value. */
const UNIT_TOKEN =
  /^[\s(\[/]*(?:wp?|vdc|v|a|%|°\s*c|c|kg|kgs?|lbs?|mm|cm|m|in|inch|inches|ohms?|Ω|pa|psf|sq-?ft|ft|yrs?|years?|pcs?|pieces?|°|\/|%\s*\/\s*[°\s]*[ck]|[avw]\s*dc|w\s*\/\s*m2?|w\/m²)[\s)\]/:,.]*$/i;
const SUBSCRIPT_TOKEN =
  /^[\s(\[]*(?:max|min|mpp|mp|pm|oc|sc|stc|bstc|noct|nmot|ptc|dc|ac|p|v|i|e|r|n|[:*†‡•=~-])[\s)\]:,.*†‡]*$/i;

/** Accepts x, X, ×, ˣ, * as the separator in "2098 mm x 1133 mm x 35 mm". */
const DIMENSION_TRIPLE =
  /(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m|in(?:ch(?:es)?)?|")?\s*[x×ˣ*]\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m|in(?:ch(?:es)?)?|")?\s*[x×ˣ*]\s*(\d+(?:[.,]\d+)?)/i;

const NUMBER = /[+-]?\d+(?:[.,]\d+)?/;
/** A value given as a percentage — but not a per-degree rate like "-0.24 %/°C". */
const BARE_PERCENT = /^[^\d+-]{0,3}[+-]?\d[\d.,]*\s*%(?!\s*\/)/;

function normalize(text) {
  return String(text)
    .replace(/ /g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercased, punctuation-light form used for label matching. */
function labelKey(text) {
  return normalize(text)
    .toLowerCase()
    .replace(/[*†‡•]/g, '')
    .replace(/[_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasDigit(text) {
  return /\d/.test(text);
}

function toNumber(text) {
  const match = normalize(text).match(NUMBER);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Converts pdf.js text items to the flat, positioned shape the parser uses.
 * Rotated items (engineering-drawing callouts and gutter labels) are dropped:
 * they share y-bands with real table rows and only inject noise.
 */
function fromTextContent(items) {
  const out = [];
  for (const item of items || []) {
    if (typeof item.str !== 'string' || item.str.trim() === '') continue;
    const t = item.transform || [1, 0, 0, 1, 0, 0];
    const skewed = Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01;
    if (skewed) continue;
    out.push({
      str: item.str,
      x: t[4],
      y: t[5],
      w: Number.isFinite(item.width) && item.width > 0 ? item.width : item.str.length * 4,
      h: Number.isFinite(item.height) && item.height > 0 ? item.height : 8
    });
  }
  return out;
}

/** Clusters items into visual rows by baseline, then into cells by x-gap. */
function buildRows(items) {
  const rows = [];
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);

  for (const item of sorted) {
    // 0.55 covers subscripts and columns typeset a few points off the row
    // baseline (REC does both) while staying well inside real row spacing.
    const tolerance = Math.max(1.5, 0.55 * Math.max(item.h, 4));
    let best = null;
    let bestDistance = Infinity;
    for (const row of rows) {
      const distance = Math.abs(row.y - item.y);
      if (distance <= Math.max(tolerance, 0.55 * Math.max(row.h, 4)) && distance < bestDistance) {
        best = row;
        bestDistance = distance;
      }
    }
    if (best) {
      best.items.push(item);
      best.h = Math.max(best.h, item.h);
    } else {
      rows.push({ y: item.y, h: item.h, items: [item] });
    }
  }

  return rows.map(row => {
    row.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const item of row.items) {
      const previous = cells[cells.length - 1];
      const gap = previous ? item.x - (previous.x + previous.w) : Infinity;
      const spacing = 0.42 * Math.max(item.h, 4);
      if (previous && gap <= spacing) {
        previous.text += gap > 0.12 * Math.max(item.h, 4) ? ' ' + item.str : item.str;
        previous.w = item.x + item.w - previous.x;
      } else {
        cells.push({ text: item.str, x: item.x, w: item.w, h: item.h });
      }
    }
    for (const cell of cells) cell.text = normalize(cell.text);
    return { y: row.y, h: row.h, cells, text: cells.map(c => c.text).join(' | ') };
  }).sort((a, b) => b.y - a.y);
}

/**
 * Test-condition column headers ("STC", "NOCT", "NMOT", "BSTC") that sit above
 * a block of electrical rows. Sheets laid out this way (Silfab, Qcells, many
 * others) let each value be assigned to its condition by x-alignment instead of
 * by guessing from document order.
 */
const CONDITION_HEADERS = [
  { condition: 'stc', pattern: /^\(?\s*stc\s*\)?$|^standard test conditions?\b/i },
  { condition: 'bstc', pattern: /^\(?\s*bstc\s*\)?$|^bifacial standard test/i },
  { condition: 'noct', pattern: /^\(?\s*(?:noct|nmot|nnoct)\s*\)?$|^nominal (?:module |cell )?operating/i }
];

function findConditionColumns(rows) {
  for (const row of rows) {
    const matches = [];
    for (const cell of row.cells) {
      const text = normalize(cell.text);
      const header = CONDITION_HEADERS.find(candidate => candidate.pattern.test(text));
      if (header) matches.push({ condition: header.condition, label: text, x: cell.x, w: cell.w });
    }
    // Two or more condition headers on one line is a column layout; a lone
    // "STC" is far more likely to be a footnote or a section title.
    if (matches.length >= 2) return { y: row.y, columns: matches };
  }
  return null;
}

/**
 * Field catalogue. `patterns` match the label cell; `range` rejects values that
 * cannot physically be that quantity, which is what stops drawing callouts and
 * neighbouring-table text from being read as data.
 */
const FIELDS = [
  {
    key: 'pmax', group: 'electrical', conditional: true, unit: 'W',
    label: 'Maximum power (Pmax)', range: [40, 1200],
    // "Power" opens many other labels on the same sheet; exclude them so the
    // greedy Pmax pattern cannot claim the Vmp, Imp or tolerance row.
    exclude: /\b(?:voltage|current|tolerance|sorting|class|warranty|guarantee|bifacial\w*|temp\w*|coeff\w*|tk|density|loss|degradation|rating range|per pallet|years?|yrs?)\b/i,
    patterns: [
      /^(?:nominal )?(?:max\.?(?:imum)? )?power(?: output)?\b/i,
      /^module power\b/i,
      /^(?:peak|rated|nominal) power\b/i,
      /^p\s*max\b/i,
      /^pmpp?\b/i,
      /^maximum power ?\(?p/i
    ]
  },
  {
    key: 'vmp', group: 'electrical', conditional: true, unit: 'V',
    label: 'Voltage at max power (Vmp)', range: [5, 150],
    // A coefficient or warranty row names the same quantity without stating it.
    exclude: /\b(?:temp\w*|coeff\w*|tk|warranty|guarantee|degradation|per year|annual)\b/i,
    patterns: [
      /^(?:nominal |opt\.? |optimum )?(?:operating )?(?:power )?voltage\b/i,
      /^max(?:\.|imum)? power(?:point)? voltage\b/i,
      /^voltage at (?:max|nominal|maximum)/i,
      /^v\s*(?:mpp?|pmax|pm)\b/i,
      /^mpp voltage\b/i
    ]
  },
  {
    key: 'imp', group: 'electrical', conditional: true, unit: 'A',
    label: 'Current at max power (Imp)', range: [0.5, 60],
    // A coefficient or warranty row names the same quantity without stating it.
    exclude: /\b(?:temp\w*|coeff\w*|tk|warranty|guarantee|degradation|per year|annual)\b/i,
    patterns: [
      /^(?:nominal |opt\.? |optimum )?(?:operating )?(?:power )?current\b/i,
      /^max(?:\.|imum)? power(?:point)? current\b/i,
      /^current at (?:max|nominal|maximum)/i,
      /^i\s*(?:mpp?|pmax|pm)\b/i,
      /^mpp current\b/i
    ]
  },
  {
    key: 'voc', group: 'electrical', conditional: true, unit: 'V',
    label: 'Open-circuit voltage (Voc)', range: [5, 200],
    // A coefficient or warranty row names the same quantity without stating it.
    exclude: /\b(?:temp\w*|coeff\w*|tk|warranty|guarantee|degradation|per year|annual)\b/i,
    patterns: [/^open[- ]circuit voltage\b/i, /^v\s*oc\b/i, /^u\s*oc\b/i]
  },
  {
    key: 'isc', group: 'electrical', conditional: true, unit: 'A',
    label: 'Short-circuit current (Isc)', range: [0.5, 60],
    // A coefficient or warranty row names the same quantity without stating it.
    exclude: /\b(?:temp\w*|coeff\w*|tk|warranty|guarantee|degradation|per year|annual)\b/i,
    patterns: [/^short[- ]circuit current\b/i, /^i\s*sc\b/i]
  },
  {
    key: 'efficiency', group: 'electrical', conditional: true, unit: '%',
    label: 'Module efficiency (datasheet)', range: [5, 35],
    // A coefficient or warranty row names the same quantity without stating it.
    exclude: /\b(?:temp\w*|coeff\w*|tk|warranty|guarantee|degradation|per year|annual)\b/i,
    patterns: [/^(?:module|panel|cell)? ?efficien/i, /^efficiency\b/i, /^η\b/i]
  },

  {
    key: 'noctTemp', group: 'temperature', unit: '°C',
    label: 'NOCT / NMOT cell temperature', range: [25, 70],
    patterns: [
      /^noct\b/i,
      /^nmot\b/i,
      /^nominal (?:module |cell )?operating (?:cell )?temp/i
    ]
  },
  {
    key: 'tcPmax', group: 'temperature', unit: '%/°C',
    label: 'Temperature coefficient of Pmax', range: [-1.2, 0],
    patterns: [
      /^temp(?:erature)?\.?\s*coeff?(?:icient)?s?\.?\s*(?:of\s+)?\(?p/i,
      /^tk ?p/i,
      /^(?:gamma|γ)\b/i,
      /^(?:power|p\s*max|p\s*mpp)\b[^a-z]*temp(?:erature)?\.?\s*coeff/i
    ]
  },
  {
    key: 'tcVoc', group: 'temperature', unit: '%/°C',
    label: 'Temperature coefficient of Voc', range: [-1.2, 0],
    patterns: [
      /^temp(?:erature)?\.?\s*coeff?(?:icient)?s?\.?\s*(?:of\s+)?\(?[uv]/i,
      /^tk ?[uv]/i,
      /^(?:beta|β)\b/i,
      /^(?:voltage|v\s*oc|u\s*oc)\b[^a-z]*temp(?:erature)?\.?\s*coeff/i
    ]
  },
  {
    key: 'tcIsc', group: 'temperature', unit: '%/°C',
    label: 'Temperature coefficient of Isc', range: [-0.2, 0.2],
    patterns: [
      /^temp(?:erature)?\.?\s*coeff?(?:icient)?s?\.?\s*(?:of\s+)?\(?i/i,
      /^tk ?i/i,
      /^(?:alpha|α)\b/i,
      /^(?:current|i\s*sc)\b[^a-z]*temp(?:erature)?\.?\s*coeff/i
    ]
  },

  {
    key: 'maxSystemVoltage', group: 'ratings', unit: 'V',
    label: 'Maximum system voltage', range: [500, 2000],
    patterns: [/^max(?:\.|imum)? (?:dc )?system voltage\b/i, /^system voltage\b/i]
  },
  {
    key: 'maxSeriesFuse', group: 'ratings', unit: 'A',
    label: 'Maximum series fuse rating', range: [1, 60],
    patterns: [
      /^max(?:\.|imum)? series fuse\b/i,
      /^series fuse (?:rating)?\b/i,
      /^max(?:\.|imum)? (?:over ?current protection|ocpd)/i,
      /^fuse rating\b/i
    ]
  },
  {
    key: 'powerTolerance', group: 'ratings', unit: '', type: 'text',
    label: 'Power tolerance',
    patterns: [/^power (?:output )?tolerance\b/i, /^watt class sorting\b/i, /^tolerance\b/i, /^power sorting\b/i]
  },
  {
    key: 'bifaciality', group: 'ratings', unit: '%',
    label: 'Bifaciality factor', range: [40, 100],
    // A bare "Bifacial" is a gutter label on the STC table, not this field.
    patterns: [/^(?:power )?bifaciality\b/i, /^bifacial (?:factor|gain)\b/i]
  },

  {
    key: 'cells', group: 'mechanical', unit: 'cells',
    label: 'Cells per module', range: [24, 260],
    patterns: [
      /^(?:number of |no\.? of |# ?of )?(?:half[- ]?cut |half[- ])?cells?\b/i,
      /^cell (?:type|arrangement|configuration|number|count)\b/i,
      /^solar cells?\b/i
    ]
  },
  {
    key: 'dimensions', group: 'mechanical', unit: 'mm', type: 'dimensions',
    label: 'Dimensions (H x L x D)',
    patterns: [/^(?:module |panel |overall )?(?:dimensions?|size)\b/i, /^format\b/i]
  },
  {
    key: 'weight', group: 'mechanical', unit: 'kg', type: 'weight',
    label: 'Module weight', range: [3, 120],
    patterns: [/^(?:module |panel )?weight\b/i, /^mass\b/i]
  }
];

/** Rejects a numeric candidate that cannot physically be this quantity. */
function inRange(field, value) {
  if (!field.range || value === null) return value !== null;
  return value >= field.range[0] && value <= field.range[1];
}

function matchField(text) {
  const key = labelKey(text);
  if (!key) return null;
  for (const field of FIELDS) {
    if (field.exclude && field.exclude.test(key)) continue;
    if (field.patterns.some(pattern => pattern.test(key))) return field;
  }
  return null;
}

/** Skippable cells between a label and its value: units, subscripts, colons. */
function isSkippable(text) {
  const value = normalize(text);
  if (!value) return true;
  if (hasDigit(value)) return false;
  if (UNIT_TOKEN.test(value) || SUBSCRIPT_TOKEN.test(value) || /^[\s:()\[\]/,.*†‡•-]+$/.test(value)) return true;
  // A short symbol cell (α, β, γ, VSYS, IR, [% / K]) separates a label from its
  // value on many sheets. Anything that is itself a known label still stops the
  // scan, so a neighbouring table can never be read as this row's value.
  const bare = value.replace(/^[\s(\[]+|[\s)\]:,.]+$/g, '');
  return bare.length > 0 && bare.length <= 8 && !/\s{2,}/.test(bare) && !matchField(bare);
}

function parseWeight(text) {
  const source = normalize(text);
  const kg = source.match(new RegExp(`(${NUMBER.source})\\s*kgs?\\b`, 'i'));
  const lb = source.match(new RegExp(`(${NUMBER.source})\\s*lbs?\\b`, 'i'));
  if (kg) return { value: Number(kg[1].replace(/,/g, '')), unit: 'kg' };
  if (lb) return { value: Number(lb[1].replace(/,/g, '')) * KG_PER_LB, unit: 'kg' };
  const bare = toNumber(source);
  return bare === null ? null : { value: bare, unit: 'kg' };
}

/**
 * Reads "2098 mm x 1133 mm x 35 mm" or "74.8 x 40.9 x 1.2 in" into millimetres.
 * Metric is preferred when a sheet prints both, because the imperial column is
 * rounded and round-tripping it loses the manufacturer's stated value.
 */
function parseDimensions(text) {
  const source = normalize(text);
  const metric = source.match(/([^()\[\]]*\bmm\b[^()\[\]]*)/i);
  const candidates = metric ? [metric[1], source] : [source];
  for (const candidate of candidates) {
    const match = candidate.match(DIMENSION_TRIPLE);
    if (!match) continue;
    const numbers = [match[1], match[2], match[3]].map(n => Number(n.replace(/,/g, '')));
    const imperial = /\b(?:in|inch|inches)\b|"/i.test(candidate) && !/\bmm\b/i.test(candidate);
    const mm = imperial ? numbers.map(n => n * MM_PER_INCH) : numbers;
    if (mm.some(n => !Number.isFinite(n) || n <= 0)) continue;
    const sorted = mm.slice().sort((a, b) => b - a);
    if (sorted[0] < 400 || sorted[0] > 3000 || sorted[2] > 120) continue;
    return { height: sorted[0], length: sorted[1], thickness: sorted[2], unit: 'mm' };
  }
  return null;
}

/**
 * A table cell holding a value reads as one ("10.60", "GR 11.39", "≥ 20.9",
 * "1000 (IEC) / 1500 (UL)", "-0.34 %/°C"). A phrase that merely ends in a digit
 * ("Fire Type Class 2", "C / TYPE 29") is a neighbouring table's text that
 * happens to share this baseline, and reporting its trailing number as a
 * reading would be exactly the plausible-but-wrong failure this reader exists
 * to prevent. At most three characters of noise may precede the number, which
 * keeps comparison marks and short drawing labels usable.
 */
function looksLikeValue(text) {
  const value = normalize(text);
  if (!hasDigit(value)) return false;
  const lead = value.match(/^[^\d+-]*/)[0];
  return lead.replace(/[\s(\[]/g, '').length <= 3;
}

/** Collects the value cells that follow a matched label cell on the same row. */
function valueCells(cells, labelIndex) {
  const values = [];
  let unit = '';
  for (let index = labelIndex + 1; index < cells.length; index += 1) {
    const cell = cells[index];
    const text = cell.text;
    if (!hasDigit(text)) {
      if (isSkippable(text)) {
        if (UNIT_TOKEN.test(normalize(text)) && !unit) unit = normalize(text).replace(/^[(\[]|[)\]]$/g, '');
        continue;
      }
      break; // A digit-free phrase is the next table's label, not our value.
    }
    if (matchField(text) && !values.length) break;
    if (!looksLikeValue(text)) break;
    values.push(cell);
  }
  return { values, unit };
}

const COLUMN_TOLERANCE = 26;

/**
 * Derives the sheet's value columns from where accepted numbers actually sit.
 *
 * Index alignment alone is unsafe: if one row's second number is rejected as
 * implausible, its third number slides into the second slot and the column
 * picker starts mixing values from two different modules. Clustering by x
 * position ties every field to a physical column instead, and a column that
 * shows up in only one row is dropped rather than offered as a power class.
 */
function valueColumns(occurrences) {
  const clusters = [];
  for (const occurrence of occurrences) {
    if (!occurrence.field.conditional) continue;
    for (const candidate of occurrence.candidates) {
      const centre = candidate.x;
      const cluster = clusters.find(c => Math.abs(c.x - centre) <= COLUMN_TOLERANCE);
      if (cluster) {
        cluster.x = (cluster.x * cluster.rows.size + centre) / (cluster.rows.size + 1);
        cluster.rows.add(occurrence);
      } else {
        clusters.push({ x: centre, rows: new Set([occurrence]) });
      }
    }
  }
  return clusters
    .filter(cluster => cluster.rows.size >= 2)
    .sort((a, b) => a.x - b.x)
    .map(cluster => cluster.x);
}

function nearestColumn(columns, cell) {
  let best = null;
  let bestDistance = Infinity;
  for (const column of columns) {
    const distance = Math.abs(column.x + column.w / 2 - (cell.x + cell.w / 2));
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  return bestDistance <= 60 ? best : null;
}

/**
 * Extracts every labelled occurrence on the page, in document order.
 * Condition assignment happens afterwards in `resolveFields`.
 */
function collectOccurrences(rows, conditionColumns) {
  const occurrences = [];
  for (const row of rows) {
    for (let index = 0; index < row.cells.length; index += 1) {
      const field = matchField(row.cells[index].text);
      if (!field) continue;
      const { values, unit } = valueCells(row.cells, index);
      if (!values.length) continue;

      const candidates = [];
      for (const cell of values) {
        const entry = {
          raw: cell.text,
          x: cell.x,
          condition: conditionColumns ? (nearestColumn(conditionColumns.columns, cell) || {}).condition || null : null
        };
        if (field.type === 'text') {
          entry.value = cell.text;
          entry.ok = true;
        } else if (field.type === 'dimensions') {
          const parsed = parseDimensions(row.cells.slice(index + 1).map(c => c.text).join(' '));
          if (!parsed) continue;
          entry.value = parsed;
          entry.ok = true;
        } else if (field.type === 'weight') {
          const parsed = parseWeight(cell.text);
          if (!parsed) continue;
          entry.value = parsed.value;
          entry.ok = inRange(field, parsed.value);
        } else {
          const numeric = toNumber(cell.text);
          entry.value = numeric;
          // "98%" in a warranty table is not 98 W, however plausible it looks.
          const percentage = !/%/.test(field.unit || '') && BARE_PERCENT.test(normalize(cell.text));
          entry.ok = !percentage && inRange(field, numeric);
        }
        candidates.push(entry);
        if (field.type === 'dimensions') break;
      }

      const accepted = candidates.filter(candidate => candidate.ok);
      if (!accepted.length) continue;
      occurrences.push({
        field,
        y: row.y,
        rowText: row.text,
        label: row.cells[index].text,
        unit: unit || field.unit,
        candidates: accepted
      });
      index += values.length;
    }
  }
  return occurrences;
}

/**
 * Cell counts are printed inconsistently: sometimes as a labelled row, often as
 * free text ("132 Half cells - N-Type", "132 half-cut, bifacial") whose label
 * sits on a different visual row. A page-wide scan for a count immediately
 * followed by the word "cell" catches both without loosening the label rules.
 */
const CELL_COUNT_TEXT = /\b(\d{2,3})\s*(?:\[[^\]]*\]\s*)?(?:half[- ]?cut\b|(?:half[- ]?|monocrystalline |mono |n-type |p-type )*cells?\b)/i;

const CELL_GRID_TEXT = /\b(\d{1,2})\s*[x×ˣ*]\s*(\d{1,3})\b(?=[\s\S]{0,40}?cells?\b)/i;

function findCellCount(rows) {
  for (const row of rows) {
    for (const cell of row.cells) {
      const text = normalize(cell.text);
      const direct = text.match(CELL_COUNT_TEXT);
      if (direct) {
        const count = Number(direct[1]);
        if (count >= 24 && count <= 260) {
          return { value: count, raw: cell.text, rowText: row.text, halfCell: /half/i.test(text) };
        }
      }
      // "6 x 22 monocrystalline half cells" states the grid, not the total.
      const grid = text.match(CELL_GRID_TEXT);
      if (grid && Number(grid[1]) >= 2 && Number(grid[2]) >= 2) {
        const count = Number(grid[1]) * Number(grid[2]);
        if (count >= 24 && count <= 260) {
          return { value: count, raw: cell.text, rowText: row.text, halfCell: /half/i.test(text) };
        }
      }
    }
  }
  return null;
}

/** Dimensions printed on a row of their own, away from their label. */
function findDimensions(rows) {
  // Two passes: a sheet that prints both prints the exact figures in
  // millimetres and a rounded inch line beside them.
  for (const metricOnly of [true, false]) {
    for (const row of rows) {
      for (const cell of row.cells) {
        if (metricOnly && !/\bmm\b/i.test(cell.text)) continue;
        const parsed = parseDimensions(cell.text);
        if (parsed) return { value: parsed, raw: cell.text, rowText: row.text };
      }
    }
  }
  return null;
}

/** Power tolerance stated inside a longer block heading. */
const TOLERANCE_IN_HEADING = /power tolerance[:\s]*([^)\]]{1,32})/i;

function findPowerTolerance(rows) {
  for (const row of rows) {
    for (const cell of row.cells) {
      const match = normalize(cell.text).match(TOLERANCE_IN_HEADING);
      if (match && /\d/.test(match[1])) {
        return { value: match[1].trim(), raw: cell.text, rowText: row.text };
      }
    }
  }
  return null;
}

/**
 * Turns raw occurrences into one value per field.
 *
 * Conditional electrical fields are resolved by named column when the sheet
 * declares STC/NOCT columns, and otherwise by document order: every module
 * datasheet prints the STC block before the NOCT/NMOT block, so the first
 * occurrence is STC and the second is NOCT.
 */
function candidateAt(occurrence, columnIndex, columns) {
  if (occurrence.field.conditional && columns.length > 1) {
    const target = columns[Math.min(columnIndex, columns.length - 1)];
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of occurrence.candidates) {
      const distance = Math.abs(candidate.x - target);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    // A row that does not reach this column simply has no value for it.
    return bestDistance <= COLUMN_TOLERANCE ? best : null;
  }
  // Ratings and mechanical rows are stated once for the whole sheet unless they
  // genuinely print one value per column, so they must not follow the picker.
  const usable = occurrence.candidates.length >= Math.max(2, columns.length);
  const index = usable ? Math.min(columnIndex, occurrence.candidates.length - 1) : 0;
  return occurrence.candidates[index];
}

/**
 * Decides what the second electrical block is.
 *
 * STC is always printed first. The block after it is NOCT/NMOT only when it
 * states less power, because NOCT is measured at 800 W/m². A block stating more
 * power is a bifacial-gain table (BNPI, BSTC), and labelling that NOCT would
 * quietly corrupt every NOCT-based calculation.
 */
function secondBlockCondition(byKey, columnIndex, columns) {
  const list = byKey.get('pmax');
  if (!list || list.length < 2) return { condition: 'noct', bifacial: false };
  const powerOf = occurrence => {
    const candidate = candidateAt(occurrence, columnIndex, columns);
    return candidate ? Number(candidate.value) : NaN;
  };
  const first = powerOf(list[0]);
  const second = powerOf(list[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return { condition: 'noct', bifacial: false };
  return second < first ? { condition: 'noct', bifacial: false } : { condition: 'bstc', bifacial: true };
}

function resolveFields(occurrences, columnIndex, columns = []) {
  const fields = {};
  const notes = [];
  const byKey = new Map();
  for (const occurrence of occurrences) {
    if (!byKey.has(occurrence.field.key)) byKey.set(occurrence.field.key, []);
    byKey.get(occurrence.field.key).push(occurrence);
  }
  const second = secondBlockCondition(byKey, columnIndex, columns);
  if (second.bifacial) {
    notes.push(
      'The second electrical block states more power than STC, so it was read as a bifacial block rather than NOCT/NMOT. ' +
      'This sheet may not publish NOCT values at all — leave those rows blank unless you find them on the page.'
    );
  }

  const assign = (key, occurrence, candidate) => {
    if (!candidate || fields[key]) return;
    fields[key] = {
      key,
      label: occurrence.field.label,
      group: occurrence.field.group,
      unit: occurrence.unit,
      value: candidate.value,
      raw: candidate.raw,
      rowText: occurrence.rowText,
      condition: candidate.condition || null,
      candidates: occurrence.candidates.map(c => c.raw)
    };
  };

  for (const [key, list] of byKey) {
    const field = list[0].field;
    if (!field.conditional) {
      const occurrence = list[0];
      assign(key, occurrence, candidateAt(occurrence, columnIndex, columns));
      continue;
    }

    const named = { stc: null, noct: null, bstc: null };
    for (const occurrence of list) {
      for (const candidate of occurrence.candidates) {
        if (candidate.condition && !named[candidate.condition]) {
          named[candidate.condition] = { occurrence, candidate };
        }
      }
    }

    if (named.stc || named.noct) {
      for (const condition of ['stc', 'noct', 'bstc']) {
        const hit = named[condition];
        if (hit) assign(`${key}_${condition}`, hit.occurrence, hit.candidate);
      }
      continue;
    }

    // No condition columns: the first block is STC and the second is whatever
    // `secondBlockCondition` established it to be.
    const conditions = ['stc', second.condition];
    list.slice(0, 2).forEach((occurrence, order) => {
      assign(`${key}_${conditions[order]}`, occurrence, candidateAt(occurrence, columnIndex, columns));
    });
  }

  return { fields, notes };
}

/**
 * Cross-checks that catch a mis-read value without the user hunting for it.
 * Each one compares two numbers the datasheet states independently, so a
 * disagreement means at least one of them was extracted or typed wrong.
 */
function crossChecks(values) {
  const checks = [];
  const number = key => (Number.isFinite(Number(values[key])) ? Number(values[key]) : null);

  const push = (label, expected, actual, tolerance, note) => {
    if (expected === null || actual === null || !Number.isFinite(expected) || !Number.isFinite(actual)) return;
    const delta = Math.abs(expected - actual);
    const relative = Math.abs(expected) > 0 ? delta / Math.abs(expected) : delta;
    checks.push({ label, expected, actual, delta, relative, ok: relative <= tolerance, note });
  };

  const pmax = number('pmax_stc');
  const vmp = number('vmp_stc');
  const imp = number('imp_stc');
  push(
    'Pmax vs Vmp x Imp (STC)', pmax, vmp !== null && imp !== null ? vmp * imp : null, 0.02,
    'The datasheet Pmax should equal Vmp x Imp to within rounding.'
  );

  const noctPmax = number('pmax_noct');
  const noctVmp = number('vmp_noct');
  const noctImp = number('imp_noct');
  push(
    'Pmax vs Vmp x Imp (NOCT)', noctPmax, noctVmp !== null && noctImp !== null ? noctVmp * noctImp : null, 0.02,
    'Same identity at NOCT/NMOT conditions.'
  );

  const area = moduleArea(values);
  const stated = number('efficiency_stc');
  push(
    'Efficiency: datasheet vs Pmax / area', stated,
    area && pmax !== null ? (pmax / (area * 1000)) * 100 : null, 0.02,
    'Module efficiency must equal Pmax divided by area at 1000 W/m2.'
  );

  push(
    'NOCT Pmax plausibility', noctPmax, pmax !== null ? pmax * 0.75 : null, 0.12,
    'NOCT power is typically 72-80% of STC power; a large gap suggests a mis-read row.'
  );

  return checks;
}

function moduleArea(values) {
  const height = Number(values.height_mm);
  const length = Number(values.length_mm);
  if (!Number.isFinite(height) || !Number.isFinite(length) || height <= 0 || length <= 0) return null;
  return (height / 1000) * (length / 1000);
}

/**
 * Reads a power-tolerance string into absolute minimum and maximum power.
 * Handles the two forms manufacturers actually print: watt ranges
 * ("0 to +10 Wp", "-0/+5 W", "0/+10") and percentages ("+/-3%", "0/+3%").
 */
function powerToleranceBounds(tolerance, pmax) {
  if (!Number.isFinite(pmax) || pmax <= 0) return null;
  const text = normalize(tolerance || '')
    .replace(/[±]/g, '+-')
    .replace(/\+\s*\/\s*-|-\s*\/\s*\+(?!\s*\d)/g, '+-')
    .replace(/([+-]{1,2})\s+(?=\d)/g, '$1');
  if (!text) return null;

  const percent = /%/.test(text);
  const numbers = text.match(/[+-]{0,2}\d+(?:[.,]\d+)?/g);
  if (!numbers || !numbers.length) return null;

  const parsed = numbers.map(raw => {
    const negative = /^\+-/.test(raw) ? null : raw.startsWith('-');
    const magnitude = Number(raw.replace(/[^\d.,]/g, '').replace(/,/g, ''));
    return { raw, magnitude, negative, symmetric: /^\+-/.test(raw) };
  }).filter(entry => Number.isFinite(entry.magnitude));
  if (!parsed.length) return null;

  let low;
  let high;
  if (parsed.length === 1 && parsed[0].symmetric) {
    low = -parsed[0].magnitude;
    high = parsed[0].magnitude;
  } else if (parsed.length === 1) {
    low = parsed[0].negative ? -parsed[0].magnitude : 0;
    high = parsed[0].negative ? 0 : parsed[0].magnitude;
  } else {
    const first = parsed[0].negative === true ? -parsed[0].magnitude : parsed[0].magnitude;
    const second = parsed[1].negative === true ? -parsed[1].magnitude : parsed[1].magnitude;
    low = Math.min(first, second);
    high = Math.max(first, second);
  }

  const toWatts = value => (percent ? (pmax * value) / 100 : value);
  return {
    min: pmax + toWatts(low),
    max: pmax + toWatts(high),
    basis: percent ? 'percent' : 'watt',
    low,
    high
  };
}

/**
 * Every derived number the exercise asks for, computed from the confirmed
 * values rather than from anything the parser guessed.
 */
function computeMetrics(values) {
  const number = key => {
    const value = Number(values[key]);
    return Number.isFinite(value) ? value : null;
  };

  const metrics = {};
  const area = moduleArea(values);
  metrics.area = area;

  const pmaxStc = number('pmax_stc');
  const pmaxNoct = number('pmax_noct');

  metrics.efficiency = area && pmaxStc !== null ? (pmaxStc / (area * 1000)) * 100 : null;
  metrics.efficiencyStated = number('efficiency_stc');

  const fill = (p, v, i, vo, is) => {
    const vmp = number(v);
    const imp = number(i);
    const voc = number(vo);
    const isc = number(is);
    if (vmp === null || imp === null || voc === null || isc === null) return null;
    const denominator = voc * isc;
    return denominator > 0 ? (vmp * imp) / denominator : null;
  };
  metrics.fillFactorStc = fill('pmax_stc', 'vmp_stc', 'imp_stc', 'voc_stc', 'isc_stc');
  metrics.fillFactorNoct = fill('pmax_noct', 'vmp_noct', 'imp_noct', 'voc_noct', 'isc_noct');

  // Professor's formula: (high - low) / high x 100.
  metrics.noctVsStcPercent =
    pmaxStc !== null && pmaxNoct !== null && pmaxStc !== 0
      ? ((pmaxStc - pmaxNoct) / pmaxStc) * 100
      : null;

  metrics.tolerance = powerToleranceBounds(values.powerTolerance, pmaxStc);
  metrics.checks = crossChecks(values);
  return metrics;
}

/**
 * Flattens extraction output into the single-level value bag the table edits
 * and `computeMetrics` both work from. Dimensions become three separate
 * millimetre entries because the user needs to correct them independently.
 */
function toValues(fields) {
  const values = {};
  for (const [key, field] of Object.entries(fields || {})) {
    if (key === 'dimensions' && field.value && typeof field.value === 'object') {
      values.height_mm = round(field.value.height, 2);
      values.length_mm = round(field.value.length, 2);
      values.thickness_mm = round(field.value.thickness, 2);
    } else if (key === 'weight') {
      values.weight = round(field.value, 3);
    } else {
      values[key] = field.value;
    }
  }
  return values;
}

function round(value, places) {
  if (!Number.isFinite(Number(value))) return value;
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

/**
 * Full extraction over the pages pdf.js handed back.
 *
 * `preferredPage` reflects the near-universal module-datasheet layout the user
 * described: page 1 is marketing, page 2 carries the tables. The page that
 * yields the most recognised fields wins, so single-page and three-page sheets
 * still work.
 *
 * ponytail: reads label-per-row sheets (Silfab, REC, Qcells, LONGi, Jinko,
 * Trina, JA). Sheets that transpose the STC table so models are rows and
 * quantities are wrapped multi-line column headers (Canadian Solar) yield the
 * mechanical block only; the electrical cells stay blank for manual entry.
 * Upgrade path is vertical header reconstruction, worth doing only if those
 * sheets turn out to be common in practice.
 */
function extractDatasheet(pages, options = {}) {
  const columnIndex = Number.isInteger(options.columnIndex) ? options.columnIndex : 0;
  const analysed = (pages || []).map(page => {
    const items = page.items && page.items.length && page.items[0].transform
      ? fromTextContent(page.items)
      : (page.items || []);
    const rows = buildRows(items);
    const conditionColumns = findConditionColumns(rows);
    const occurrences = collectOccurrences(rows, conditionColumns);
    return {
      page: page.page,
      rows,
      conditionColumns,
      occurrences,
      text: rows.map(row => row.cells.map(cell => cell.text).join(' ')).join('\n')
    };
  });

  const scored = analysed.map(page => ({
    page,
    score: new Set(page.occurrences.map(o => o.field.key)).size
  }));
  const best = scored.slice().sort((a, b) => b.score - a.score || a.page.page - b.page.page)[0];
  const source = best && best.score > 0 ? best.page : analysed[Math.min(1, analysed.length - 1)] || analysed[0];
  if (!source) return { fields: {}, pages: [], sourcePage: null, columnCount: 1, warnings: ['No text found in this PDF.'] };

  const columns = source.conditionColumns ? [] : valueColumns(source.occurrences);
  const columnCount = Math.max(1, Math.min(8, columns.length));

  const resolved = resolveFields(source.occurrences, columnIndex, columns);
  const fields = resolved.fields;

  // Sheets that print these away from their label, or inside a block heading.
  const fallbacks = [
    ['cells', findCellCount, 'Cells per module', 'mechanical', 'cells'],
    ['dimensions', findDimensions, 'Dimensions (H x L x D)', 'mechanical', 'mm'],
    ['powerTolerance', findPowerTolerance, 'Power tolerance', 'ratings', '']
  ];
  for (const [key, find, label, group, unit] of fallbacks) {
    if (fields[key]) continue;
    const found = find(source.rows);
    if (!found) continue;
    fields[key] = {
      key, label, group, unit,
      value: found.value, raw: found.raw, rowText: found.rowText, condition: null,
      candidates: [found.raw]
    };
    if (found.halfCell !== undefined) fields[key].halfCell = found.halfCell;
  }

  const warnings = resolved.notes.slice();
  if (!Object.keys(fields).length) {
    warnings.push('No datasheet values were recognised. The PDF may be a scan without a text layer, or use a layout this reader does not handle. Enter the values manually from the page shown.');
  }
  if (!source.conditionColumns && fields.pmax_noct) {
    warnings.push('STC and NOCT values were separated by their order on the page, not by a labelled column. Confirm both blocks against the PDF.');
  }

  return {
    fields,
    pages: analysed,
    sourcePage: source.page,
    conditionColumns: source.conditionColumns,
    columnCount,
    warnings
  };
}

const DatasheetParser = {
  buildRows,
  fromTextContent,
  findCellCount,
  findDimensions,
  findPowerTolerance,
  extractDatasheet,
  toValues,
  computeMetrics,
  powerToleranceBounds,
  parseDimensions,
  parseWeight,
  crossChecks,
  moduleArea,
  looksLikeValue,
  valueColumns,
  normalize,
  labelKey,
  FIELDS,
  MM_PER_INCH,
  KG_PER_LB
};

if (typeof window !== 'undefined') window.DatasheetParser = DatasheetParser;
if (typeof module !== 'undefined' && module.exports) module.exports = DatasheetParser;
