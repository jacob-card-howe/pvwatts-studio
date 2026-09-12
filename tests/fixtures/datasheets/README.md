# Datasheet parser fixtures

Each file is the positioned text layer pdf.js hands back for a public
manufacturer module datasheet — the exact input `static/datasheet_parser.js`
sees in the browser. Only `str`, `transform`, `width` and `height` are kept, so
these are text extracts, not redistributed PDFs.

| Fixture | Module | Layout the fixture exercises |
| --- | --- | --- |
| `silfab.json` | Silfab SIL-530 XM Bifacial | Labelled STC / BSTC / NOCT condition columns and a dedicated unit column |
| `rec.json` | REC N-Peak 3 Black (390 / 400 W) | Two power-class columns, subscript labels, and engineering-drawing text interleaved into the table rows |
| `canadian.json` | Canadian Solar CS6.2-66TB | Transposed STC table (models as rows) — the electrical block is expected to stay blank |
| `qcells.json` | Qcells Q.PEAK DUO ML-G12S (650–675 W) | Six power-class columns, Greek-symbol cells between label and value, a second electrical block that is bifacial gain rather than NOCT, and a power tolerance stated inside a block heading |

Regenerate with pdf.js:

```js
const tc = await (await doc.getPage(n)).getTextContent();
tc.items.filter(i => i.str.trim()).map(i => ({ str: i.str, transform: i.transform, width: i.width, height: i.height }));
```
