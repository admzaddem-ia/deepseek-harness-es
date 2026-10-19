# Herramientas de mantenimiento

Estos scripts sirven para **regenerar y verificar** los paquetes de este repositorio. No hacen falta
para usarlos: si solo querés la interfaz en español y el dictado, mirá el
[README principal](../README.md).

## Requisitos

Node 18 o superior. Si no tenés `node` en el PATH, podés usar el que DeepSeek Harness ya descargó:

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node tools\ci-validate.mjs
```

Todos los scripts resuelven la raíz del repositorio a partir de su propia ubicación, así que se
pueden ejecutar desde cualquier carpeta. Cada uno tiene `Uso:` en su encabezado; los que reciben
argumentos (`dsh-asar-list`, `dsh-asar-extract`, `extract-corpus`, `make-batches`,
`validate-batches`, `download-model`, `test-whisper-provider`) también aceptan `--help`. Los tres de
entrada fija (`ci-validate`, `verify-client-bundle`, `build-locale-pack`) se ejecutan directamente y
no leen argumentos.

## Verificación (entorno limpio, sin DSH)

| Script | Uso |
|---|---|
| `ci-validate.mjs` | `node tools/ci-validate.mjs` |
| `verify-client-bundle.mjs` | `node tools/verify-client-bundle.mjs` |
| `validate-batches.mjs` | `node tools/validate-batches.mjs tools/corpus/batches` |

- **`ci-validate.mjs`** — valida los manifiestos de los paquetes, que todos los JSON parseen, que el
  `id` del bundle coincida con el nombre del paquete, que el corpus y la traducción tengan las mismas
  claves y que no haya rutas personales. Es lo que corre el CI.
- **`verify-client-bundle.mjs`** — simula el cargador de módulos del navegador y el servicio `locale`,
  activa el paquete del idioma y falla si alguna clave queda sin resolver o si un `{marcador}` cambió.
- **`validate-batches.mjs`** — comprueba que cada lote de traducción tenga exactamente las claves
  pedidas, sin vacíos indebidos y con los mismos `{marcadores}`.

## Extracción y traducción

| Script | Uso |
|---|---|
| `dsh-asar-list.mjs` | `DSH_APP_ASAR=<ruta al app.asar> node tools/dsh-asar-list.mjs [indice.json]` |
| `dsh-asar-extract.mjs` | `DSH_APP_ASAR=<ruta al app.asar> node tools/dsh-asar-extract.mjs <indice.json> <carpeta-salida> <patron>` |
| `extract-corpus.mjs` | `node tools/extract-corpus.mjs --dir <carpeta> [--out <archivo.json>]` |
| `make-batches.mjs` | `node tools/make-batches.mjs --corpus <corpus.json> --out <carpeta> [--cap <claves>]` |
| `build-locale-pack.mjs` | `node tools/build-locale-pack.mjs` |

Flujo completo en [`docs/DESARROLLO.md`](../docs/DESARROLLO.md).

> `build-locale-pack.mjs` **reescribe** `locale-es/client.js` y `locale-es/cordis.patch.yml` a partir
> de `tools/corpus/`. Es idempotente (regenerarlo sin cambios no altera nada), pero conviene correr
> `verify-client-bundle.mjs` después.

## Modelos y voz

| Script | Uso |
|---|---|
| `download-model.mjs` | `node tools/download-model.mjs --out <carpeta> <nombre>=<url> [<nombre>=<url> ...]` |
| `test-whisper-provider.mjs` | `node tools/test-whisper-provider.mjs <audio.wav> [idioma] [texto esperado]` |

- **`download-model.mjs`** — descarga archivos y calcula su SHA-256. Se usa para obtener el tamaño y
  el hash que después se fijan en `speech-to-text-whisper/index.js`. En Hugging Face, el `lfs.oid`
  de la API **es** ese SHA-256.
- **`test-whisper-provider.mjs`** — prueba de integración del proveedor de voz con un contexto Cordis
  simulado: inspecciona la caché, prepara el modelo, transcribe el WAV y compara palabras clave.
  Necesita DSH instalado (usa su runtime y el `app.asar`); si no encuentra el ejecutable de Electron,
  imprime el comando manual.

## Diagnóstico

| Script | Uso |
|---|---|
| `quitar-preferencia-perfil.mjs` | `node tools/quitar-preferencia-perfil.mjs <cordis.patch.yml del perfil>` |
| `ci-validate.mjs` | `node tools/ci-validate.mjs` (verificación completa) |

- **`quitar-preferencia-perfil.mjs`** — borra a propósito la preferencia de idioma del patch del perfil
  (deja una copia `.antes-de-la-prueba`) y así se comprueba que el paquete del español la repone solo
  al recargar la página. Es la prueba de permanencia descrita en
  [`docs/VERIFICACION.md`](../docs/VERIFICACION.md).

## Variables de entorno

| Variable | Usada por | Significado |
|---|---|---|
| `DSH_APP_ASAR` | `dsh-asar-*`, `test-whisper-provider` | Ruta al `app.asar` de la instalación |
| `DSH_CLIENT_BUNDLES` | `extract-corpus` | Carpeta con los `client.js` ya extraídos |
| `DSH_INSTALL` | `test-whisper-provider` | Carpeta de instalación de DSH |
| `DSH_ELECTRON` | `test-whisper-provider` | Ruta al ejecutable de Electron de DSH |
| `DSH_SPEECH_DATA_ROOT` | `test-whisper-provider` | Carpeta de datos del proveedor (`~/.dsh/speech-to-text/whisper`) |
| `DSH_WHISPER_PROVIDER` | `test-whisper-provider` | Ruta alternativa a `speech-to-text-whisper/index.js` |
| `WHISPER_MODEL` | `test-whisper-provider` | Variante del modelo: `base` (por defecto) o `small` |

## Datos

`tools/corpus/` guarda el corpus y su traducción:

| Archivo | Contenido |
|---|---|
| `corpus.json` | Claves inglesas extraídas del build instalado (57 namespaces, 2.433 claves) |
| `es.json` | Traducción final, tal como queda dentro de `locale-es/client.js` |
| `batches/batch-NN.in.json` | Lote de entrada (namespace, clave y texto inglés) |
| `batches/batch-NN.out.json` | Lote traducido |
| `batches/manifest.json` | Índice de lotes con sus nombres de archivo relativos |
