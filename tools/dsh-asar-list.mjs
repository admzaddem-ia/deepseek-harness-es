/**
 * Lista las entradas del `app.asar` de una instalación de DeepSeek Harness.
 *
 * Uso: DSH_APP_ASAR=<ruta al app.asar> node tools/dsh-asar-list.mjs [indice.json]
 *
 * La ruta del `app.asar` sale SIEMPRE de la variable de entorno `DSH_APP_ASAR`, nunca de una ruta
 * fija de una máquina concreta. Si se pasa un archivo de salida, escribe el índice
 * (ruta, tamaño y desplazamiento de cada entrada) que consume `dsh-asar-extract.mjs`.
 *
 * Variables de entorno:
 *   DSH_APP_ASAR  ruta al `app.asar` de la instalación de DSH (obligatoria)
 *
 * Ejemplos:
 *   Windows (instalación por defecto):
 *     $env:DSH_APP_ASAR = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app.asar"
 *     node tools/dsh-asar-list.mjs "$env:TEMP\dsh-asar-index.json"
 *   macOS:
 *     DSH_APP_ASAR=/Applications/DeepSeek\ Harness.app/Contents/Resources/app.asar \
 *       node tools/dsh-asar-list.mjs /tmp/dsh-asar-index.json
 */
import fs from 'node:fs';
import process from 'node:process';

const USO = `Uso: DSH_APP_ASAR=<ruta al app.asar> node tools/dsh-asar-list.mjs [indice.json]

Lista las entradas del app.asar indicado y, si se pasa un archivo, escribe el índice que
consume dsh-asar-extract.mjs.

Argumentos:
  [indice.json]  archivo donde escribir el índice (opcional; sin él solo imprime el total)

Variables de entorno:
  DSH_APP_ASAR   ruta al app.asar de la instalación de DeepSeek Harness (obligatoria)
`;

const asarPath = process.env.DSH_APP_ASAR;
const outFile = process.argv[2];

if (outFile === '-h' || outFile === '--help') {
  console.log(USO);
  process.exit(0);
}

if (!asarPath) {
  console.error(USO);
  process.exit(2);
}

let fd;
try {
  fd = fs.openSync(asarPath, 'r');
} catch (error) {
  console.error(`No pude abrir el app.asar de DSH_APP_ASAR: ${asarPath}`);
  console.error(`(${error.message})`);
  console.error('');
  console.error(USO);
  process.exit(2);
}

// Cabecera del formato asar: 16 bytes de encabezado de pickle y, a continuación, el JSON del
// directorio. El offset de los datos de cada archivo es 8 + longitud del bloque de cabecera.
const sizeBuf = Buffer.alloc(16);
fs.readSync(fd, sizeBuf, 0, 16, 0);
const headerBufLen = sizeBuf.readUInt32LE(4);
const jsonLen = sizeBuf.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonLen);
fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const dataOffset = 8 + headerBufLen;

const entries = [];
function walk(node, prefix) {
  for (const [name, val] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (val.files) walk(val, p);
    else entries.push({ path: p, size: val.size, offset: Number(val.offset) });
  }
}
walk(header, '');

if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ asarPath, dataOffset, entries }, null, 1));
  console.log(`índice escrito en: ${outFile}`);
}
console.log(`entradas=${entries.length} dataOffset=${dataOffset}`);
