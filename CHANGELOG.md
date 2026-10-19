# Historial de cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado es
[SemVer](https://semver.org/lang/es/).

## [1.0.0] — 2026-10-12

Primera versión publicable: interfaz en español y dictado en español, verificados sobre
DeepSeek Harness `0.2.0-rc.2` (aplicación de escritorio, perfil `desktop`, Windows 11 x64).

### Agregado

- **`locale-es/`** — paquete de idioma para la interfaz web:
  - 57 namespaces y 2.433 textos traducidos a español neutro (es-419).
  - Registro del idioma `Español` con cadena de respaldo `es → en`: una clave sin traducir muestra
    el inglés, nunca la clave cruda.
  - **Auto-selección autorreparable:** el bundle llama a `setLocale('es')` en cada carga, la vía
    oficial de la preferencia (settings). La garantía no depende del patch del perfil: aunque la
    aplicación lo reescriba y borre la preferencia, el español vuelve a quedar activo en la siguiente
    carga (verificado en la aplicación real). Con `preference: false` en la config de la fila, solo
    registra el idioma sin seleccionarlo.
  - Bundle de cliente con el diccionario completo, sin dependencias externas.

- **`speech-to-text-whisper/`** — proveedor local de reconocimiento de voz multilingüe:
  - Idiomas `auto`, `es`, `en`; Whisper multilingüe sobre el runtime `sherpa-onnx` que ya incluye DSH.
  - Descarga de pesos con verificación de tamaño y SHA-256, y publicación atómica del archivo.
  - Máquina de estados de preparación con progreso (`check`, `model`, `vad`, `verify`, `load`) que el
    panel de voz de DSH muestra tal cual.
  - Process hijo con el reconocedor nativo y el VAD Silero, comunicación por un socket local
    autenticado con un token aleatorio por proceso.
  - Variantes fijadas: `base` y `small`, en `int8` y `fp32`, con revisión, tamaño y hash de cada
    archivo.
  - El bundle deja Whisper seleccionado con idioma `es` por defecto (la elección del usuario en el
    perfil tiene prioridad).

- **Herramientas** (`tools/`) — extracción del corpus desde el `app.asar` instalado, lotes de
  traducción, validación y verificación del bundle, más las herramientas de descarga y prueba del
  modelo.
- **Documentación** (`docs/`) — instalación, verificación con evidencia, desarrollo y límites.
- **CI** (`.github/workflows/verify.yml`) — valida manifiestos, portabilidad y el contrato del
  bundle del idioma en cada push.

### Verificado

- Cobertura de traducción: 100 % de las 2.433 claves, con paridad de `{marcadores}`.
- Contrato del bundle de cliente simulado con el cargador del navegador: 1 idioma, 57 diccionarios,
  58 efectos.
- Proveedor de voz contra el runtime real: preparación completa y transcripción de audio en español
  (6,8 s de audio en 2,98 s con `base` int8).
- Confirmación visual en la aplicación en ejecución: interfaz en español y panel de voz con
  «Whisper Base multilingüe (INT8)» e idioma `es`.

### Notas

- Los pesos de los modelos no se distribuyen: se descargan desde Hugging Face la primera vez.
- Límites conocidos en [`docs/LIMITACIONES.md`](docs/LIMITACIONES.md), incluido que el selector de
  idioma del dictado muestra `es` en lugar de «Español» (el bundle de voz de DSH solo traduce
  `auto/zh/en/yue/ja/ko`).
