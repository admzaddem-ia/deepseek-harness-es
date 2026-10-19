# Verificación

Todo lo que afirma el README se comprobó contra la aplicación en ejecución y contra el runtime real
de reconocimiento de voz. Esta página lista qué se probó, cómo y con qué resultado, y cómo
reproducirlo.

## Resumen

| Qué se verificó | Cómo | Resultado |
|---|---|---|
| Contrato del bundle de cliente | Se evaluó `locale-es/client.js` en un `vm` con un `window.__ModuleLoader__` falso, se ejecutó `factory()` y `apply(ctx)` con un servicio `locale` simulado | 1 idioma registrado, 57 diccionarios, 58 efectos |
| Auto-selección del idioma | El mismo banco de pruebas registra las llamadas a `setLocale` y repite `apply()` con `preference: false` | `setLocale('es')` llamado; con `preference: false` no se llama |
| Invariante del patch del paquete | `verify-client-bundle.mjs` falla si el patch del bundle declara `preference:` | Sin `preference:` en `locale-es/cordis.patch.yml` |
| Autorreparación en la app real | Se quitó la preferencia del patch del perfil (`tools/quitar-preferencia-perfil.mjs`) y se recargó la página con Ctrl+Shift+R | La interfaz siguió en español, sin ninguna preferencia guardada: el paquete la activa en cada carga |
| Cobertura de la traducción | Clave por clave contra los 2.433 textos ingleses del build instalado | 100 %, 0 claves sin resolver |
| Integridad de los `{marcadores}` | Comparación del multiconjunto de `{…}` de cada valor con su original | 0 discrepancias |
| Composición del perfil | `plugin_manager list_plugins` sobre la aplicación en ejecución | `locale-es` y `speech-to-text-whisper` con `fiberPhase: active` |
| Contrato del proveedor de voz | Prueba de integración con el binario de Electron en modo Node y un `ctx` simulado | `unprepared → checking → downloading → verify → loading → ready` |
| Descarga de modelos y verificación SHA-256 | Descarga real desde Hugging Face y contraste del hash | Coincide con el `oid` LFS publicado |
| Dictado en español, variante `base` int8 | Audio de 6,8 s generado con la voz `Microsoft Helena (es-ES)` | «Esto es una prueba dedicada en español. La reunión empieza a las 9 y media de la mañana.» — 7/10 palabras clave, 2,98 s de inferencia |
| Dictado en español, variante `small` int8 | El mismo audio | Transcripción correcta en español, 7,33 s de inferencia |
| Estado visible para el usuario | Confirmación en la ventana de DSH | Interfaz en español; panel de voz con «Whisper Base multilingüe (INT8)» e idioma `es` |

## Cómo reproducirlo

### 1. Validación de manifiestos y portabilidad

```bash
node tools/ci-validate.mjs
```

Comprueba que los `package.json` y los JSON de `locale/` parseen, que el `id` del bundle coincida
con el nombre del paquete y que no haya rutas absolutas de una máquina concreta en el repositorio.
Es lo que corre el CI en cada push.

### 2. Bundle del idioma (no necesita DSH)

```bash
node tools/verify-client-bundle.mjs
```

Simula el module-loader del navegador y el servicio `locale`: activa el plugin, recorre las 57
secciones y falla si alguna clave queda sin resolver o si un `{marcador}` cambió. Salida esperada:

```
registered locales: 1
registered dictionaries: 57
effects registered: 58
corpus namespaces: 57
unresolved keys: 0
identical-to-English keys: 127
---
PASS: bundle contract, activation, and full es coverage verified
```

### 3. Proveedor de voz (necesita DSH instalado y un audio)

```bash
node tools/test-whisper-provider.mjs samples/prueba-es.wav es \
  "Hola, esto es una prueba de dictado en español. La reunión empieza a las nueve y media de la mañana."
```

El script se relanza solo con el Electron de DSH (lo busca en `DSH_ELECTRON`, `DSH_INSTALL`, la
carpeta deducida de `DSH_APP_ASAR` o las ubicaciones de instalación habituales). Si preferís
ejecutarlo a mano:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& "<ruta a DeepSeek Harness.exe>" --expose-internals `
  tools\test-whisper-provider.mjs samples\prueba-es.wav es `
  "Hola, esto es una prueba de dictado en español. La reunión empieza a las nueve y media de la mañana."
```

El script levanta el proveedor con un `ctx` simulado, espera a que el modelo esté listo, transcribe
el WAV y compara palabras clave. La primera ejecución descarga la variante que falte.

`WHISPER_MODEL=small` selecciona la otra variante.

### 4. Estado de los plugins en el perfil

Con el agente de DSH:

> Listá los plugins con `plugin_manager` (`action: list_plugins`) y decime si
> `speech-to-text-whisper` y `locale-es` están activos.

## Cómo se generó el audio de prueba

No se usó ningún archivo de terceros: `samples/prueba-es.wav` se generó en esta máquina con la voz
TTS de Windows **Microsoft Helena (es-ES)** en formato PCM 16 kHz, mono, 16 bits:

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Helena Desktop')
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('samples\prueba-es.wav', $fmt)
$s.Speak('Hola, esto es una prueba de dictado en español. La reunión empieza a las nueve y media de la mañana.')
$s.Dispose()
```

## Errores encontrados durante el desarrollo

- **La preferencia del idioma se perdía al reescribirse el patch del perfil.** La aplicación reescribe
  `$DSH_HOME/profiles/<perfil>/cordis.patch.yml` cuando se cambia cualquier ajuste (tamaño de fuente,
  activar/desactivar herramientas…). En una de esas reescrituras se perdió el bloque
  `- id: locale` con `preference: es`, y la interfaz volvió al idioma del navegador aunque el bundle
  del idioma siguiera instalado y activo. Lo comprobamos en la app real: el host seguía mostrando
  `include:locale-es` con `fiberPhase: active` y el selector de idioma ofrecía «Español», pero el
  idioma activo era inglés. Se corrigió con dos cambios: (1) el paquete ahora llama a
  `ctx.locale.setLocale('es')` en cada activación, que escribe la preferencia por la vía oficial, y
  (2) el patch del paquete ya **no** declara `preference`, para que el valor del perfil nunca coincida
  con el heredado del bundle (si coincidiera, la aplicación lo descartaría como redundante). Tras la
  corrección, se verificó en la app: al recargar, la interfaz quedó en español.
- **SHA-256 del VAD mal escrito a mano.** El primer intento de preparación falló con
  `integrity` porque el hash fijado tenía un carácter equivocado. Se corrigió leyendo el hash desde
  el `assets.json` del build instalado en vez de tipearlo, y se agregó la validación de CI.
- **Selector de idioma sin nombre para `es`.** El bundle de voz de DSH traduce solo
  `auto/zh/en/yue/ja/ko`, así que el español se muestra como `es`. No es un defecto del plugin y no
  se puede corregir sin modificar la instalación de DSH.
