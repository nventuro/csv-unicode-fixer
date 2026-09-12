/**
 * Repairs characters that survive a round trip through Word, a web page or a
 * PDF and then break whatever reads the CSV next.
 *
 * Fields that no fix touches are copied through unchanged, so the output
 * differs from the input only where a fix actually applied.
 */

/** The repairs on offer, in the order they should be presented and applied. */
export const FIXES = [
  { id: 'nbsp',         label: 'Non-breaking space',    detail: 'U+00A0 → " "',            defaultOn: true },
  { id: 'softHyphen',   label: 'Soft hyphen',           detail: 'U+00AD → "-"',            defaultOn: true },
  { id: 'curlyQuotes',  label: 'Curly quotes',          detail: 'U+2018–201D → \' "', defaultOn: true },
  { id: 'dashes',       label: 'En & em dash',          detail: 'U+2013 U+2014 → "-"',     defaultOn: true },
  { id: 'fieldBreaks',  label: 'Line breaks in fields', detail: 'CR LF → " "',             defaultOn: true },
  { id: 'trim',         label: 'Trim field whitespace', detail: 'leading + trailing',           defaultOn: true },
  { id: 'stripAccents', label: 'Strip accents',         detail: 'é→e  ñ→n', defaultOn: false, lossy: true },
];

/** The fix selection the tool starts with. */
export function defaultFixes() {
  const on = {};
  for (const fix of FIXES) on[fix.id] = fix.defaultOn;
  return on;
}

/** Prefixes a BOM so Excel reads the file as UTF-8 rather than the system codepage. */
export function withBom(text) {
  return '\ufeff' + text;
}

const NON_ASCII = /[^\x00-\x7F]/;
const RE_NBSP = /\u00a0/g;
const RE_SOFT_HYPHEN = /\u00ad/g;
const RE_SINGLE_QUOTES = /[\u2018\u2019]/g;
const RE_DOUBLE_QUOTES = /[\u201c\u201d]/g;
const RE_DASHES = /[\u2013\u2014]/g;
const RE_BREAKS = /\r\n|\r|\n/g;
const RE_EDGE_SPACE = /^[ \t]+|[ \t]+$/g;
const RE_COMBINING = /[\u0300-\u036f]/g;

function countMatches(value, pattern) {
  const found = value.match(pattern);
  return found ? found.length : 0;
}

function foldAccents(value) {
  return value.normalize('NFD').replace(RE_COMBINING, '').normalize('NFC');
}

/**
 * A field only needs quoting if it was quoted to begin with, or if repairing it
 * introduced a character that would otherwise be read as structure.
 */
function serializeField(value, wasQuoted) {
  if (!wasQuoted && !/[",\r\n]/.test(value)) return value;
  return '"' + value.replace(/"/g, '""') + '"';
}

function repairField(value, enabled, counts) {
  let repaired = value;
  const applied = [];

  const bump = (id, hits) => {
    counts[id].found += hits;
    if (!enabled[id]) return false;
    counts[id].applied += hits;
    applied.push(id);
    return true;
  };

  if (NON_ASCII.test(repaired)) {
    let hits = countMatches(repaired, RE_NBSP);
    if (hits && bump('nbsp', hits)) repaired = repaired.replace(RE_NBSP, ' ');

    hits = countMatches(repaired, RE_SOFT_HYPHEN);
    if (hits && bump('softHyphen', hits)) repaired = repaired.replace(RE_SOFT_HYPHEN, '-');

    hits = countMatches(repaired, RE_SINGLE_QUOTES) + countMatches(repaired, RE_DOUBLE_QUOTES);
    if (hits && bump('curlyQuotes', hits)) {
      repaired = repaired.replace(RE_SINGLE_QUOTES, "'").replace(RE_DOUBLE_QUOTES, '"');
    }

    hits = countMatches(repaired, RE_DASHES);
    if (hits && bump('dashes', hits)) repaired = repaired.replace(RE_DASHES, '-');
  }

  const breaks = countMatches(repaired, RE_BREAKS);
  if (breaks && bump('fieldBreaks', breaks)) repaired = repaired.replace(RE_BREAKS, ' ');

  if (NON_ASCII.test(repaired)) {
    const folded = foldAccents(repaired);
    if (folded !== repaired) {
      let hits = 0;
      for (const char of repaired) if (foldAccents(char) !== char) hits++;
      if (bump('stripAccents', hits)) repaired = folded;
    }
  }

  const trimmed = repaired.replace(RE_EDGE_SPACE, '');
  if (trimmed !== repaired && bump('trim', 1)) repaired = trimmed;

  return { repaired, applied };
}

/**
 * Repairs `text` and reports what changed.
 *
 * `options.fixes` overrides individual fixes by id; anything omitted keeps its
 * default. `options.maxChanges` caps how many individual changes are recorded —
 * the counts stay exact regardless, and `changesTruncated` says whether the
 * list was cut short.
 *
 * Returns the repaired CSV (without a BOM, whether or not the input had one),
 * the header names, row and column counts, per-fix `found` and `applied`
 * tallies, and the recorded changes.
 */
export function processCsv(text, options = {}) {
  const enabled = { ...defaultFixes(), ...(options.fixes || {}) };
  const maxChanges = options.maxChanges ?? 10000;

  const hadBom = text.charCodeAt(0) === 0xfeff;
  const source = hadBom ? text.slice(1) : text;

  const counts = {};
  for (const fix of FIXES) counts[fix.id] = { found: 0, applied: 0 };

  const pieces = [];
  const headers = [];
  const changes = [];
  let changesTruncated = false;

  let copiedTo = 0;
  let cursor = 0;
  let row = 1;
  let column = 0;
  let lastRow = 0;
  let rowsChanged = 0;
  let lastChangedRow = 0;

  const length = source.length;
  const separator = /[,\r\n]/g;

  while (cursor < length) {
    const fieldStart = cursor;
    const quoted = source.charCodeAt(cursor) === 34;
    let value;

    if (quoted) {
      cursor++;
      let segmentStart = cursor;
      let buffer = '';
      for (;;) {
        const quote = source.indexOf('"', cursor);
        if (quote === -1) {
          buffer += source.slice(segmentStart);
          cursor = length;
          break;
        }
        if (source.charCodeAt(quote + 1) === 34) {
          buffer += source.slice(segmentStart, quote + 1);
          cursor = quote + 2;
          segmentStart = cursor;
          continue;
        }
        buffer += source.slice(segmentStart, quote);
        cursor = quote + 1;
        break;
      }
      value = buffer;
    } else {
      separator.lastIndex = cursor;
      const next = separator.exec(source);
      const end = next ? next.index : length;
      value = source.slice(cursor, end);
      cursor = end;
    }

    const { repaired, applied } = repairField(value, enabled, counts);
    lastRow = row;

    if (applied.length > 0) {
      pieces.push(source.slice(copiedTo, fieldStart), serializeField(repaired, quoted));
      copiedTo = cursor;

      if (row !== lastChangedRow) {
        rowsChanged++;
        lastChangedRow = row;
      }
      if (changes.length < maxChanges) {
        changes.push({ row, columnIndex: column, column: '', before: value, after: repaired, fixes: applied });
      } else {
        changesTruncated = true;
      }
    }

    if (row === 1) headers.push(repaired);

    if (cursor >= length) break;
    const delimiter = source.charCodeAt(cursor);
    if (delimiter === 44) {
      cursor++;
      column++;
    } else {
      cursor += delimiter === 13 && source.charCodeAt(cursor + 1) === 10 ? 2 : 1;
      row++;
      column = 0;
    }
  }

  pieces.push(source.slice(copiedTo));

  for (const change of changes) {
    change.column = headers[change.columnIndex] ?? `Column ${change.columnIndex + 1}`;
  }

  let totalChanges = 0;
  for (const fix of FIXES) totalChanges += counts[fix.id].applied;

  return {
    output: pieces.join(''),
    hadBom,
    headers,
    rowCount: Math.max(lastRow - 1, 0),
    columnCount: headers.length,
    totalChanges,
    rowsChanged,
    counts,
    changes,
    changesTruncated,
  };
}
