# Instalación paso a paso

Esta guía asume que ya tenés DeepSeek Harness (DSH) instalado y funcionando. El perfil que se usa en
los ejemplos es `desktop`, que es el de la aplicación de escritorio.

Antes de empezar: **copiá este repositorio a una carpeta estable**. El perfil de DSH se va a enlazar
a esa carpeta (un enlace simbólico desde `node_modules`), así que si movés o borrás el repositorio
después, los plugins dejan de cargar.

```
C:\Users\<vos>\dsh-espanol\        ← ejemplo de ubicación recomendada
```

## 1. Requisitos

- DSH abierto al menos una vez (para que exista el perfil en `$DSH_HOME/profiles/<perfil>`).
- En Windows, `$DSH_HOME` es `C:\Users\<vos>\.dsh`; en macOS y Linux, `~/.dsh`.
- Para el dictado: entre ~162 MB (`base` int8) y ~377 MB (`small` int8) de disco libre, y conexión a
  internet la primera vez.

## 2. Instalar el paquete del idioma

### Con el agente de DSH (recomendado)

Escribí algo como:

> Instalá el plugin que está en `C:\Users\<vos>\dsh-espanol\locale-es` con `plugin_manager`
> (`action: install_bundle`) y contame si quedó activo.

El agente va a llamar a la herramienta oficial de administración de plugins, que hace el `pnpm add`
en el perfil, agrega el bundle a `dsh.profile.bundles` y recomienda el árbol de plugins en caliente.

### Desde la interfaz

1. **Plugins** en la barra lateral.
2. **Agregar plugin**.
3. Pegá la ruta absoluta: `C:\Users\<vos>\dsh-espanol\locale-es`.
4. **Instalar** y esperar a que termine.
5. Si la interfaz no cambia sola, recargá la página (F5 o Ctrl+R).

### Verificar

Ajustes → **General** → **Idioma** debe mostrar **Español**, y la interfaz debe estar traducida.

El paquete del idioma se **auto-selecciona**: al cargar la página llama a `setLocale('es')`, la vía
oficial de la preferencia. No importa el idioma del navegador ni que el patch del perfil se haya
reescrito: el español vuelve a quedar activo en cada carga.

## 3. Instalar el paquete de voz

Repetí el mismo procedimiento con la carpeta `speech-to-text-whisper`:

- Con el agente: `install_bundle` con `C:\Users\<vos>\dsh-espanol\speech-to-text-whisper`.
- Desde la interfaz: **Agregar plugin** → esa ruta absoluta.

Al terminar, el panel del micrófono debe mostrar el proveedor **«Whisper Base multilingüe (INT8)»** y
el idioma **`es`**.

## 4. Preparar el modelo (primera vez)

La primera vez que uses el micrófono, el panel ofrece **Descargar y preparar**:

- `base` int8: ~162 MB (descarga recomendada para empezar).
- `small` int8: ~377 MB (más preciso, ~2,7x más lento).
- El VAD Silero (~1,8 MB) se descarga junto con la primera variante.

La descarga se hace desde `huggingface.co` y, si falla, el panel ofrece `hf-mirror.com` como espejo.
Cada archivo se verifica con SHA-256 antes de usarse: si no coincide, se descarta y se informa el
error.

Los modelos quedan en:

```
$DSH_HOME/speech-to-text/whisper/models/
├── base-int8/    (o small-int8/)
└── silero/silero_vad.onnx
```

Se pueden borrar en cualquier momento; el panel vuelve a ofrecer la descarga.

## 5. Instalar desde otra máquina o compartir

La forma que funciona con este repositorio es **clonarlo y agregar cada subcarpeta por ruta
absoluta** (como en los pasos 2 y 3). pnpm instala una sola raíz por especificación, así que una
dirección Git solo sirve si publicás **cada paquete como repositorio propio**; en ese caso:

```
https://github.com/admzaddem-ia/dsh-locale-es
https://github.com/admzaddem-ia/dsh-speech-to-text-whisper
```

## 6. Desinstalar o revertir

- **Desinstalar un plugin:** Plugins → tarjeta del plugin → **Desinstalar**. La interfaz vuelve a
  inglés y el dictado vuelve a ofrecer solo SenseVoice.
- **Quitar solo la preferencia de idioma:** en `$DSH_HOME/profiles/<perfil>/cordis.patch.yml`,
  borrá el bloque:

  ```yaml
  - id: locale
    name: "@deepseek-ai/dsh-client-locale"
    config:
      preference: es
  ```

  Ojo: el propio paquete del idioma vuelve a escribir `preference: es` en cada carga de la página
  (llama a `setLocale`, la vía oficial de settings). Mientras siga instalado, el español queda
  seleccionado aunque borres ese bloque; para usar otro idioma hay que **desinstalar** el paquete
  `@local/dsh-locale-es` (o poner `preference: false` en su fila).

- **Herramienta de plugins habilitada:** este repositorio no la habilita; si un agente la activó
  para instalar (`- id: tool-plugin-manager` + `disabled: false`), podés borrar esas dos líneas para
  volver al estado original.

## 7. Actualizar

```powershell
cd C:\Users\<vos>\dsh-espanol
git pull
```

Los plugins se cargan desde esa carpeta, así que la actualización se aplica al recargar la página o
reiniciar DSH. Si el paquete agregó una fila nueva al perfil (por ejemplo otro proveedor), volvé a
ejecutar `install_bundle` para que el perfil se entere.
