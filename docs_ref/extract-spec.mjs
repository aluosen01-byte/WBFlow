// Extracts the embedded OpenAPI spec JSON from a downloaded dev.wildberries.cn docs page
// Usage: node extract-spec.mjs <input.html> <output.json>
import fs from 'node:fs';

const [, , htmlFile, outFile] = process.argv;
const html = fs.readFileSync(htmlFile, 'utf8');

const marker = 'const __redoc_state = ';
const start = html.indexOf(marker);
if (start < 0) throw new Error('marker not found');
const s = start + marker.length;

// The redoc state JS object ends with "};\n\n      var container = document.getElementById('redoc')"
// Inside the JS string, newlines appear as literal backslash-n.
const endMarker = '\\n\\n      var container';
const e = html.indexOf(endMarker, s);
if (e < 0) throw new Error('end marker not found');

const escaped = html.slice(s, e);
// Unescape the JS string literal by parsing it as a JSON string
let code;
try {
  code = JSON.parse('"' + escaped + '"');
} catch (err) {
  throw new Error('Failed to unescape JS string: ' + err.message);
}

const braceStart = code.indexOf('{');
let depth = 0;
let inStr = false;
let i = braceStart;
for (; i < code.length; i++) {
  const ch = code[i];
  if (inStr) {
    if (ch === '\\') i++;          // skip escaped char
    else if (ch === '"') inStr = false;
    continue;
  }
  if (ch === '"') inStr = true;
  else if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) break; }
}
const json = code.slice(braceStart, i + 1);
const state = JSON.parse(json);
const spec = state.spec && state.spec.data ? state.spec.data : state;

console.log('Parsed OK. info.title =', spec.info && spec.info.title, '| openapi =', spec.openapi);
console.log('Paths:', Object.keys(spec.paths || {}).length);
fs.writeFileSync(outFile, JSON.stringify(spec, null, 2), 'utf8');
console.log('Spec saved to', outFile, `(${json.length} chars)`);
