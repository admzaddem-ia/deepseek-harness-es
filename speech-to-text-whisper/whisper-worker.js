/**
 * Private child process for `@local/dsh-speech-to-text-whisper`.
 *
 * Owns the native Whisper recognizer and the Silero VAD, serves one authenticated loopback
 * endpoint, and prints exactly one readiness line on stdout. The Host owns termination, so this
 * file never decides its own lifetime.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

/** An input rejected before native inference; the loaded recognizer stays reusable. */
class SpeechInputError extends Error {}

/** Parse and validate the canonical 16 kHz mono PCM WAV the Client records. */
function parseWave(audio, maxAudioBytes) {
  if (audio.length > maxAudioBytes) throw new SpeechInputError('El audio supera el límite de bytes');
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    throw new SpeechInputError('El audio no es un WAV válido');
  }
  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= audio.length) {
    const id = audio.toString('ascii', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= audio.length) {
      format = {
        audioFormat: audio.readUInt16LE(body),
        channels: audio.readUInt16LE(body + 2),
        sampleRate: audio.readUInt32LE(body + 4),
        bitsPerSample: audio.readUInt16LE(body + 14),
      };
    }
    if (id === 'data') data = { start: body, size: Math.min(size, audio.length - body) };
    offset = body + size + (size % 2);
  }
  if (format === undefined || data === undefined) throw new SpeechInputError('Al WAV le falta el bloque de formato o de datos');
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16 || format.sampleRate !== 16000) {
    throw new SpeechInputError(`Se esperaba WAV PCM de 16 bits, mono y 16 kHz (recibido formato ${format.audioFormat}, ${format.channels} canal/es, ${format.bitsPerSample} bits, ${format.sampleRate} Hz)`);
  }
  const samples = new Float32Array(data.size / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = audio.readInt16LE(data.start + i * 2) / 32768;
  return { samples, seconds: samples.length / format.sampleRate };
}

/** Whisper accepts an empty language for auto-detection. */
function whisperLanguage(language) {
  return language === 'auto' || language === '' ? '' : language;
}

/** CPU Whisper inference plus Silero segmentation, confined to the recognition process. */
function createTranscriber(config) {
  const require = createRequire(import.meta.url);
  const sherpa = require(config.sherpaModule);
  const nativeConfig = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: config.model,
        decoder: config.decoder,
        language: whisperLanguage(config.initialLanguage ?? 'auto'),
        task: 'transcribe',
      },
      tokens: config.tokens,
      numThreads: config.threads,
      provider: 'cpu',
      debug: 0,
    },
  };
  const recognizer = new sherpa.OfflineRecognizer(nativeConfig);
  const detector = new sherpa.Vad({
    sileroVad: {
      model: config.vad,
      threshold: config.vadThreshold,
      minSilenceDuration: config.minSilenceSeconds,
      minSpeechDuration: config.minSpeechSeconds,
      maxSpeechDuration: config.segmentSeconds,
      windowSize: 512,
    },
    sampleRate: 16000,
    numThreads: config.threads,
    provider: 'cpu',
    debug: 0,
  }, config.segmentSeconds + config.minSilenceSeconds + 1);

  return (audio, language) => {
    if (!config.languages.includes(language)) throw new SpeechInputError(`Idioma no admitido por Whisper: ${language}`);
    const { samples, seconds } = parseWave(audio, config.maxAudioBytes);
    nativeConfig.modelConfig.whisper.language = whisperLanguage(language);
    recognizer.setConfig(nativeConfig);
    detector.reset();
    const started = performance.now();
    const texts = [];
    const drain = () => {
      while (!detector.isEmpty()) {
        const segment = detector.front(false);
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate: 16000, samples: segment.samples });
        recognizer.decode(stream);
        const text = recognizer.getResult(stream).text.trim();
        if (text !== '') texts.push(text);
        detector.pop();
      }
    };
    for (let offset = 0; offset < samples.length; offset += 512) {
      detector.acceptWaveform(samples.subarray(offset, offset + 512));
      drain();
    }
    detector.flush();
    drain();
    return {
      text: texts.join(' ').trim(),
      audioSeconds: seconds,
      inferenceSeconds: (performance.now() - started) / 1000,
    };
  };
}

/** Bind an ephemeral loopback listener; readiness is published only after the model loads. */
async function startRecognitionServer(token, config, transcribe) {
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer((request, response) => {
    const reply = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    };
    const authorization = Buffer.from(request.headers.authorization ?? '');
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      request.resume();
      reply(401, { error: 'No autorizado' });
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'POST' || url.pathname !== '/transcribe') {
      request.resume();
      reply(404, { error: 'Endpoint desconocido' });
      return;
    }
    const length = Number(request.headers['content-length']);
    if (!Number.isSafeInteger(length) || length < 46 || length > config.maxAudioBytes) {
      request.resume();
      reply(413, { error: 'Tamaño de audio inválido', code: 'invalid-input' });
      return;
    }
    (async () => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        reply(200, transcribe(Buffer.concat(chunks), url.searchParams.get('language') ?? 'auto'));
      } catch (error) {
        reply(error instanceof SpeechInputError ? 400 : 500, {
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof SpeechInputError ? { code: 'invalid-input' } : {}),
        });
      }
    })();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return { server, port: server.address().port };
}

const config = JSON.parse(process.argv[2]);
const token = process.env.DSH_SPEECH_TOKEN;
delete process.env.DSH_SPEECH_TOKEN;
if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
  process.stderr.write('Token de voz inválido\n');
  process.exit(2);
}
const { port } = await startRecognitionServer(token, config, createTranscriber(config));
process.stdout.write(`${JSON.stringify({ port })}\n`);
