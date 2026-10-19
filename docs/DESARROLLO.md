# Desarrollo

Cómo está hecho todo y cómo regenerarlo si DSH cambia.

## 1. Interfaz: de dónde salen los textos

La interfaz de DSH vive dentro del `app.asar` instalado. Cada paquete de cliente trae sus textos en
un diccionario embebido en `lib/client.js`, en la forma:

```js
ctx.locale.register("chat", { zh, en });
```

El proceso de extracción es:

1. `tools/dsh-asar-list.mjs` y `tools/dsh-asar-extract.mjs` extraen del `app.asar` todos los
   `@deepseek-ai/*/lib/client.js`.
2. `tools/extract-corpus.mjs` recorre esos bundles, encuentra cada llamada a `locale.register(...)`,
   resuelve el namespace y las referencias al diccionario inglés, y escribe
   `tools/corpus/corpus.json` (57 namespaces, 2.433 claves).
3. `tools/make-batches.mjs` reparte el corpus en lotes de ~260 claves para traducir en paralelo.
4. Las traducciones se escriben en `tools/corpus/batches/batch-NN.out.json`.
5. `tools/validate-batches.mjs` comprueba que cada lote tenga exactamente las claves pedidas, sin
   vacíos y con los mismos `{marcadores}`.
6. `tools/build-locale-pack.mjs` genera `locale-es/client.js` con el diccionario completo y la
   metadata de idioma.
7. `tools/verify-client-bundle.mjs` simula el cargador del navegador y verifica el 100 % de la
   cobertura.

Para traducir hay dos reglas que no se negocian: **los `{marcadores}` se copian tal cual** y **las
claves no se tocan**. El resto es estilo: español neutro (es-419), imperativos estándar
(«Guardar», «Cancelar», «Reintentar»), sin regionalismos, y se mantienen los términos técnicos
(`token`, `plugin`, `JSON`, `MCP`, `sandbox`) y los nombres propios.

### Agregar otro idioma

1. Copiá `locale-es/` a `locale-pt/` (por ejemplo).
2. En `package.json`: cambiá `name` a `@local/dsh-locale-pt` y la descripción.
3. En `cordis.patch.yml`: cambiá el `id` de la fila y el `name`.
4. En `client.js`: cambiá el `id` del módulo (debe ser igual al `name` del paquete) y el objeto
   `LANGUAGE` (`{ id: 'pt', label: 'Português', fallback: 'en' }`).
5. Traducí `tools/corpus/corpus.json` y volvé a correr `validate-batches.mjs`,
   `build-locale-pack.mjs` y `verify-client-bundle.mjs` (los puntos 5 a 7 de la sección 1).

El `fallback` puede apuntar a `en` (lo normal) y la cadena debe terminar siempre en `en`; el
buscador de DSH recorre `pt → en` y muestra el inglés cuando falta una clave.

### Por qué el paquete fija la preferencia él mismo

Un paquete de idioma que solo registra el idioma puede quedar sin efecto: el cliente resuelve el
idioma activo desde el **documento de settings** (el `cordis.patch.yml` del perfil), así que si ese
archivo no tiene la preferencia, la interfaz usa el idioma del navegador. Y la aplicación reescribe
ese archivo cuando alguien cambia cualquier ajuste: en la práctica, la preferencia se puede perder.

Por eso `client.js` llama a `ctx.locale.setLocale('es')` en cada activación. Es la vía oficial de la
preferencia: activa el idioma en el momento y, si el servicio de settings acepta la escritura, lo deja
guardado en el patch del perfil. La garantía no depende de ese archivo: la activación ocurre en cada
carga, así que el español vuelve aunque el patch se haya reescrito. Dos reglas para un paquete nuevo:

1. Llamá a `setLocale` (no alcanza con declarar el idioma y agregar el diccionario).
2. **No declares el mismo valor en el patch del paquete**: si el valor del perfil coincide con el
   heredado del bundle, la aplicación lo descarta al reescribir su patch y el idioma se pierde otra
   vez. El verificador (`verify-client-bundle.mjs`) comprueba esa invariante y falla si aparecen
   `preference:` en el patch del paquete.

Para que un usuario pueda usar otro idioma sin desinstalar, la config de la fila admite
`preference: false`, que deja el idioma registrado pero sin seleccionarlo.

## 2. Voz: cómo está hecho el proveedor

`speech-to-text-whisper/` implementa el contrato del servicio `speechToText` de DSH:

- **Metadatos** (`info`): id, nombre visible, `location: 'host-local'`, idiomas admitidos, fuentes de
  descarga y estimación de disco.
- **Preparación** (`preparation`): una máquina de estados que el panel de voz muestra paso a paso
  (`check`, `model`, `vad`, `verify`, `load`) con progreso de descarga.
- **Transcripción** (`transcribe`): recibe `{ audio, language }` y devuelve
  `{ text, audioSeconds, inferenceSeconds }`.

La mitad Host (`index.js`, solo con módulos nativos de Node) se encarga de:

1. Resolver y localizar el runtime `sherpa-onnx-node` que ya viene con DSH
   (`process.resourcesPath/app.asar/dsh/node_modules/sherpa-onnx-node`).
2. Descargar los pesos con `fetch`, escribirlos en un archivo temporal, verificar tamaño y SHA-256 y
   publicarlos con un `rename` atómico.
3. Levantar `whisper-worker.js` como proceso hijo (`ELECTRON_RUN_AS_NODE=1`) con un token aleatorio.
4. Enviar el WAV por HTTP a `127.0.0.1` con `Authorization: Bearer …` y reutilizar el worker entre
   grabaciones (se apaga solo tras un tiempo de inactividad).

El worker (`whisper-worker.js`) valida el WAV (PCM 16 bits, mono, 16 kHz), lo trocea con el VAD
Silero, y decodifica cada segmento con Whisper usando `language` como pista (`auto` deja que Whisper
detecte el idioma).

### Fijar un modelo nuevo o una variante

En `index.js`, la constante `RELEASES` tiene por variante la revisión del repositorio de Hugging
Face y, por archivo, `name`, `bytes` y `sha256`. Para agregar `medium`, por ejemplo:

```js
medium: {
  revision: '<sha del commit>',
  repo: 'csukuangfj/sherpa-onnx-whisper-medium',
  tokens: { name: 'medium-tokens.txt', bytes: <n>, sha256: '<64 hex>' },
  int8: {
    encoder: { name: 'medium-encoder.int8.onnx', bytes: <n>, sha256: '<64 hex>' },
    decoder: { name: 'medium-decoder.int8.onnx', bytes: <n>, sha256: '<64 hex>' },
  },
  fp32: { … },
}
```

Los tamaños y hashes salen de la API de Hugging Face:
`https://huggingface.co/api/models/<repo>/tree/main` (el campo `lfs.oid` **es** el SHA-256 del
archivo). Nunca los escribas a mano: se cometió ese error una vez y la preparación falló con
`integrity` (ver `docs/VERIFICACION.md`).

También se puede agregar una variante `language` en `DEFAULT_LANGUAGES`; conviene incluir `es` y
`auto`.

## 3. Pruebas

```bash
node tools/ci-validate.mjs            # manifiestos, JSON y portabilidad
node tools/verify-client-bundle.mjs   # bundle del idioma (no necesita DSH)
```

Y para la voz, con DSH instalado: ver `docs/VERIFICACION.md`, sección «Proveedor de voz».

## 4. Publicar

Lista de control antes de subir:

- [ ] Los ejemplos de URL usan tu usuario de GitHub (`admzaddem-ia`); si publicás desde otra cuenta,
      cambialos.
- [ ] `node tools/ci-validate.mjs` pasa (falla si encuentra rutas personales o JSON roto).
- [ ] `node tools/verify-client-bundle.mjs` imprime `PASS`.
- [ ] `git status` no muestra `node_modules`, modelos ni archivos temporales.
- [ ] Opcional pero recomendado: agregar capturas de pantalla en `docs/` (interfaz en español y panel
      de voz) y enlazarlas desde el README.
- [ ] Opcional: completar el `CHANGELOG.md` si agregaste algo después de esta versión.

Y después:

1. Creá el repositorio en GitHub (público, sin README ni .gitignore: ya vienen acá) y subí el
   contenido. Con **GitHub CLI** autenticado (`gh auth login`) es un solo comando, que crea el
   repositorio remoto, agrega el remoto y empuja:

   ```bash
   gh repo create deepseek-harness-es --public --source . --push \
     --description "Interfaz en español y dictado por voz en español para DeepSeek Harness"
   ```

2. Sin `gh`, con Git a mano:

   ```bash
   git init
   git add .
   git commit -m "Español para DeepSeek Harness: interfaz y dictado"
   git branch -M main
   git remote add origin https://github.com/admzaddem-ia/deepseek-harness-es.git
   git push -u origin main
   ```

3. Si el repositorio ya existe y solo querés publicar cambios posteriores:

   ```bash
   git add .
   git commit -m "Describe el cambio"
   git push
   ```

### Del lado del agente de DSH

Con `gh` autenticado, el agente puede hacer todo el ciclo: `gh repo create` para publicar, `gh repo
clone` y `gh api` para revisar repositorios de otras personas, `gh pr create` para proponer cambios y
`git pull` para traer novedades. No hace falta configurar nada más: `gh auth login` también deja el
ayudante de credenciales de Git listo para `git push`.

### Publicar sin tener Git instalado

En Windows podés instalarlo con `winget install --id Git.Git -e` (y GitHub Desktop con
`winget install --id GitHub.GitHubDesktop -e`). Si preferís no instalar nada, alcanza con la web de
GitHub:

1. Creá el repositorio vacío en GitHub (sin README ni licencia).
2. **Add file → Upload files** y arrastrá **el contenido** de la carpeta `deepseek-harness-es`
   (no la carpeta contenedora): `README.md`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`,
   `.gitignore`, y las carpetas `locale-es`, `speech-to-text-whisper`, `docs`, `tools`, `samples`.
3. Creá a mano el archivo del CI: **Add file → Create new file**, escribí la ruta
   `.github/workflows/verify.yml` y pegá el contenido de ese archivo del repositorio. (El arrastre de
   carpetas no siempre incluye las carpetas ocultas.)
4. Confirmá el commit.

Las comprobaciones de `.gitignore` siguen valiendo: no subas `node_modules` ni modelos (`*.onnx`).

