/**
 * Extrae archivos del `app.asar` de una instalación de DeepSeek Harness usando el índice que
 * generó `dsh-asar-list.mjs`.
 *
 * Uso: DSH_APP_ASAR=<ruta al app.asar> node tools/dsh-asar-extract.mjs <indice.json> <carpeta-salida> <patron>
 *
 * La ruta del `app.asar` sale SIEMPRE de la variable de entorno `DSH_APP_ASAR`: el `asarPath` que
 * quedó guardado en el índice se ignora a propósito, porque pertenece a la máquina que lo generó.
 *
 * Variables de entorno:
 *   DSH_APP_ASAR  ruta al `app.asar` de la instalación de DSH (obligatoria)
 *
 * Ejemplo (paquetes de cliente, que es lo que consume extract-corpus.mjs):
 *   $env:DSH_APP_ASAR = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app.asar"
 *   node tools/dsh-asar-list.mjs "$env:TEMP\dsh-asar-index.json"
 *   node tools/dsh-asar-extract.mjs "$env:TEMP\dsh-asar-index.json" "$env:TEMP\dsh-client" \
 *     "@deepseek-ai/.*\/lib/client\.js$"
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const USO = `Uso: DSH_APP_ASAR=<ruta al app.asar> node tools/dsh-asar-extract.mjs <indice.json> <carpeta-salida> <patron>

Copia al disco las entradas del app.asar cuyo path coincide con el patrón, respetando su ruta
interna dentro de la carpeta de salida.

Argumentos:
  <indice.json>      índice generado por dsh-asar-list.mjs
  <carpeta-salida>   carpeta destino (se crea si no existe)
  <patron>           expresión regular aplicada al path interno de cada entrada

Variables de entorno:
  DSH_APP_ASAR       ruta al app.asar de la instalación de DeepSeek Harness (obligatoria)
`;

const asarPath = process.env.DSH_APP_ASAR;
const indexFile = process.argv[2];
const outRoot = process.argv[3];
const patternText = process.argv[4];

if (indexFile === '-h' || indexFile === '--help') {
  console.log(USO);
  process.exit(0);
}

if (!asarPath || !indexFile || !outRoot || patternText === undefined) {
  console.error(USO);
  process.exit(2);
}

let pattern;
try {
  pattern = new RegExp(patternText);
} catch (error) {
  console.error(`El patrón no es una expresión regular válida: ${patternText}`);
  console.error(`(${error.message})`);
  process.exit(2);
}

let index;
try {
  index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
} catch (error) {
  console.error(`No pude leer el índice: ${indexFile}`);
  console.error(`(${error.message})`);
  console.error('Generá el índice primero con dsh-asar-list.mjs.');
  process.exit(2);
}

let fd;
try {
  fd = fs.openSync(asarPath, 'r');
} catch (error) {
  console.error(`No pude abrir el app.asar de DSH_APP_ASAR: ${asarPath}`);
  console.error(`(${error.message})`);
  process.exit(2);
}

const { dataOffset, entries } = index;
let n = 0;
for (const e of entries) {
  if (!pattern.test(e.path)) continue;
  const dest = path.join(outRoot, e.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = Buffer.alloc(e.size);
  fs.readSync(fd, buf, 0, e.size, dataOffset + e.offset);
  fs.writeFileSync(dest, buf);
  n++;
}
console.log(`extraidos=${n} -> ${outRoot}`);
