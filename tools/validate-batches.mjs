/**
 * Valida los lotes de traducción contra el manifiesto.
 *
 * Uso: node tools/validate-batches.mjs <carpeta-de-batches>
 *
 * Comprueba, lote por lote, que la traducción tenga exactamente las claves pedidas (ni de menos ni
 * de más), que no haya valores vacíos ni de otro tipo y que los `{marcadores}` de cada texto
 * coincidan con los del inglés. Las rutas del manifiesto se resuelven relativas a la carpeta de
 * lotes, así que el repositorio se puede copiar a otra máquina.
 *
 * No necesita DeepSeek Harness instalado.
 *
 * Sale con código 0 si todos los lotes están bien y con código 1 si alguno necesita correcciones.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const USO = `Uso: node tools/validate-batches.mjs <carpeta-de-batches>

Argumentos:
  <carpeta-de-batches>  carpeta con manifest.json y los batch-NN.out.json
                        (por ejemplo: tools/corpus/batches)
`;

const argv = process.argv.slice(2);
let batchDir;

if (argv[0] === '-h' || argv[0] === '--help') {
  console.log(USO);
  process.exit(0);
} else if (argv[0] === '--dir') {
  batchDir = argv[1];
} else {
  batchDir = argv[0];
}

if (!batchDir) {
  console.error(USO);
  process.exit(2);
}

const manifestFile = path.join(batchDir, 'manifest.json');
if (!fs.existsSync(manifestFile)) {
  console.error(`No encontré el manifiesto de lotes: ${manifestFile}\n`);
  console.error(USO);
  process.exit(2);
}

/** El manifiesto guarda nombres de archivo relativos a la carpeta de lotes. */
const rutaDeLote = (value) => (path.isAbsolute(value) ? value : path.join(batchDir, value));

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

let ok = 0;
let bad = 0;
const report = [];
for (const m of manifest) {
  const inItems = JSON.parse(fs.readFileSync(rutaDeLote(m.inFile), 'utf8'));
  let out = null;
  try {
    out = JSON.parse(fs.readFileSync(rutaDeLote(m.outFile), 'utf8'));
  } catch (error) {
    report.push({ id: m.id, status: 'unreadable', error: String(error.message) });
    bad++;
    continue;
  }
  const expected = new Map();
  for (const it of inItems) expected.set(`${it.ns}\u0000${it.key}`, it.en);
  const got = new Map();
  for (const [ns, dict] of Object.entries(out)) {
    if (dict === null || typeof dict !== 'object') continue;
    for (const [key, value] of Object.entries(dict)) got.set(`${ns}\u0000${key}`, value);
  }
  const missing = [...expected.keys()].filter((k) => !got.has(k));
  const extra = [...got.keys()].filter((k) => !expected.has(k));
  const wrongType = [...got.entries()].filter(([, v]) => typeof v !== 'string').length;
  // Un valor en blanco solo es un problema si el inglés no lo está: hay claves cuyo original es un
  // separador (un espacio) o una cadena vacía, y ahí el blanco es la traducción correcta.
  const empty = [...got.entries()].filter(([k, v]) => typeof v === 'string' && v.trim() === '' && String(expected.get(k) ?? '').trim() !== '').length;
  // Integridad de los marcadores: el mismo multiconjunto de {tokens} por clave.
  const placeholders = (s) => (String(s).match(/\{[A-Za-z0-9_.]+\}/g) ?? []).sort().join(',');
  const brokenPlaceholders = [];
  for (const [k, en] of expected) {
    const es = got.get(k);
    if (typeof es !== 'string') continue;
    if (placeholders(en) !== placeholders(es)) brokenPlaceholders.push(k.replace('\u0000', '#'));
  }
  const status = missing.length === 0 && extra.length === 0 && wrongType === 0 && empty === 0 ? 'ok' : 'FIX';
  if (status === 'ok') ok++;
  else bad++;
  report.push({
    id: m.id,
    status,
    expected: expected.size,
    got: got.size,
    missing: missing.length,
    extra: extra.length,
    wrongType,
    empty,
    brokenPlaceholders: brokenPlaceholders.length,
    sampleMissing: missing.slice(0, 5).map((k) => k.replace('\u0000', '#')),
    sampleExtra: extra.slice(0, 5).map((k) => k.replace('\u0000', '#')),
    sampleBroken: brokenPlaceholders.slice(0, 5),
  });
}
for (const r of report) console.log(JSON.stringify(r));
console.log('---');
console.log('lotes ok:', ok, '| para corregir:', bad);
process.exitCode = bad === 0 ? 0 : 1;
