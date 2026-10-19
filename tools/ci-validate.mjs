/**
 * Validación de repositorio para CI y para antes de publicar.
 *
 * Uso: node tools/ci-validate.mjs
 *
 * Comprueba, sin necesitar DeepSeek Harness instalado:
 *  1. que todos los JSON del repositorio parseen;
 *  2. que los manifiestos de los paquetes sean coherentes y sus archivos existan;
 *  3. que el id del bundle de cliente coincida con el nombre del paquete y declare el idioma;
 *  4. que el patch de cada bundle inserte una fila con el nombre correcto;
 *  5. que el corpus y la traducción final tengan exactamente las mismas claves;
 *  6. que no se hayan colado rutas personales de una máquina concreta.
 *
 * Sale con código 1 si algo falla, con la lista de problemas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const problems = [];
const notes = [];
const fail = (message) => problems.push(message);
const relative = (file) => path.relative(root, file).split(path.sep).join('/');

const packages = ['locale-es', 'speech-to-text-whisper'];
/** Nombre publicado de cada carpeta de paquete. */
const packageNames = {
  'locale-es': '@local/dsh-locale-es',
  'speech-to-text-whisper': '@local/dsh-speech-to-text-whisper',
};
const skipDirs = new Set(['.git', 'node_modules', '.github']);

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(path.join(dir, entry.name), visit);
    } else {
      visit(path.join(dir, entry.name));
    }
  }
}

// 1. Todo JSON del repositorio debe parsear.
let jsonCount = 0;
walk(root, (file) => {
  if (!file.endsWith('.json')) return;
  jsonCount++;
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`JSON inválido en ${relative(file)}: ${error.message}`);
  }
});
notes.push(`JSON revisados: ${jsonCount}`);

// 2..4. Manifiestos y bundles.
for (const name of packages) {
  const dir = path.join(root, name);
  const manifestPath = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    fail(`falta ${name}/package.json`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== packageNames[name]) fail(`${name}/package.json: name debería ser "${packageNames[name]}", es "${manifest.name}"`);
  if (typeof manifest.version !== 'string' || manifest.version === '') fail(`${name}/package.json: falta version`);
  if (manifest.type !== 'module') fail(`${name}/package.json: type debería ser "module"`);
  if (!manifest.dsh?.bundle?.patch) fail(`${name}/package.json: falta dsh.bundle.patch`);

  const patchFile = path.join(dir, manifest.dsh?.bundle?.patch ?? 'cordis.patch.yml');
  if (!fs.existsSync(patchFile)) {
    fail(`${name}: el patch declarado no existe (${manifest.dsh?.bundle?.patch})`);
  } else {
    const patch = fs.readFileSync(patchFile, 'utf8');
    if (!patch.includes(manifest.name)) fail(`${name}: el patch no menciona "${manifest.name}"`);
  }

  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    if (!target.startsWith('./')) continue;
    if (!fs.existsSync(path.join(dir, target))) fail(`${name}: exports["${key}"] apunta a un archivo inexistente (${target})`);
  }
  for (const file of manifest.files ?? []) {
    if (file.includes('*')) continue;
    if (!fs.existsSync(path.join(dir, file))) fail(`${name}: "files" menciona un archivo inexistente (${file})`);
  }
  for (const localeFile of ['locale/en.json', 'locale/es.json']) {
    const target = path.join(dir, localeFile);
    if (!fs.existsSync(target)) {
      fail(`${name}: falta ${localeFile} (metadata de la tarjeta en Plugins)`);
      continue;
    }
    const meta = JSON.parse(fs.readFileSync(target, 'utf8')).meta;
    if (typeof meta?.title !== 'string' || typeof meta?.description !== 'string') fail(`${name}/${localeFile}: falta meta.title o meta.description`);
  }

  if (manifest.dsh?.client) {
    if (manifest.dsh.client.platform !== 'web') fail(`${name}: dsh.client.platform debería ser "web"`);
    const clientFile = path.join(dir, manifest.exports?.['./client'] ?? './client.js');
    if (!fs.existsSync(clientFile)) {
      fail(`${name}: falta el bundle de cliente`);
    } else {
      const client = fs.readFileSync(clientFile, 'utf8');
      const id = /window\.__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(client)?.[1];
      if (id !== manifest.name) fail(`${name}: el id del bundle ("${id}") no coincide con el nombre del paquete ("${manifest.name}")`);
      if (!/factory\s*\(/.test(client)) fail(`${name}: el bundle no declara factory()`);
      if (name === 'locale-es' && !/addLanguage\(/.test(client)) fail(`${name}: el bundle no registra el idioma con addLanguage()`);
    }
  }
}
notes.push(`paquetes revisados: ${packages.length}`);

// 5. Corpus contra traducción final.
const corpusPath = path.join(root, 'tools/corpus/corpus.json');
const esPath = path.join(root, 'tools/corpus/es.json');
if (!fs.existsSync(corpusPath) || !fs.existsSync(esPath)) {
  fail('faltan tools/corpus/corpus.json o tools/corpus/es.json');
} else {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const es = JSON.parse(fs.readFileSync(esPath, 'utf8'));
  let keys = 0;
  for (const namespace of corpus) {
    const dict = es[namespace.ns];
    if (!dict) {
      fail(`corpus: el namespace "${namespace.ns}" no tiene traducción`);
      continue;
    }
    for (const key of Object.keys(namespace.entries)) {
      keys++;
      const source = namespace.entries[key];
      const translation = dict[key];
      // Un valor en blanco solo es válido cuando el texto inglés también lo está
      // (por ejemplo un separador que es un espacio, o un prefijo vacío).
      if (typeof translation !== 'string' || (translation.trim() === '' && String(source ?? '').trim() !== '')) {
        fail(`corpus: falta traducción de ${namespace.ns}#${key}`);
      }
    }
    for (const key of Object.keys(dict)) {
      if (!Object.hasOwn(namespace.entries, key)) fail(`corpus: traducción sobrante ${namespace.ns}#${key}`);
    }
  }
  notes.push(`namespaces: ${corpus.length} · claves: ${keys}`);
}

// 6. Portabilidad: sin rutas personales ni restos de desarrollo.
const forbidden = [
  [/Users[\\/]X1\b/, 'ruta de usuario personal (Users\\X1)'],
  [/OneDrive/, 'ruta dentro de OneDrive'],
  [/_dsh_(pkgs|clients|corpus|audio)/, 'resto de una extracción temporal'],
  [/AppData[\\/]Local[\\/]Programs[\\/]DeepSeek Harness/, 'ruta absoluta de una instalación'],
];
walk(root, (file) => {
  if (!/\.(mjs|js|json|md|yml|yaml|txt)$/.test(file)) return;
  // Este propio archivo contiene los patrones que busca, así que no se revisa a sí mismo.
  if (relative(file) === 'tools/ci-validate.mjs') return;
  const text = fs.readFileSync(file, 'utf8');
  for (const [pattern, label] of forbidden) {
    if (pattern.test(text)) fail(`${relative(file)}: ${label}`);
  }
});

// 7. Cada herramienta de tools/ debe autodocumentarse con una línea "Uso:".
const toolsDir = path.join(root, 'tools');
let toolsChecked = 0;
for (const entry of fs.readdirSync(toolsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;
  toolsChecked++;
  const head = fs.readFileSync(path.join(toolsDir, entry.name), 'utf8').split('\n').slice(0, 20).join('\n');
  if (!/Uso:/.test(head)) fail(`tools/${entry.name}: el encabezado no tiene una línea "Uso:"`);
}
notes.push(`herramientas revisadas: ${toolsChecked}`);

// Resultado
for (const note of notes) console.log(`· ${note}`);
if (problems.length > 0) {
  console.error(`\nFALLÓ: ${problems.length} problema(s)`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log('\nOK: manifiestos, JSON, corpus y portabilidad verificados');
