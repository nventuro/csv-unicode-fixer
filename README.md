# csv-unicode-fixer

Repairs the characters that survive a round trip through Word, a web page or a
PDF and then break whatever reads your CSV next — non-breaking spaces, soft
hyphens, curly quotes, en dashes, and line breaks trapped inside quoted fields.

Everything happens in the browser. The file is never uploaded.

## Fixes

| Fix | Default | Does |
| --- | --- | --- |
| Non-breaking space | on | `U+00A0` becomes a plain space |
| Soft hyphen | on | `U+00AD` becomes a real `-` |
| Curly quotes | on | `U+2018`–`U+201D` become `'` and `"` |
| En & em dash | on | `U+2013` `U+2014` become `-` |
| Line breaks in fields | on | `CR`/`LF` inside a quoted field become a space |
| Trim field whitespace | on | leading and trailing spaces and tabs |
| Strip accents | **off** | `é`→`e`, `ñ`→`n` — lossy, for a strictly ASCII consumer |

Accented letters are real data, so they are kept unless you ask for them to go.

Output is UTF-8, with a BOM by default so Excel on Windows reads it as UTF-8
rather than the system codepage.

## How it works

`processCsv` walks the text once, tracking whether it is inside a quoted field.
Non-structural characters are substituted anywhere; `CR`/`LF` only inside a
quoted field, where they are content rather than a row break. A field that no
fix touches is copied through byte for byte, so the output differs from the
input only where a fix actually applied — quoting style, line endings and column
order all survive untouched.

A field is re-quoted only when repairing it would otherwise change how the file
parses, which is what keeps a straightened `"` from splitting a record.

## Running it

The page loads `csv-fixer.js` as an ES module, so it needs to be served over
HTTP rather than opened from disk:

```
python3 -m http.server
```

then open <http://localhost:8000>.

## Tests

```
npm test
```

No dependencies — `node --test` against `csv-fixer.js` directly.

## Deploying

Pushing to `main` runs the tests, then publishes `index.html` and `csv-fixer.js`
via `.github/workflows/pages.yml`. There is no build step.
