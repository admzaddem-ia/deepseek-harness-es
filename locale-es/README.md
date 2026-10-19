# `@local/dsh-locale-es` — interfaz en español

Paquete de idioma para la interfaz web de DeepSeek Harness. Registra el idioma **Español** y un
diccionario por cada sección de la interfaz.

| | |
|---|---|
| Nombre del paquete | `@local/dsh-locale-es` |
| Idioma | `es` (etiqueta «Español»), respaldo `en` |
| Cobertura | 57 namespaces, 2.433 textos |
| Dependencias | ninguna (el bundle de cliente no importa nada) |

## Cómo funciona

La mitad de navegador (`client.js`) se registra en el cargador de módulos de DSH y, al activarse:

```js
ctx.locale.addLanguage({ id: 'es', label: 'Español', fallback: 'en' });
ctx.locale.register('chat', 'es', { /* … */ });
```

La búsqueda de textos recorre la cadena `es → en`: si una clave no está traducida, se muestra el
texto inglés; nunca aparece la clave cruda. La mitad Host (`index.js`) está vacía a propósito: este
paquete es solo datos.

## Cómo queda seleccionado el idioma

Después de registrar el idioma y los diccionarios, el paquete llama a la API oficial
`setLocale('es')` en cada activación. Esa llamada es la vía de la preferencia del servicio de
settings: cambia el idioma activo en el momento y, si el servicio acepta la escritura, además la deja
guardada en el patch del perfil.

Lo importante es que **la garantía no depende de ese archivo**: aunque la aplicación reescriba su
patch y borre la preferencia, el paquete vuelve a activar el español en la siguiente carga. Eso se
comprobó en la aplicación real (ver [`../docs/VERIFICACION.md`](../docs/VERIFICACION.md)).

Por eso el patch de este paquete (`cordis.patch.yml`) **no** declara `preference`: si declarara el
mismo valor, el valor guardado en el perfil sería idéntico al heredado del bundle y la aplicación lo
descartaría al reescribir su patch.

Si preferís que el paquete solo registre el idioma y no lo seleccione, agregá `preference: false` a su
config:

```yaml
- id: locale-es
  name: '@local/dsh-locale-es'
  config:
    preference: false
```

Para usar otro idioma, desinstalá el paquete. También se puede elegir a mano en Ajustes → General →
Idioma, pero el paquete lo vuelve a poner en español en la siguiente carga.

## Instalación

Con el agente de DSH: `plugin_manager` con `action: install_bundle` y la **ruta absoluta** de esta
carpeta. Desde la interfaz: **Plugins → Agregar plugin** → la misma ruta.

## Archivos

| Archivo | Rol |
|---|---|
| `client.js` | Bundle de navegador: idioma y los 57 diccionarios |
| `index.js` | Mitad Host vacía (`export function apply() {}`) |
| `cordis.patch.yml` | Inserta la fila `locale-es` en el perfil |
| `locale/en.json`, `locale/es.json` | Título y descripción de la tarjeta en Plugins |

## Desinstalar

Plugins → tarjeta del plugin → **Desinstalar**. La interfaz vuelve a inglés.

## Notas

- La vista previa de planillas de cálculo queda en inglés a propósito (`sidebarExcel.language` es un
  identificador del renderizador, no texto de interfaz).
- 127 textos coinciden con el inglés porque son términos técnicos o nombres propios.
- Para traducir otro idioma o corregir textos, ver [`../CONTRIBUTING.md`](../CONTRIBUTING.md) y
  [`../docs/DESARROLLO.md`](../docs/DESARROLLO.md).
