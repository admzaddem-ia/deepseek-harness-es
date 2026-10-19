/**
 * Prueba de integración de la mitad Host del proveedor de voz `@local/dsh-speech-to-text-whisper`
 * fuera de DSH, con un contexto Cordis simulado. Ejercita el contrato real de punta a punta:
 * validación de configuración, inspección de la caché, descarga del VAD Silero, arranque del
 * worker y una transcripción en español.
 *
 * Uso: node tools/test-whisper-provider.mjs <audio.wav> [idioma] [texto esperado]
 *
 * El script se ejecuta con el binario de Electron en modo Node (`ELECTRON_RUN_AS_NODE=1`), porque
 * así resuelve `sherpa-onnx-node` dentro del app.asar igual que la mitad Host instalada. Si no se
 * está ejecutando ya dentro de Electron, se relanza solo: usa `DSH_ELECTRON`, `DSH_INSTALL`, la
 * carpeta deducida de `DSH_APP_ASAR` o, como último recurso, las ubicaciones de instalación
 * habituales del sistema. Si aun así no lo encuentra, explica cómo pasar el comando a mano.
 *
 * Variables de entorno:
 *   DSH_SPEECH_DATA_ROOT  carpeta de datos del proveedor
 *                         (por defecto: ~/.dsh/speech-to-text/whisper)
 *   DSH_ELECTRON          ruta al ejecutable de Electron, por ejemplo la de "DeepSeek Harness.exe"
 *   DSH_INSTALL           carpeta de instalación de DSH; se busca ahí el ejecutable de Electron
 *   DSH_APP_ASAR          ruta al app.asar; permite deducir la carpeta de instalación
 *   DSH_WHISPER_PROVIDER  ruta a speech-to-text-whisper/index.js (si no está en el repositorio)
 *   WHISPER_MODEL         variante del modelo (por defecto "base"; también "small")
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

const USO = `Uso: node tools/test-whisper-provider.mjs <audio.wav> [idioma] [texto esperado]

Prueba el proveedor de voz con un contexto simulado, transcribe el WAV y compara las palabras
clave del texto esperado. Termina con RESULT: PASS o RESULT: FAIL.

Argumentos:
  <audio.wav>       audio PCM 16 bits, mono y 16 kHz (obligatorio)
  [idioma]          pista de idioma para Whisper (por defecto "es"; "auto" lo detecta solo)
  [texto esperado]  frase hablada, para medir la coincidencia de palabras clave

Variables de entorno:
  DSH_SPEECH_DATA_ROOT  datos del proveedor (por defecto ~/.dsh/speech-to-text/whisper)
  DSH_ELECTRON          ruta al ejecutable de Electron de DSH
  DSH_INSTALL           carpeta de instalación de DSH (se busca ahí el .exe de Electron)
  DSH_APP_ASAR          ruta al app.asar (permite deducir DSH_INSTALL)
  WHISPER_MODEL         variante del modelo (por defecto "base"; también "small")

Como el script corre con Electron en modo Node, el comando manual es:
  PowerShell: $env:ELECTRON_RUN_AS_NODE = '1'
              & "<ruta a DeepSeek Harness.exe>" --expose-internals tools\\test-whisper-provider.mjs <audio.wav> es "texto"
  sh:         ELECTRON_RUN_AS_NODE=1 "<ruta a Electron>" --expose-internals tools/test-whisper-provider.mjs <audio.wav> es "texto"
`;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(USO);
  process.exit(2);
}
if (args[0] === '-h' || args[0] === '--help') {
  console.log(USO);
  process.exit(0);
}

const wavPath = args[0];
const language = args[1] ?? 'es';
const expected = args[2] ?? '';

if (!fs.existsSync(wavPath)) {
  console.error(`No existe el audio: ${wavPath}\n`);
  console.error(USO);
  process.exit(2);
}

/** Carpeta de datos del proveedor; equivale a `dshHomePath('speech-to-text', 'whisper')` de DSH. */
const dataRoot = process.env.DSH_SPEECH_DATA_ROOT ?? path.join(os.homedir(), '.dsh', 'speech-to-text', 'whisper');

/** Mitad Host del proveedor: primero la del repositorio y después las variantes de espacio de trabajo. */
const candidatosProveedor = [
  process.env.DSH_WHISPER_PROVIDER,
  new URL('../speech-to-text-whisper/index.js', import.meta.url),
  new URL('../../speech-to-text-whisper/index.js', import.meta.url),
  new URL('../../dsh-speech-to-text-whisper/index.js', import.meta.url),
].filter(Boolean);

function resolverProveedor() {
  for (const candidato of candidatosProveedor) {
    const ruta = typeof candidato === 'string' ? candidato : fileURLToPath(candidato);
    if (fs.existsSync(ruta)) return ruta;
  }
  return null;
}

/**
 * Primer ejecutable de Electron dentro de una carpeta de instalación. Cubre Windows (`.exe`),
 * macOS (`…/DeepSeek Harness.app/Contents/MacOS/<binario>`) y Linux (binario sin extensión).
 */
function ejecutableEn(carpeta) {
  try {
    const entradas = fs.readdirSync(carpeta, { withFileTypes: true });
    const exe = entradas.find((e) => e.isFile() && /\.exe$/i.test(e.name) && !/^uninstall/i.test(e.name));
    if (exe) return path.join(carpeta, exe.name);
    const app = entradas.find((e) => e.isDirectory() && /\.app$/i.test(e.name));
    if (app) {
      const macos = path.join(carpeta, app.name, 'Contents', 'MacOS');
      const binario = fs.existsSync(macos) ? fs.readdirSync(macos).find((n) => !n.startsWith('.')) : undefined;
      if (binario) return path.join(macos, binario);
    }
    const bin = entradas.find((e) => e.isFile() && path.extname(e.name) === '' && (fs.statSync(path.join(carpeta, e.name)).mode & 0o111) !== 0);
    return bin ? path.join(carpeta, bin.name) : null;
  } catch {
    return null;
  }
}

/**
 * Ejecutable de Electron de la instalación de DSH: `DSH_ELECTRON`, la carpeta de `DSH_INSTALL`, la
 * deducida de `DSH_APP_ASAR` y, si nada de eso está definido, las ubicaciones habituales del sistema.
 */
function resolverElectron() {
  if (process.env.DSH_ELECTRON) return process.env.DSH_ELECTRON;
  const candidatas = [];
  if (process.env.DSH_INSTALL) candidatas.push(process.env.DSH_INSTALL);
  if (process.env.DSH_APP_ASAR) candidatas.push(path.dirname(path.dirname(process.env.DSH_APP_ASAR)));
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) candidatas.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'));
    if (process.env.ProgramFiles) candidatas.push(path.join(process.env.ProgramFiles, 'DeepSeek Harness'));
    if (process.env['ProgramFiles(x86)']) candidatas.push(path.join(process.env['ProgramFiles(x86)'], 'DeepSeek Harness'));
  } else if (process.platform === 'darwin') {
    candidatas.push('/Applications/DeepSeek Harness.app', path.join(os.homedir(), 'Applications', 'DeepSeek Harness.app'));
  } else {
    candidatas.push('/opt/DeepSeek Harness', path.join(os.homedir(), '.local', 'share', 'DeepSeek Harness'));
  }
  for (const carpeta of candidatas) {
    const ejecutable = ejecutableEn(carpeta);
    if (ejecutable) return ejecutable;
  }
  return null;
}

// Fuera de Electron no se resuelve el runtime nativo del app.asar, así que nos relanzamos con el
// binario de Electron en modo Node (lo mismo que hace el proveedor con su worker).
if (!process.versions.electron && process.env.DSH_WHISPER_RELAUNCH !== '1') {
  const electron = resolverElectron();
  if (!electron) {
    console.error('No pude determinar el binario de Electron.');
    console.error('Definí DSH_ELECTRON (ruta al .exe) o DSH_INSTALL (carpeta de instalación de DSH),');
    console.error('o ejecutá la prueba a mano, con el binario de Electron en modo Node:');
    console.error('');
    console.error(`  PowerShell: $env:ELECTRON_RUN_AS_NODE = '1'; & "<ruta a DeepSeek Harness.exe>" --expose-internals ${scriptPath} ${args.join(' ')}`);
    console.error(`  sh:         ELECTRON_RUN_AS_NODE=1 "<ruta a Electron>" --expose-internals ${scriptPath} ${args.join(' ')}`);
    console.error('');
    console.error(USO);
    process.exit(2);
  }
  console.log('relanzando con Electron en modo Node:', electron);
  const hijo = spawnSync(electron, ['--expose-internals', scriptPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_WHISPER_RELAUNCH: '1' },
  });
  if (hijo.error) {
    console.error(`No pude ejecutar el binario de Electron (${electron}): ${hijo.error.message}`);
    process.exit(2);
  }
  process.exit(hijo.status ?? 1);
}

const proveedorFile = resolverProveedor();
if (!proveedorFile) {
  console.error('No encontré la mitad Host del proveedor (speech-to-text-whisper/index.js).');
  console.error('Definí DSH_WHISPER_PROVIDER con la ruta a ese archivo.');
  process.exit(2);
}
const { apply } = await import(pathToFileURL(proveedorFile).href);

const providers = [];
const effects = [];
const ctx = {
  logger: { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.log('[warn]', ...a) },
  effect(fn) { const dispose = fn(); effects.push(dispose); return dispose; },
  speechToText: {
    register(provider) {
      providers.push(provider);
      return () => {};
    },
  },
};

console.log('execPath:', process.execPath);
console.log('resourcesPath:', process.resourcesPath);
console.log('provider file:', proveedorFile);
console.log('dataRoot:', dataRoot);
console.log('audio:', wavPath, '| idioma:', language);

apply(ctx, {
  dataRoot,
  model: process.env.WHISPER_MODEL ?? 'base',
  precision: 'int8',
});

if (providers.length !== 1) throw new Error(`se esperaba un solo proveedor registrado, hubo ${providers.length}`);
const provider = providers[0];
console.log('provider id:', provider.info.id);
console.log('provider name:', provider.info.name);
console.log('languages:', provider.info.languages.join(','));
console.log('downloadSources:', (provider.info.downloadSources ?? []).join(','));
console.log('setupEstimate:', JSON.stringify(provider.info.setupEstimate));

let lastPhase;
provider.preparation.subscribe(() => {
  const snapshot = provider.preparation.snapshot();
  if (snapshot.phase !== lastPhase || snapshot.phase === 'downloading') {
    lastPhase = snapshot.phase;
    console.log('preparation:', JSON.stringify({ phase: snapshot.phase, step: snapshot.step, resource: snapshot.resource, completedBytes: snapshot.completedBytes, totalBytes: snapshot.totalBytes, message: snapshot.message }));
  }
});

const waitFor = async (phases, timeoutMs) => {
  const started = Date.now();
  for (;;) {
    const { phase } = provider.preparation.snapshot();
    if (phases.includes(phase)) return phase;
    if (Date.now() - started > timeoutMs) throw new Error(`se agotó el tiempo esperando ${phases.join('/')}; última fase: ${phase}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

await waitFor(['unprepared', 'standby'], 30000);
console.log('inspection result:', provider.preparation.snapshot().phase);

provider.preparation.prepare({});
const prepared = await waitFor(['ready', 'failed'], 600000);
console.log('prepare result:', prepared);
if (prepared === 'failed') throw new Error(provider.preparation.snapshot().message);

const audio = fs.readFileSync(wavPath);
const result = await provider.transcribe({ audio, language }, AbortSignal.timeout(300000));
console.log('transcript:', JSON.stringify(result.text));
console.log('audioSeconds:', result.audioSeconds.toFixed(2));
console.log('inferenceSeconds:', result.inferenceSeconds.toFixed(2));

const normalized = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
if (expected !== '') {
  const got = normalized(result.text);
  const want = normalized(expected);
  const words = want.split(' ').filter((w) => w.length > 3);
  const hit = words.filter((w) => got.includes(w)).length;
  console.log(`expected-word match: ${hit}/${words.length}`);
  if (hit / words.length < 0.5) {
    console.log('RESULT: FAIL (la transcripción no coincide con el texto en español)');
    process.exit(1);
  }
}
console.log('RESULT: PASS');
process.exit(0);
