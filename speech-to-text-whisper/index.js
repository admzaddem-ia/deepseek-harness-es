/**
 * `@local/dsh-speech-to-text-whisper` — a local, multilingual speech recognizer.
 *
 * Registers a `speechToText` provider backed by OpenAI Whisper converted to ONNX and executed by
 * the `sherpa-onnx-node` runtime already shipped with DeepSeek Harness. Unlike the bundled
 * SenseVoice recognizer (zh/en/yue/ja/ko only), Whisper accepts Spanish and most other languages,
 * which is what the `es` hint needs.
 *
 * The Host half owns model preparation (download, hash verification, worker lifecycle) and speaks
 * to the worker over an authenticated loopback HTTP socket. It uses only Node built-ins so it
 * resolves from the profile without depending on the installation's package graph.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const name = 'speech-to-text-whisper';
export const inject = ['speechToText'];

/** Private worker entry; the Host owns termination and stdout carries only readiness. */
const WORKER_PATH = fileURLToPath(new URL('./whisper-worker.js', import.meta.url));

/** Pinned Whisper ONNX releases (Hugging Face LFS oids are the file SHA-256). */
const RELEASES = {
  base: {
    revision: 'bb53ee204431c90d314c1cc08d28d23e5b7927cc',
    repo: 'csukuangfj/sherpa-onnx-whisper-base',
    tokens: { name: 'base-tokens.txt', bytes: 816730, sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126' },
    int8: {
      encoder: { name: 'base-encoder.int8.onnx', bytes: 29120534, sha256: '0b8fb1304b6109976038efff5ace81720e00386f3ff6b54ee8c75291ca0a1e11' },
      decoder: { name: 'base-decoder.int8.onnx', bytes: 130672026, sha256: '9759d217388a01b3a4c7c15533201067b48ae819c4daafc8624e64b9409dc02d' },
    },
    fp32: {
      encoder: { name: 'base-encoder.onnx', bytes: 95087154, sha256: '5a6b87cb313993f6c9fefec9e7027556f6cb30becddf49655bee36c50ecc12d7' },
      decoder: { name: 'base-decoder.onnx', bytes: 196548998, sha256: '8a12c3f6ad65bb5b86d7e6eccc302378f20f9fb2df6cb10747c62895da7ac194' },
    },
  },
  small: {
    revision: '8f3c18b358db4d1f2fc1eae49d75cd20989e4309',
    repo: 'csukuangfj/sherpa-onnx-whisper-small',
    tokens: { name: 'small-tokens.txt', bytes: 816730, sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126' },
    int8: {
      encoder: { name: 'small-encoder.int8.onnx', bytes: 112442483, sha256: '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9' },
      decoder: { name: 'small-decoder.int8.onnx', bytes: 262226114, sha256: 'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee' },
    },
    fp32: {
      encoder: { name: 'small-encoder.onnx', bytes: 409528992, sha256: '119bd1e8ba0524baee1687f6b22bf0abd2fe539549cd000734edbca81c66751e' },
      decoder: { name: 'small-decoder.onnx', bytes: 559127829, sha256: 'a4165cca5c77e381938c0e111032a384901b1e434ae2ad948859035392d21d2c' },
    },
  },
};

/** Silero VAD used to trim silence and split long recordings before recognition. */
const VAD = {
  repo: 'csukuangfj/vad',
  revision: 'fba88cd2e921609e7675c3aaf51e0b9b295da4bc',
  name: 'silero_vad.onnx',
  bytes: 1807522,
  sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
};

/** Download origins offered to the preparation UI. */
const DEFAULT_ORIGINS = ['https://huggingface.co', 'https://hf-mirror.com'];

/** Language hints this provider accepts by default; `auto` means Whisper detects the language. */
const DEFAULT_LANGUAGES = ['auto', 'es', 'en'];

const DOWNLOAD_ERROR_CODES = [
  ['dns', /^(ENOTFOUND|EAI_AGAIN)$/],
  ['timeout', /^(ETIMEDOUT|ERR_SOCKET_TIMEOUT|UND_ERR_(CONNECT|HEADERS|BODY)_TIMEOUT)$/],
  ['certificate', /^(CERT_[A-Z_]+|ERR_TLS_CERT_ALTNAME_INVALID|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/],
  ['storage', /^(ENOSPC|EDQUOT|EACCES|EPERM|EROFS)$/],
  ['network', /^(ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_SOCKET)$/],
];

/** A download failure whose public details exclude raw causes, credentials and local paths. */
class SpeechDownloadError extends Error {
  constructor(download, options) {
    super(`No se pudo preparar ${download.resource} desde ${download.source}: ${download.reason}${download.code ? ` (${download.code})` : ''}${download.status === undefined ? '' : ` (HTTP ${download.status})`}`, options);
    this.download = download;
  }
}

function classifyDownloadFailure(failure) {
  const pending = [failure];
  const visited = new Set();
  let reason = 'unknown';
  while (pending.length > 0) {
    const error = pending.shift();
    if (!(error instanceof Error) || visited.has(error)) continue;
    visited.add(error);
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      if (error.name === 'TimeoutError') return { reason: 'timeout' };
    }
    if (typeof error.code === 'string') {
      for (const [kind, pattern] of DOWNLOAD_ERROR_CODES) if (pattern.test(error.code)) return { reason: kind, code: error.code };
    }
    if (error instanceof TypeError && error.message === 'fetch failed') reason = 'network';
    if (error.cause !== undefined) pending.push(error.cause);
    if (error instanceof AggregateError) pending.push(...error.errors);
  }
  return { reason };
}

/** Validate deployment configuration without pulling in a schema dependency. */
function resolveConfig(raw) {
  const config = raw ?? {};
  const pick = (key, fallback) => (config[key] === undefined ? fallback : config[key]);
  const model = pick('model', 'base');
  if (!Object.hasOwn(RELEASES, model)) throw new Error(`Modelo Whisper desconocido: ${model}`);
  const precision = pick('precision', 'int8');
  if (precision !== 'int8' && precision !== 'fp32') throw new Error(`Precisión Whisper desconocida: ${precision}`);
  const dataRoot = pick('dataRoot', undefined);
  if (typeof dataRoot !== 'string' || dataRoot.length === 0) throw new Error('Whisper requiere dataRoot');
  if (!isAbsolute(dataRoot)) throw new Error(`Las rutas de Whisper deben ser absolutas: ${dataRoot}`);
  const languages = pick('languages', DEFAULT_LANGUAGES);
  if (!Array.isArray(languages) || languages.length === 0 || languages.some((l) => typeof l !== 'string' || l.length === 0)) {
    throw new Error('Whisper requiere una lista de idiomas no vacía');
  }
  if (!languages.includes('es') && !languages.includes('auto')) throw new Error('La lista de idiomas de Whisper debe incluir "es" o "auto"');
  const natural = (key, fallback, min = 1) => {
    const value = pick(key, fallback);
    if (!Number.isInteger(value) || value < min) throw new Error(`Whisper: ${key} debe ser un entero >= ${min}`);
    return value;
  };
  return {
    providerId: pick('providerId', 'whisper-local'),
    dataRoot,
    model,
    precision,
    languages,
    origins: pick('origins', DEFAULT_ORIGINS),
    source: pick('modelOrigin', undefined),
    threads: natural('threads', 2),
    segmentSeconds: pick('segmentSeconds', 28),
    vadThreshold: pick('vadThreshold', 0.5),
    minSpeechSeconds: pick('minSpeechSeconds', 0.25),
    minSilenceSeconds: pick('minSilenceSeconds', 0.5),
    maxAudioBytes: natural('maxAudioBytes', 4 * 1024 * 1024, 46),
    maxResponseBytes: natural('maxResponseBytes', 128 * 1024),
    maxLogBytes: natural('maxLogBytes', 64 * 1024),
    maxPending: natural('maxPending', 2),
    idleTimeoutMs: natural('idleTimeoutMs', 300000, 0),
    graceMs: natural('graceMs', 1000),
    progressIntervalMs: natural('progressIntervalMs', 100),
    sherpaModulePath: pick('sherpaModulePath', undefined),
  };
}

/** Locate the `sherpa-onnx-node` runtime inside the running Harness installation. */
function resolveSherpaModule(explicit) {
  const seen = [];
  if (explicit !== undefined) {
    if (!existsSync(explicit)) throw new Error(`sherpaModulePath no existe: ${explicit}`);
    return explicit;
  }
  const resources = process.resourcesPath;
  const execDir = process.execPath === undefined ? undefined : join(process.execPath, '..');
  const candidates = [];
  if (typeof resources === 'string') {
    candidates.push(join(resources, 'app.asar', 'dsh', 'node_modules', 'sherpa-onnx-node'));
    candidates.push(join(resources, 'app', 'dsh', 'node_modules', 'sherpa-onnx-node'));
  }
  if (typeof execDir === 'string') candidates.push(join(execDir, 'resources', 'app.asar', 'dsh', 'node_modules', 'sherpa-onnx-node'));
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    seen.push(candidate);
  }
  throw new Error(`No se encontró el runtime sherpa-onnx-node; rutas probadas: ${seen.join(', ')}`);
}

/** Paths for one prepared model variant. */
function resolvePaths(config) {
  const release = RELEASES[config.model];
  const variant = release[config.precision];
  const modelRoot = join(config.dataRoot, 'models', `${config.model}-${config.precision}`);
  return {
    release,
    variant,
    modelRoot,
    model: join(modelRoot, variant.encoder.name),
    decoder: join(modelRoot, variant.decoder.name),
    tokens: join(modelRoot, release.tokens.name),
    vad: join(config.dataRoot, 'models', 'silero', VAD.name),
  };
}

/** Build the pinned download URL for one asset from one origin. */
function assetUrl(origin, repo, revision, file) {
  return `${origin.replace(/\/$/, '')}/${repo}/resolve/${revision}/${file}`;
}

async function matchesAsset(path, asset, signal) {
  signal.throwIfAborted();
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    if (info.size !== asset.bytes) return false;
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path, { signal })) digest.update(chunk);
    return digest.digest('hex') === asset.sha256;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

/** Prepare every asset of one variant; cancelled or failed downloads leave no partial file. */
async function downloadAsset(asset, root, origins, signal, report) {
  const destination = join(root, asset.name);
  if (await matchesAsset(destination, asset, signal)) return destination;
  await mkdir(root, { recursive: true });
  const partial = `${destination}.${randomBytes(8).toString('hex')}.part`;
  let lastError;
  for (const origin of origins) {
    signal.throwIfAborted();
    const url = assetUrl(origin, asset.repo, asset.revision, asset.name);
    const source = new URL(url).origin;
    let bytes = 0;
    try {
      const response = await fetch(url, { signal, redirect: 'follow' });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new SpeechDownloadError({ resource: asset.name, source, reason: 'http', status: response.status });
      }
      const digest = createHash('sha256');
      const startedAt = Date.now();
      let lastPublish = 0;
      await pipeline(
        Readable.fromWeb(response.body),
        async function* (source_) {
          for await (const chunk of source_) {
            bytes += chunk.length;
            if (bytes > asset.bytes) throw new SpeechDownloadError({ resource: asset.name, source, reason: 'integrity' });
            digest.update(chunk);
            const now = Date.now();
            if (now - lastPublish >= 100) {
              lastPublish = now;
              report({ phase: 'downloading', resource: asset.name, completedBytes: bytes, totalBytes: asset.bytes, startedAt });
            }
            yield chunk;
          }
        },
        createWriteStream(partial, { flags: 'w', mode: 0o600 }),
      );
      if (bytes !== asset.bytes || digest.digest('hex') !== asset.sha256) {
        throw new SpeechDownloadError({ resource: asset.name, source, reason: 'integrity' });
      }
      signal.throwIfAborted();
      await rename(partial, destination);
      return destination;
    } catch (error) {
      await rm(partial, { force: true });
      if (signal.aborted || error instanceof SpeechDownloadError) {
        if (error instanceof SpeechDownloadError && error.download.reason === 'http' && origins.length > 1) {
          lastError = error;
          continue;
        }
        throw error;
      }
      const classified = classifyDownloadFailure(error);
      lastError = new SpeechDownloadError({ resource: asset.name, source, ...classified }, { cause: error });
      if (classified.reason === 'storage') throw lastError;
    }
  }
  throw lastError ?? new SpeechDownloadError({ resource: asset.name, source: origins[0], reason: 'unknown' });
}

/** Inspect or prepare every file of one variant without loading the native runtime. */
function runtimeAssets(config, paths) {
  return [
    { ...paths.variant.encoder, repo: paths.release.repo, revision: paths.release.revision, path: paths.model, step: 'model' },
    { ...paths.variant.decoder, repo: paths.release.repo, revision: paths.release.revision, path: paths.decoder, step: 'model' },
    { ...paths.release.tokens, repo: paths.release.repo, revision: paths.release.revision, path: paths.tokens, step: 'model' },
    { ...VAD, path: paths.vad, step: 'vad' },
  ];
}

async function inspectRuntime(config, paths, signal) {
  for (const asset of runtimeAssets(config, paths)) {
    if (!(await matchesAsset(asset.path, asset, signal))) return false;
  }
  return true;
}

async function prepareRuntime(config, paths, signal, report) {
  const assets = runtimeAssets(config, paths);
  const origins = config.source === undefined ? config.origins : [config.source];
  for (const asset of assets) {
    signal.throwIfAborted();
    if (await matchesAsset(asset.path, asset, signal)) continue;
    report({ phase: 'checking', step: asset.step, startedAt: Date.now() });
    await downloadAsset(asset, asset.step === 'vad' ? join(config.dataRoot, 'models', 'silero') : paths.modelRoot, origins, signal, (state) => {
      report({ ...state, step: asset.step });
    });
  }
  report({ phase: 'checking', step: 'verify', startedAt: Date.now() });
  if (!(await inspectRuntime(config, paths, signal))) throw new Error('La verificación del modelo Whisper falló: archivos ausentes o corruptos');
  return paths;
}

/** Owns one worker across recordings, plus the preparation state the UI follows. */
class WhisperRecognizer {
  constructor(ctx, config, sherpaModule) {
    this.ctx = ctx;
    this.config = config;
    this.sherpaModule = sherpaModule;
    this.paths = resolvePaths(config);
    this.state = {
      phase: 'unprepared',
      steps: ['check', 'model', 'vad', 'verify', 'load'].map((kind) => ({ kind, status: 'pending' })),
    };
    this.listeners = new Set();
    this.tail = Promise.resolve();
    this.pending = 0;
    this.idle = undefined;
    this.worker = undefined;
    this.runtime = undefined;
    this.preparing = undefined;
    this.lifetime = new AbortController();
  }

  snapshot() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(state) {
    const steps = state.steps ?? this.state.steps.map((step) => {
      if (state.phase === 'ready') return { ...step, status: 'complete' };
      if (state.step === undefined) return step;
      if (state.step === step.kind) return step.status === 'running' ? step : { kind: step.kind, status: 'running', startedAt: state.startedAt ?? Date.now() };
      // The previously running step is finished once preparation moves on to another one.
      return step.status === 'running' ? { ...step, status: 'complete' } : step;
    });
    this.state = { ...state, steps };
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.ctx.logger?.warn?.('Whisper listener failed', error);
      }
    }
  }

  /** Inspect the cache on activation; verified files enter standby without loading the model. */
  inspect() {
    this.runPreparation(async (signal) => {
      this.publish({ phase: 'checking', step: 'check', startedAt: Date.now() });
      const ready = await inspectRuntime(this.config, this.paths, signal);
      this.runtime = ready ? this.paths : undefined;
      this.publish({ phase: ready ? 'standby' : 'unprepared' });
    });
  }

  /** Start or join one preparation task; a manual source disables origin fallback. */
  prepare(options = {}) {
    const source = options.downloadSource;
    if (source !== undefined && !this.downloadSources.includes(source)) throw new Error('La fuente de descarga de voz no está disponible');
    const config = source === undefined ? this.config : { ...this.config, source };
    this.runPreparation(async (signal) => {
      const paths = await prepareRuntime(config, this.paths, signal, (state) => this.publish(state));
      this.runtime = paths;
      this.publish({ phase: 'loading', step: 'load', startedAt: Date.now() });
      await this.start(signal, paths);
      this.publish({ phase: 'ready' });
    });
  }

  runPreparation(run) {
    if (this.preparing || this.worker) return;
    this.lifetime.signal.throwIfAborted();
    const abort = new AbortController();
    const task = { abort, settled: Promise.resolve() };
    this.preparing = task;
    task.settled = (async () => {
      try {
        await run(abort.signal);
      } catch (error) {
        if (this.lifetime.signal.aborted) return;
        this.publish(abort.signal.aborted
          ? { phase: 'cancelled' }
          : {
            phase: 'failed',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof SpeechDownloadError ? { download: error.download } : {}),
          });
      } finally {
        this.preparing = undefined;
      }
    })();
  }

  /** Cancel unfinished preparation; completed readiness is retained. */
  async cancel() {
    const task = this.preparing;
    if (!task) return;
    this.publish({ phase: 'cancelling', startedAt: Date.now() });
    task.abort.abort(new Error('Preparación de voz cancelada'));
    await task.settled;
  }

  get downloadSources() {
    return this.config.source === undefined ? [...new Set(this.config.origins.map((origin) => new URL(origin).origin))] : [];
  }

  /** Spawn the worker (idempotent) and wait for its readiness line. */
  async start(signal, paths = this.paths) {
    signal?.throwIfAborted?.();
    if (this.worker !== undefined && !this.worker.closed) return this.worker;
    const token = randomBytes(32).toString('hex');
    const payload = JSON.stringify({
      sherpaModule: this.sherpaModule,
      model: paths.model,
      decoder: paths.decoder,
      tokens: paths.tokens,
      vad: paths.vad,
      threads: this.config.threads,
      segmentSeconds: this.config.segmentSeconds,
      vadThreshold: this.config.vadThreshold,
      minSpeechSeconds: this.config.minSpeechSeconds,
      minSilenceSeconds: this.config.minSilenceSeconds,
      maxAudioBytes: this.config.maxAudioBytes,
      maxResponseBytes: this.config.maxResponseBytes,
      languages: this.config.languages,
      initialLanguage: this.config.languages.includes('es') ? 'es' : 'auto',
    });
    const child = spawn(process.execPath, [WORKER_PATH, payload], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_SPEECH_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const worker = { child, token, url: undefined, closed: false, stderr: '' };
    child.stderr?.on('data', (chunk) => {
      worker.stderr = (worker.stderr + chunk.toString('utf8')).slice(-this.config.maxLogBytes);
    });
    const port = await new Promise((resolve, reject) => {
      let buffered = '';
      const onData = (chunk) => {
        buffered += chunk.toString('utf8');
        if (Buffer.byteLength(buffered) > this.config.maxLogBytes) {
          reject(new Error('El worker de voz superó el límite de bytes de arranque'));
          return;
        }
        const end = buffered.indexOf('\n');
        if (end < 0) return;
        try {
          const value = JSON.parse(buffered.slice(0, end));
          resolve(value.port);
        } catch (error) {
          reject(new Error('Respuesta de arranque inválida del worker de voz', { cause: error }));
        }
      };
      child.stdout?.on('data', onData);
      child.once('error', reject);
      child.once('exit', (code, signalName) => reject(new Error(`El worker de voz terminó antes de estar listo (${signalName ?? code}): ${worker.stderr.slice(-400)}`)));
      signal?.addEventListener?.('abort', () => reject(signal.reason ?? new Error('Arranque de voz cancelado')), { once: true });
    }).catch((error) => {
      worker.closed = true;
      child.kill();
      throw error;
    });
    worker.url = `http://127.0.0.1:${port}`;
    this.worker = worker;
    child.once('exit', () => {
      if (!worker.closed) {
        worker.closed = true;
        if (this.worker === worker) {
          this.worker = undefined;
          this.publish({ phase: 'standby' });
        }
      }
    });
    return worker;
  }

  async stop() {
    const worker = this.worker;
    if (worker === undefined) return;
    worker.closed = true;
    this.worker = undefined;
    worker.child.kill();
    await new Promise((resolve) => worker.child.once('exit', resolve));
    this.publish({ phase: 'standby' });
  }

  /** Queue one bounded recording; the worker is serial and reused across requests. */
  transcribe(input, signal) {
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    combined.throwIfAborted();
    if (this.state.phase !== 'ready' && this.state.phase !== 'standby') {
      throw new Error('Prepará el modelo de voz Whisper antes de grabar');
    }
    if (this.pending >= this.config.maxPending) throw new Error('La cola de transcripción de voz está llena');
    clearTimeout(this.idle);
    this.pending++;
    const job = this.tail.then(async () => {
      combined.throwIfAborted();
      const worker = await this.start(combined);
      const response = await fetch(`${worker.url}/transcribe?language=${encodeURIComponent(input.language)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${worker.token}`, 'content-type': 'audio/wav' },
        body: Buffer.from(input.audio),
        signal: combined,
      });
      const text = await response.text();
      if (text.length > this.config.maxResponseBytes) throw new Error('La respuesta de voz superó el límite de bytes');
      const value = JSON.parse(text);
      if (!response.ok) throw new Error(value.error ?? `El worker de voz respondió HTTP ${response.status}`);
      return value;
    });
    this.tail = job.then(() => undefined, () => undefined).finally(() => {
      this.pending--;
      if (this.pending === 0 && !this.lifetime.signal.aborted && this.config.idleTimeoutMs > 0) {
        this.idle = setTimeout(() => {
          this.stop().catch((error) => this.ctx.logger?.warn?.('Falló la liberación del worker de voz', error));
        }, this.config.idleTimeoutMs);
        this.idle.unref?.();
      }
    });
    return job;
  }

  async dispose() {
    this.listeners.clear();
    this.lifetime.abort(new Error('Proveedor Whisper descargado'));
    clearTimeout(this.idle);
    try {
      await this.tail;
    } finally {
      await this.stop();
    }
    await this.preparing?.settled;
  }
}

/**
 * Register the Whisper recognizer; activation never downloads or loads a model.
 * @param ctx - Host context providing the speech registry and logger.
 * @param rawConfig - deployment configuration from the profile entry.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const sherpaModule = resolveSherpaModule(config.sherpaModulePath);
  const recognizer = new WhisperRecognizer(ctx, config, sherpaModule);
  // La estimación de disco sale de los tamaños fijados, así se mantiene sola al cambiar de variante.
  const pinnedAssets = [recognizer.paths.variant.encoder, recognizer.paths.variant.decoder, recognizer.paths.release.tokens, VAD];
  const estimate = pinnedAssets.reduce((total, asset) => total + asset.bytes, 0);
  ctx.effect(() => {
    const unregister = ctx.speechToText.register({
      info: {
        id: config.providerId,
        name: `Whisper ${config.model === 'small' ? 'Small' : 'Base'} multilingüe (${config.precision.toUpperCase()})`,
        location: 'host-local',
        languages: config.languages,
        downloadSources: recognizer.downloadSources,
        setupEstimate: {
          recommendedDiskBytes: estimate,
          expectedMemoryBytes: 1024 * 1024 * 1024,
          minimumMinutes: 1,
          maximumMinutes: 6,
        },
      },
      preparation: recognizer,
      transcribe: async (input, signal) => await recognizer.transcribe(input, signal),
    });
    recognizer.inspect();
    return async () => {
      const removing = unregister();
      await recognizer.dispose();
      await removing;
    };
  });
}
