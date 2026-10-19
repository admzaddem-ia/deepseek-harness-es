# DeepSeek Harness en español

**Interfaz en español y dictado por voz en español para [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**

DeepSeek Harness (DSH) solo trae dos idiomas de interfaz, inglés y chino, y su reconocedor de voz
local (SenseVoice) no conoce el español. Este repositorio agrega las dos cosas como **plugins
locales**, sin modificar la instalación de DSH y sin enviar audio a ningún servicio:

| Paquete | Qué agrega |
|---|---|
| [`locale-es/`](locale-es/) | Traducción completa de la interfaz: **57 secciones, 2.433 textos**, con respaldo automático al inglés |
| [`speech-to-text-whisper/`](speech-to-text-whisper/) | Dictado local con **Whisper multilingüe** sobre el runtime `sherpa-onnx` que DSH ya incluye; idiomas `auto`, `es`, `en` |

Todo se ejecuta en tu máquina. El audio nunca sale del equipo y no hace falta ninguna cuenta ni
clave de API.

---

## Estado

| | |
|---|---|
| Probado en | DeepSeek Harness `0.2.0-rc.2` (aplicación de escritorio, perfil `desktop`, Windows 11 x64) |
| Interfaz | Verificada en la aplicación en ejecución: la ventana completa aparece en español |
| Dictado | Verificado con audio real en español: `base` int8 transcribió 6,8 s de audio en 2,98 s |
| Instalación | La mitad Host se registra en caliente; la interfaz adopta el idioma al recargar la página |

Detalle de las pruebas y cómo reproducirlas: [`docs/VERIFICACION.md`](docs/VERIFICACION.md).

---

## Requisitos

- DeepSeek Harness instalado (versión de escritorio, con perfil; las versiones `0.2.0-rc.*` son las
  probadas).
- Windows, macOS o Linux. La ruta es la misma en los tres: `$DSH_HOME/profiles/<perfil>`.
- Para el dictado: ~162 MB (`base` int8) o ~377 MB (`small` int8) de disco libre por variante de
  modelo (se descargan la primera vez) y alrededor de 1 GB de RAM durante la transcripción.

---

## Instalación

Hay dos caminos. El primero es el más simple si usás el agente dentro de DSH; el segundo es manual y
funciona igual.

### Camino A — pedirle al agente de DSH

1. Cloná o descomprimá este repositorio en tu equipo. Por ejemplo:
   `C:\Users\<vos>\dsh-espanol`
2. Abrí DSH y pedile al agente, con las rutas de las dos carpetas:

   > Instalá los paquetes de plugin que están en
   > `C:\Users\<vos>\dsh-espanol\locale-es` y
   > `C:\Users\<vos>\dsh-espanol\speech-to-text-whisper` usando `plugin_manager` con
   > `action: install_bundle`.

El agente ejecuta `install_bundle` para cada carpeta, que hace `pnpm add` en el perfil y activa los
bundles. Los cambios se aplican en caliente.

### Camino B — desde la interfaz, sin agente

1. En DSH, abrí **Plugins** en la barra lateral.
2. **Agregar plugin** → pegá la **ruta absoluta** de la carpeta `locale-es` del repositorio clonado.
3. Instalá. Cuando termine, repetí con la ruta de `speech-to-text-whisper`.
4. Recargá la página (F5 / Ctrl+R) si la interfaz no cambia sola.

### Camino C — desde la terminal, con el CLI de DSH

DSH trae un lanzador de línea de comandos. Solo administra perfiles que no son de la aplicación de
escritorio, así que **no sirve para el perfil `desktop`** (para ese usá el camino A o B):

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile web add "C:\Users\<vos>\dsh-espanol\locale-es"
```

> Con el perfil `desktop` el CLI responde «profile "desktop" is managed exclusively by the Electron
> application». Para ese perfil, el camino A (agente) o el B (interfaz) son los que funcionan.

---

## Comprobar que quedó bien

1. **Interfaz:** Ajustes → **General** → **Idioma**. Debe aparecer **Español** entre las opciones, y
   la interfaz tiene que estar en español.
2. **Dictado:** abrí el panel del micrófono (el botón azul con forma de onda, junto al selector de
   modelo). Debe figurar el proveedor **«Whisper Base multilingüe (INT8)»** y el idioma en **`es`**.
3. **Primera grabación:** si el modelo de la variante elegida todavía no está descargado, el panel
   ofrece **Descargar y preparar**. La descarga se verifica con SHA-256 antes de usarse.

---

## Uso

### Cambiar el idioma de la interfaz

No hace falta hacer nada: además de registrar «Español», el paquete **lo deja activo él mismo** con la
API oficial de idioma (`setLocale('es')`) en cada carga de la página. Esa llamada es la vía de la
preferencia (settings): si el servicio la acepta, además queda guardada en el patch del perfil. En
cualquier caso la garantía no depende de ese archivo, y por eso el idioma sobrevive a que la
aplicación lo reescriba o lo pierda.

Para usar otro idioma hay que **desinstalar** `@local/dsh-locale-es`: mientras siga instalado, el
español vuelve a quedar seleccionado. Si querés conservar el paquete solo como registro del idioma
(sin que lo seleccione), agregá `preference: false` a la config de su fila:

```yaml
- id: locale-es
  name: '@local/dsh-locale-es'
  config:
    preference: false
```

### Cambiar la variante del modelo de voz

En `speech-to-text-whisper/cordis.patch.yml`, el `config` de la fila `speech-to-text-whisper` ya
trae `dataRoot`; agregale las claves de la variante que quieras:

```yaml
- insert:
    - id: speech-to-text-whisper
      name: '@local/dsh-speech-to-text-whisper'
      config:
        dataRoot: !!js dshHomePath('speech-to-text', 'whisper')
        model: small        # base (por defecto) o small: más preciso y ~2,7x más lento
        precision: int8     # int8 (por defecto) o fp32
```

Guardá el archivo y esperá unos segundos: el perfil se recomienda solo (HMR). Cada variante tiene su
propia carpeta (`models/base-int8`, `models/small-int8`…), así que la primera vez que uses otra se
descarga completa, y podés volver a la anterior sin bajar nada de nuevo.

### Volver a SenseVoice

Plugins → panel de voz → elegí `SenseVoiceSmall (INT8)` **y** uno de sus idiomas
(`auto`, `zh`, `en`, `yue`, `ja`, `ko`). Pedir español con SenseVoice falla a propósito: ese modelo
no lo conoce.

### Desinstalar

Plugins → tarjeta del plugin → **Desinstalar**. La interfaz vuelve a inglés y el dictado ofrece solo
SenseVoice; no queda nada roto.

---

## Estructura del repositorio

```
deepseek-harness-es/
├── locale-es/                  Paquete del idioma (registra «Español» y sus diccionarios)
│   ├── client.js               Bundle de navegador con los 2.433 textos traducidos
│   ├── index.js                Mitad Host (vacía a propósito: es un paquete de datos)
│   └── cordis.patch.yml        Inserta la fila del plugin en el perfil
├── speech-to-text-whisper/     Paquete del reconocedor de voz
│   ├── index.js                Mitad Host: descarga, verificación SHA-256 y ciclo del worker
│   ├── whisper-worker.js       Proceso hijo con el reconocedor nativo y el VAD Silero
│   └── cordis.patch.yml        Inserta el proveedor y lo deja seleccionado por defecto
├── tools/                      Herramientas de mantenimiento (ver tools/README.md)
│   └── corpus/                 Claves inglesas originales, lotes y traducción final
├── samples/prueba-es.wav       Audio de prueba en español
├── docs/                       Instalación, verificación, desarrollo y límites
└── .github/workflows/verify.yml  CI: valida manifiestos y el bundle del idioma
```

---

## Cómo funciona

- **Interfaz.** DSH expone un servicio `locale` en el cliente. Este paquete registra un idioma nuevo
  (`addLanguage({ id: 'es', label: 'Español', fallback: 'en' })`) y un diccionario por cada sección
  de la interfaz (`register(ns, 'es', {...})`). Si una clave no está traducida, la búsqueda sigue la
  cadena `es → en` y muestra el texto inglés; nunca aparece una clave cruda.
- **Voz.** DSH expone el servicio `speechToText`, que acepta proveedores con metadatos (idiomas,
  fuentes de descarga, estimación de disco), un ciclo de preparación y una función `transcribe`. El
  proveedor descarga los pesos de Whisper desde Hugging Face, los verifica con SHA-256, levanta un
  proceso hijo con el reconocedor y le envía el audio por un socket local autenticado.
- **Reproducibilidad.** Los modelos están fijados por revisión de Hugging Face, tamaño y SHA-256. Si
  el archivo no coincide, se descarta y se informa el error en el panel.

---

## Limitaciones conocidas

- El selector de idioma del dictado muestra el código **`es`** en vez de «Español»: el bundle de voz
  de DSH trae nombres traducidos solo para `auto/zh/en/yue/ja/ko`.
- La vista previa de planillas de cálculo queda en inglés (`sidebarExcel.language` es un
  identificador del renderizador, no texto de interfaz).
- La traducción es **español neutro (es-419)**. Acepta cambios, sobre todo de terminología.
- Unos **127 textos coinciden con el inglés** porque son términos técnicos o nombres propios
  (`token`, `plugin`, `JSON`, `MCP`, `DeepSeek`…).
- El paquete de voz **no** distribuye los modelos: se descargan la primera vez (~162 MB `base`
  int8, ~377 MB `small` int8) desde `huggingface.co` o su espejo `hf-mirror.com`.
- Si el repositorio clonado se mueve o se borra, los plugins dejan de cargar (el perfil apunta con
  un enlace simbólico a esa carpeta).

Más detalle en [`docs/LIMITACIONES.md`](docs/LIMITACIONES.md).

---

## Problemas frecuentes

| Síntoma | Qué hacer |
|---|---|
| Instalé todo pero la interfaz sigue en inglés | Recargá la página (F5 / Ctrl+R). Si sigue igual, revisá Ajustes → General → Idioma |
| No aparece «Español» en la lista de idiomas | Verificá que el bundle `@local/dsh-locale-es` esté activo en Plugins |
| El micrófono no ofrece Whisper | Verificá que `@local/dsh-speech-to-text-whisper` esté activo en Plugins; si la instalación cambió de ruta, el perfil pide reiniciar DSH |
| El idioma vuelve a español aunque elija inglés | Es esperado: el paquete deja el español activo en cada carga. Desinstalalo (o poné `preference: false` en su fila) para usar otro idioma |
| La descarga del modelo falla por red | El panel ofrece `hf-mirror.com` como fuente alternativa; podés forzarla en el `config` con `modelOrigin: 'https://hf-mirror.com'` |
| «Speech provider sensevoice-local does not support language: es» | Elegiste español con SenseVoice; elegí Whisper o un idioma que SenseVoice conozca |
| El dictado tarda mucho | `base` int8 es ~2,7x más rápido que `small`; `fp32` es bastante más lento que `int8` |

---

## Contribuir

Las contribuciones son bienvenidas: terminología, textos que suenan raros, otros idiomas, o mejoras
al proveedor de voz. Empezá por [`CONTRIBUTING.md`](CONTRIBUTING.md) y
[`docs/DESARROLLO.md`](docs/DESARROLLO.md), que explican cómo regenerar la traducción desde el build
instalado de DSH.

Las cadenas originales en inglés provienen de DeepSeek Harness (MIT) y los pesos de los modelos se
descargan de Hugging Face. Ver [`LICENSE`](LICENSE) y [`docs/CREDITOS.md`](docs/CREDITOS.md) para el
detalle de licencias y atribución.

---

## English quick start

DSH ships English and Chinese only, and its bundled speech recognizer does not support Spanish.
This repository adds both as local plugins:

1. Clone it and install each folder with the DSH plugin manager (`install_bundle` with the absolute
   path), or use the Web GUI: **Plugins → Add plugin** → absolute path of `locale-es` and then
   `speech-to-text-whisper`.
2. Settings → General → Language → **Español** (this becomes the default automatically).
3. The microphone panel will list **Whisper Base multilingüe (INT8)** with language `es`; the first
   recording offers **Download and prepare** (~162 MB, verified by SHA-256).

Everything runs locally; audio never leaves the machine.
