/**
 * Descarga archivos por HTTP y los fija con su SHA-256.
 *
 * Uso: node tools/download-model.mjs --out <carpeta> <nombre>=<url> [<nombre>=<url> ...]
 *
 * Pensado para bajar y fijar los pesos de un modelo (por ejemplo los de Whisper) sin escribirlos
 * a mano: guarda cada archivo en la carpeta destino, omite los que ya existen y escribe
 * `downloaded.json` con nombre, URL, tamaño y SHA-256 de cada uno.
 *
 * No necesita DeepSeek Harness instalado.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const USO = `Uso: node tools/download-model.mjs --out <carpeta> <nombre>=<url> [<nombre>=<url> ...]

Argumentos:
  --out <carpeta>            carpeta destino de los archivos (obligatoria)
  <nombre>=<url>             pares archivo=URL, uno por cada archivo a descargar

Ejemplo:
  node tools/download-model.mjs --out ./modelos \\
    base-encoder.int8.onnx=https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/base-encoder.int8.onnx
`;

const argv = process.argv.slice(2);
let outDir;
const files = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '-h' || arg === '--help') {
    console.log(USO);
    process.exit(0);
  } else if (arg === '--out') {
    outDir = argv[++i];
    if (outDir === undefined) {
      console.error('Falta el valor de --out.\n');
      console.error(USO);
      process.exit(2);
    }
  } else if (arg.startsWith('--')) {
    console.error(`Opción desconocida: ${arg}\n`);
    console.error(USO);
    process.exit(2);
  } else {
    const sep = arg.indexOf('=');
    const name = sep < 0 ? '' : arg.slice(0, sep);
    const url = sep < 0 ? '' : arg.slice(sep + 1);
    if (name === '' || url === '') {
      console.error(`Se esperaba <nombre>=<url> y recibí: ${arg}\n`);
      console.error(USO);
      process.exit(2);
    }
    files.push({ name, url });
  }
}

if (!outDir || files.length === 0) {
  console.error(USO);
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const f of files) {
  const dest = path.join(outDir, f.name);
  const hash = createHash('sha256');
  let bytes = 0;
  if (fs.existsSync(dest)) {
    console.log(`ya existe, se omite: ${f.name}`);
  } else {
    const res = await fetch(f.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} al pedir ${f.url}`);
    const tmp = `${dest}.part`;
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      },
      fs.createWriteStream(tmp),
    );
    fs.renameSync(tmp, dest);
    console.log(`descargado ${f.name}: ${bytes} bytes sha256=${hash.digest('hex')}`);
  }
  const stat = fs.statSync(dest);
  const digest = createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  manifest.push({ name: f.name, url: f.url, bytes: stat.size, sha256: digest });
}
fs.writeFileSync(path.join(outDir, 'downloaded.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest, null, 1));
