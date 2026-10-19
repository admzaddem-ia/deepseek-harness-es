# `@local/dsh-speech-to-text-whisper` — dictado local en español

Proveedor de reconocimiento de voz para DeepSeek Harness basado en **Whisper multilingüe** ejecutado
con el runtime `sherpa-onnx` que DSH ya incluye.

| | |
|---|---|
| Nombre del paquete | `@local/dsh-speech-to-text-whisper` |
| Id del proveedor | `whisper-local` |
| Idiomas | `auto`, `es`, `en` (configurable) |
| Ubicación | `host-local` (todo en tu máquina) |
| Modelos | `base` o `small`, en `int8` o `fp32`, descargados y verificados por SHA-256 |

## Por qué existe

El reconocedor que DSH trae (SenseVoice) no conoce el español: su modelo es
`sense-voice-zh-en-ja-ko-yue` y el host rechaza cualquier otro idioma. Whisper sí, y el runtime
nativo necesario ya está instalado con DSH, así que el proveedor no agrega dependencias.

## Uso

1. Instalá el paquete (`install_bundle` con la ruta absoluta, o **Plugins → Agregar plugin**).
2. Abrí el panel del micrófono: aparece **Whisper Base multilingüe (INT8)** y el idioma `es`.
3. La primera vez, **Descargar y preparar** (~162 MB para `base` int8; ~377 MB para `small` int8).

## Configuración

En `cordis.patch.yml` de este paquete, dentro del `config` de la fila `speech-to-text-whisper`:

| Clave | Por defecto | Significado |
|---|---|---|
| `dataRoot` | `dshHomePath('speech-to-text', 'whisper')` | Carpeta de modelos y datos |
| `model` | `base` | `base` o `small` |
| `precision` | `int8` | `int8` (rápido) o `fp32` (más pesado) |
| `languages` | `['auto','es','en']` | Idiomas que ofrece el proveedor |
| `threads` | `2` | Hilos de CPU para la inferencia |
| `modelOrigin` | (sin fijar) | Forzar una sola fuente de descarga, por ejemplo `https://hf-mirror.com` |
| `segmentSeconds` | `28` | Duración máxima de cada segmento que se le pasa a Whisper |
| `idleTimeoutMs` | `300000` | Tiempo de inactividad antes de apagar el proceso de reconocimiento |

Este paquete también sobreescribe la fila `speech-to-text` para dejar Whisper y `es` seleccionados
por defecto. Si el usuario elige otra cosa en el panel de voz, esa elección se guarda en el perfil y
tiene prioridad.

## Arquitectura

```
index.js            Mitad Host: assets fijados, descarga y verificación, ciclo del worker,
                    registro del proveedor en ctx.speechToText
whisper-worker.js   Proceso hijo: valida el WAV, trocea con VAD Silero, decodifica con Whisper
                    y responde por un socket 127.0.0.1 autenticado con un token por proceso
cordis.patch.yml    Inserta la fila del proveedor y ajusta la selección por defecto
```

La mitad Host usa **solo módulos nativos de Node**, así que se resuelve desde el perfil sin depender
del grafo de paquetes de la instalación. El runtime `sherpa-onnx-node` se localiza dentro de la
instalación de DSH a través de `process.resourcesPath`.

## Modelos

| Variante | Archivos | Descarga |
|---|---|---|
| `base` int8 (por defecto) | encoder + decoder + tokens | ~162 MB |
| `small` int8 | encoder + decoder + tokens | ~377 MB |
| Silero VAD | `silero_vad.onnx` | ~1,8 MB |

Cada archivo está fijado por revisión, tamaño y SHA-256 tomados del `lfs.oid` publicado en Hugging
Face. Si la verificación falla, el archivo se descarta y el panel muestra el error; las fuentes se
prueban en orden (`huggingface.co` y `hf-mirror.com`).

## Privacidad

El audio no sale de la máquina: se envía por un socket local (`127.0.0.1`) autenticado con un token
aleatorio que se genera por proceso. Lo único que se descarga de internet son los pesos del modelo.

## Desinstalar

Plugins → tarjeta del plugin → **Desinstalar**. Los modelos quedan en disco y se pueden borrar a
mano desde `$DSH_HOME/speech-to-text/whisper`.

## Notas

- El selector de idioma muestra `es` en lugar de «Español» (el bundle de voz de DSH solo traduce
  `auto/zh/en/yue/ja/ko`).
- Sin transcripción en tiempo real, sin GPU y con un límite de 120 s / 4 MB por grabación (los
  aplica la API de voz de DSH).
- Más detalle en [`../docs/LIMITACIONES.md`](../docs/LIMITACIONES.md).
