/**
 * Reparte el corpus de textos ingleses en lotes de traducción equilibrados.
 *
 * Uso: node tools/make-batches.mjs --corpus <corpus.json> --out <carpeta> [--cap <claves>]
 *
 * Cada lote se dimensiona hasta `--cap` claves y agrupa namespaces completos, para poder traducir
 * en paralelo y después unir todo con `build-locale-pack.mjs`. Escribe `batch-NN.in.json` y un
 * `manifest.json` con rutas RELATIVAS a la carpeta de lotes, para que el repositorio se pueda
 * copiar a otra máquina (lo consumen `validate-batches.mjs` y `build-locale-pack.mjs`).
 *
 * No necesita DeepSeek Harness instalado.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const USO = `Uso: node tools/make-batches.mjs --corpus <corpus.json> --out <carpeta> [--cap <claves>]

Argumentos:
  --corpus <archivo>  corpus de entrada, como el que genera extract-corpus.mjs (obligatorio)
  --out <carpeta>     carpeta destino de los lotes y del manifiesto (obligatorio)
  --cap <claves>      máximo de claves por lote (por defecto 260)
`;

const argv = process.argv.slice(2);
let corpusFile;
let outDir;
let cap = 260;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '-h' || arg === '--help') {
    console.log(USO);
    process.exit(0);
  } else if (arg === '--corpus' || arg === '--out' || arg === '--cap') {
    const value = argv[++i];
    if (value === undefined) {
      console.error(`Falta el valor de ${arg}.\n`);
      console.error(USO);
      process.exit(2);
    }
    if (arg === '--corpus') corpusFile = value;
    else if (arg === '--out') outDir = value;
    else cap = Number(value);
  } else {
    console.error(`Opción desconocida: ${arg}\n`);
    console.error(USO);
    process.exit(2);
  }
}

if (!corpusFile || !outDir) {
  console.error(USO);
  process.exit(2);
}
if (!Number.isInteger(cap) || cap < 1) {
  console.error(`--cap debe ser un entero positivo (recibí: ${cap}).\n`);
  console.error(USO);
  process.exit(2);
}
if (!fs.existsSync(corpusFile)) {
  console.error(`No existe el corpus: ${corpusFile}`);
  process.exit(2);
}

const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
const sorted = [...corpus].sort((a, b) => b.count - a.count);

const batches = [];
for (const ns of sorted) {
  const items = Object.entries(ns.entries).map(([key, en]) => ({ ns: ns.ns, key, en }));
  let target = batches.find((b) => b.keys + items.length <= cap);
  if (!target) {
    target = { id: String(batches.length + 1).padStart(2, '0'), keys: 0, items: [] };
    batches.push(target);
  }
  target.keys += items.length;
  target.items.push(...items);
}

fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const b of batches) {
  const inFile = `batch-${b.id}.in.json`;
  const outFile = `batch-${b.id}.out.json`;
  fs.writeFileSync(path.join(outDir, inFile), JSON.stringify(b.items, null, 1));
  const namespaces = [...new Set(b.items.map((i) => i.ns))];
  manifest.push({ id: b.id, keys: b.keys, namespaces, inFile, outFile });
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
for (const m of manifest) console.log(`batch-${m.id}: ${String(m.keys).padStart(4)} claves, ${m.namespaces.length} ns -> ${m.namespaces.join(', ')}`);
console.log('lotes:', manifest.length, '| claves totales:', manifest.reduce((a, b) => a + b.keys, 0));
console.log(`manifiesto: ${path.join(outDir, 'manifest.json')}`);
