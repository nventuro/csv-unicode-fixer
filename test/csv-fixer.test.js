import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXES, defaultFixes, withBom, processCsv } from '../csv-fixer.js';

// Fixtures spell the characters under test as escapes: this file is about
// characters that are invisible or easily mangled in transit, and a literal one
// would make a test pass for the wrong reason.
const NBSP = '\u00a0';
const SHY = '\u00ad';

const only = (...ids) => {
  const fixes = {};
  for (const fix of FIXES) fixes[fix.id] = ids.includes(fix.id);
  return fixes;
};

test('replaces a non-breaking space with a plain space', () => {
  const result = processCsv(`h\nfoo${NBSP}bar`, { fixes: only('nbsp') });
  assert.equal(result.output, 'h\nfoo bar');
  assert.equal(result.counts.nbsp.applied, 1);
});

test('replaces a soft hyphen with a real hyphen rather than dropping it', () => {
  const result = processCsv(`h\nfoo${SHY}bar`, { fixes: only('softHyphen') });
  assert.equal(result.output, 'h\nfoo-bar');
});

test('straightens both kinds of curly quote', () => {
  const result = processCsv('h\n\u2018a\u2019 \u201cb\u201d', { fixes: only('curlyQuotes') });
  assert.equal(result.counts.curlyQuotes.applied, 4);
  // The straightened double quotes leave a quote in the field, so it needs quoting of its own.
  assert.equal(result.output, 'h\n"\'a\' ""b"""');
  assert.equal(processCsv(result.output, { fixes: only() }).headers[0], 'h');
});

test('replaces en and em dashes with hyphens', () => {
  const result = processCsv('h\na \u2013 b \u2014 c', { fixes: only('dashes') });
  assert.equal(result.output, 'h\na - b - c');
});

test('replaces a line break inside a quoted field with a space', () => {
  const result = processCsv('h1,h2\r\n"a\r\nb",c\r\n', { fixes: only('fieldBreaks') });
  assert.equal(result.output, 'h1,h2\r\n"a b",c\r\n');
  assert.equal(result.counts.fieldBreaks.applied, 1);
});

test('treats a bare CR inside a quoted field as content, not a row break', () => {
  const result = processCsv('h\r\n"a\rb"\r\n', { fixes: only('fieldBreaks') });
  assert.equal(result.output, 'h\r\n"a b"\r\n');
  assert.equal(result.rowCount, 1);
});

test('trims leading and trailing whitespace from fields', () => {
  const result = processCsv('h1,h2\n  a  ,"  b  "', { fixes: only('trim') });
  assert.equal(result.output, 'h1,h2\na,"b"');
  assert.equal(result.counts.trim.applied, 2);
});

test('leaves a non-breaking space alone when trimming without the nbsp fix', () => {
  const source = `h\n${NBSP}a${NBSP}`;
  const result = processCsv(source, { fixes: only('trim') });
  assert.equal(result.output, source);
  assert.equal(result.counts.trim.applied, 0);
});

test('keeps accented letters by default and folds them only on request', () => {
  assert.equal(defaultFixes().stripAccents, false);
  const kept = processCsv('h\n\u00e0\u00e9');
  assert.equal(kept.output, 'h\n\u00e0\u00e9');
  assert.equal(kept.counts.stripAccents.found, 2);
  assert.equal(kept.counts.stripAccents.applied, 0);

  const folded = processCsv('h\n\u00e0\u00e9', { fixes: only('stripAccents') });
  assert.equal(folded.output, 'h\nae');
  assert.equal(folded.counts.stripAccents.applied, 2);
});

test('copies untouched fields through unchanged, including needless quoting', () => {
  const source = 'h1,h2,h3\r\n"a",b,"already ""quoted"""\r\n"keep\r\nthis",c,d\r\n';
  const result = processCsv(source, { fixes: only('nbsp') });
  assert.equal(result.output, source);
  assert.equal(result.totalChanges, 0);
});

test('escapes a straightened double quote inside a quoted field', () => {
  const result = processCsv('h\n"see \u201ca\u201d here"', { fixes: only('curlyQuotes') });
  assert.equal(result.output, 'h\n"see ""a"" here"');
  assert.equal(processCsv(result.output, { fixes: only() }).headers[0], 'h');
});

test('quotes a bare field that a straightened quote would otherwise break', () => {
  const result = processCsv('h1,h2,h3\na,\u201cb\u201d,c', { fixes: only('curlyQuotes') });
  assert.equal(result.output, 'h1,h2,h3\na,"""b""",c');
  const reread = processCsv(result.output, { fixes: only() });
  assert.equal(reread.changes.length, 0);
});

test('preserves the surrounding line endings, mixed or missing', () => {
  const crlf = processCsv(`h\r\na${NBSP}b\r\n`, { fixes: only('nbsp') });
  assert.equal(crlf.output, 'h\r\na b\r\n');

  const lf = processCsv(`h\na${NBSP}b`, { fixes: only('nbsp') });
  assert.equal(lf.output, 'h\na b');
});

test('strips an input BOM and reports it, and adds one on request', () => {
  const result = processCsv('\ufeffh1,h2\r\na,b\r\n');
  assert.equal(result.hadBom, true);
  assert.equal(result.headers[0], 'h1');
  assert.equal(result.output.charCodeAt(0), 'h'.charCodeAt(0));
  assert.equal(withBom(result.output).charCodeAt(0), 0xfeff);
});

test('attributes each change to a row number and a column name', () => {
  const result = processCsv(`ID,LABEL\r\n1,foo${NBSP}bar\r\n2,ok\r\n`, { fixes: only('nbsp') });
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.changes[0], {
    row: 2,
    columnIndex: 1,
    column: 'LABEL',
    before: `foo${NBSP}bar`,
    after: 'foo bar',
    fixes: ['nbsp'],
  });
});

test('records several fixes firing on one field', () => {
  const result = processCsv(`h\n${NBSP}foo${SHY}bar baz${NBSP}`);
  assert.deepEqual(result.changes[0].fixes, ['nbsp', 'softHyphen', 'trim']);
  assert.equal(result.changes[0].after, 'foo-bar baz');
});

test('counts what it found even when the fix is switched off', () => {
  const source = `h\na${NBSP}b`;
  const result = processCsv(source, { fixes: only('trim') });
  assert.equal(result.counts.nbsp.found, 1);
  assert.equal(result.counts.nbsp.applied, 0);
  assert.equal(result.output, source);
});

test('counts each changed row once however many fields it touches', () => {
  const result = processCsv(`h1,h2\r\na${NBSP},b${NBSP}\r\nc,d\r\n`, { fixes: only('nbsp') });
  assert.equal(result.rowsChanged, 1);
  assert.equal(result.totalChanges, 2);
});

test('caps the recorded changes without losing the counts', () => {
  const rows = Array.from({ length: 20 }, (_, i) => `${i},a${NBSP}b`).join('\r\n');
  const result = processCsv(`h1,h2\r\n${rows}`, { fixes: only('nbsp'), maxChanges: 5 });
  assert.equal(result.changes.length, 5);
  assert.equal(result.changesTruncated, true);
  assert.equal(result.counts.nbsp.applied, 20);
});

test('reports the shape of the file', () => {
  const result = processCsv('h1,h2,h3\r\na,b,c\r\nd,e,f\r\n');
  assert.equal(result.rowCount, 2);
  assert.equal(result.columnCount, 3);
  assert.deepEqual(result.headers, ['h1', 'h2', 'h3']);
});

test('handles an empty input', () => {
  const result = processCsv('');
  assert.equal(result.output, '');
  assert.equal(result.rowCount, 0);
  assert.equal(result.totalChanges, 0);
});
